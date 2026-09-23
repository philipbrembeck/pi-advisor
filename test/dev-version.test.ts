import { describe, expect, test } from "bun:test";

import { nextDevVersion } from "../scripts/next-dev-version.ts";

describe("development package versions", () => {
  test("starts at the next patch prerelease", () => {
    expect(nextDevVersion("0.8.0", [])).toBe("0.8.1-dev.1");
  });

  test("increments the highest published sequence for the next patch", () => {
    expect(
      nextDevVersion("0.8.0", [
        "0.8.1-dev.1",
        "0.8.1-dev.3",
        "0.8.2-dev.9",
        "0.8.1-next.5",
      ])
    ).toBe("0.8.1-dev.4");
  });

  test("starts a fresh sequence after the stable version advances", () => {
    expect(nextDevVersion("0.8.1", ["0.8.1-dev.4"])).toBe("0.8.2-dev.1");
  });

  test("rejects prerelease and malformed package versions", () => {
    expect(() => nextDevVersion("0.8.1-dev.1", [])).toThrow(
      "Expected a stable package version"
    );
  });
});
