import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const JS_EXTENSIONS = new Set([".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);

const isJsFile = (path: string) =>
  JS_EXTENSIONS.has(path.slice(path.lastIndexOf(".")).toLowerCase());

const isCommentLine = (line: string) =>
  line.startsWith("//") ||
  line.startsWith("/*") ||
  line.startsWith("*") ||
  line.startsWith("*/");

const commentRuns = (text: string) => {
  let lines = 0;
  let run = 0;
  let longestRun = 0;

  for (const raw of text.split("\n")) {
    if (isCommentLine(raw.trimStart())) {
      lines += 1;
      run += 1;
      longestRun = Math.max(longestRun, run);
    } else {
      run = 0;
    }
  }

  return { lines, longestRun };
};

const seen = new Set<string>();

export default function commentGuard(pi: ExtensionAPI) {
  pi.on("tool_call", (event) => {
    let path = "";
    let added = "";

    if (isToolCallEventType("write", event)) {
      ({ content: added, path } = event.input);
    } else if (isToolCallEventType("edit", event)) {
      ({ path } = event.input);
      added = event.input.edits.map((edit) => edit.newText).join("\n");
    } else {
      return;
    }

    if (!isJsFile(path)) {
      return;
    }

    const { lines, longestRun } = commentRuns(added);

    if (lines === 0) {
      return;
    }

    const key = `${event.toolName}:${path}:${added}`;

    if (seen.has(key)) {
      return;
    }

    seen.add(key);

    return {
      block: true,
      reason: `comment-guard (repo AGENTS.md): "Comment only when 100% needed; never more than one line." This ${event.toolName} adds ${lines} comment line(s)${longestRun > 1 ? ` with a ${longestRun}-line run` : ""}. Strip them, or reduce to exactly one single-line comment if genuinely required. Retrying the identical ${event.toolName} unchanged will be allowed through.`,
    };
  });
}
