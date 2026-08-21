import { describe, expect, test } from "bun:test";
import {
  loadManifest,
  normalizePytestSelector,
  repositoryAdapter,
} from "../swebench/adapter.js";

const manifest = loadManifest(
  "benchmarks/swebench/hard-baseline-v2-manifest.json"
);

describe("frozen SWE-bench repository adapters", () => {
  test("routes every declared repository to an explicit adapter", () => {
    const adapters = new Map(
      manifest.tasks.map((task) => [task.repo, repositoryAdapter(task.repo)])
    );
    expect([...adapters.keys()].sort()).toEqual([
      "django/django",
      "matplotlib/matplotlib",
      "scikit-learn/scikit-learn",
      "sphinx-doc/sphinx",
      "sympy/sympy",
    ]);
    expect([...adapters.values()].sort()).toEqual([
      "django",
      "matplotlib",
      "scikit-learn",
      "sphinx",
      "sympy",
    ]);
  });

  test("preserves canonical selectors and patches", () => {
    for (const task of manifest.tasks) {
      expect(task.validation.program).toBe("python3");
      expect(task.validation.args.length).toBeGreaterThan(0);
      expect(task.testPatch).toContain("diff --git");
      expect(task.solutionPatch).toContain("diff --git");
    }
  });

  test("normalizes truncated parameterized pytest node IDs", () => {
    expect(
      normalizePytestSelector("tests/test.py::test_case[param, value")
    ).toBe("tests/test.py::test_case");
    expect(
      normalizePytestSelector("tests/test.py::test_case[param-value]")
    ).toBe("tests/test.py::test_case[param-value]");
    expect(normalizePytestSelector("test_case")).toBe("test_case");
  });
});
