import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const requireCommittedPreregistration = (
  section: RegExp,
  label: string,
  path = "bench/PREREGISTRATION.md"
) => {
  const absolute = resolve(path);
  if (!existsSync(absolute)) {
    throw new Error(`${path} is required before ${label}.`);
  }
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", path], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    execFileSync("git", ["diff", "--quiet", "HEAD", "--", path], {
      stdio: "ignore",
    });
  } catch (error) {
    throw new Error(
      `${path} must be committed and unchanged before ${label}.`,
      { cause: error }
    );
  }
  const text = readFileSync(absolute, "utf8");
  if (!section.test(text)) {
    throw new Error(
      `${path} is missing the preregistration section for ${label}.`
    );
  }
  return text;
};
