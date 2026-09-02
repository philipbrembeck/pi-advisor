import {
  cpSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";

const GITHUB_CLONE_MARKER = "https://github.com";
const GIT_TRANSPORT_PREFIX =
  "git -c protocol.version=1 -c http.version=HTTP/1.1";
const DOCKERFILE_NAME = "Dockerfile";
const LINE_BREAK_PATTERN = /\r?\n/;

const dockerfilesUnder = (root: string) => {
  const files: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== ".git") {
          visit(path);
        }
      } else if (entry.isFile() && entry.name === DOCKERFILE_NAME) {
        files.push(path);
      }
    }
  };
  visit(root);
  return files;
};

/**
 * GitHub's Git smart-HTTP endpoint can reject the Git 2.39 defaults used by
 * the ReactBench base images from this host. Keep the task's repository and
 * commit unchanged, but use the older transport for its build-time clone.
 */
export const patchGitHubCloneCommands = (dockerfile: string) => {
  const lines = dockerfile.split(LINE_BREAK_PATTERN);
  const lineBreak = dockerfile.includes("\r\n") ? "\r\n" : "\n";
  let changed = false;
  const patched = lines.map((line) => {
    if (!line.includes(GITHUB_CLONE_MARKER)) {
      return line;
    }
    const marker = "git clone";
    const index = line.indexOf(marker);
    if (index === -1) {
      return line;
    }
    changed = true;
    return `${line.slice(0, index)}${GIT_TRANSPORT_PREFIX} clone${line.slice(
      index + marker.length
    )}`;
  });
  return changed ? patched.join(lineBreak) : dockerfile;
};

export interface HarborTaskOverlay {
  cleanup: () => void;
  patchedDockerfiles: string[];
  taskPath: string;
}

/**
 * Make a disposable task copy only when a task Dockerfile clones GitHub.
 * Never modify the pinned ReactBench checkout: Harbor builds from the copy.
 */
export const createHarborTaskOverlay = (
  taskPath: string
): HarborTaskOverlay => {
  const sourceTaskPath = resolve(taskPath);
  const sourceDockerfiles = dockerfilesUnder(sourceTaskPath);
  const patches = sourceDockerfiles.flatMap((path) => {
    const original = readFileSync(path, "utf8");
    const patched = patchGitHubCloneCommands(original);
    return patched === original ? [] : [{ patched, path }];
  });
  if (patches.length === 0) {
    return {
      cleanup: () => {
        // No disposable copy was needed.
      },
      patchedDockerfiles: [],
      taskPath: sourceTaskPath,
    };
  }

  const overlayRoot = mkdtempSync(join(tmpdir(), "pi-advisor-task-overlay-"));
  const overlayTaskPath = join(overlayRoot, basename(sourceTaskPath));
  try {
    cpSync(sourceTaskPath, overlayTaskPath, {
      force: true,
      recursive: true,
    });
    for (const patch of patches) {
      const overlayPath = join(
        overlayTaskPath,
        relative(sourceTaskPath, patch.path)
      );
      writeFileSync(overlayPath, patch.patched, "utf8");
    }
  } catch (error) {
    rmSync(overlayRoot, { force: true, recursive: true });
    throw error;
  }

  let cleaned = false;
  return {
    cleanup: () => {
      if (!cleaned) {
        cleaned = true;
        rmSync(overlayRoot, { force: true, recursive: true });
      }
    },
    patchedDockerfiles: patches.map((patch) =>
      relative(sourceTaskPath, patch.path)
    ),
    taskPath: overlayTaskPath,
  };
};
