# SWE-bench Hard Baseline Selection Protocol v1 Clarification

Status: **frozen pre-dataset addendum**

This addendum clarifies, but does not replace, the original v1 proposal.
It was persisted before candidate-row retrieval or candidate ranking.

- Original protocol path: `benchmarks/SWEBENCH-BASELINE-DESIGN-PROPOSAL.md`
- Original protocol SHA-256: `713969971fc2588ebf9ee300d66de9ce906dd6b4f5264e72017597912f4e33d1`
- Addendum version: `v1-clarification-2026-08-19`

## Percentile ranks

For every numeric intrinsic metric, rank eligible candidates independently
within each repository. Sort raw values ascending. Equal values receive the
same **average ordinal rank**. For repository population `n > 1`:

```text
percentile = (average_rank - 1) / (n - 1)
```

For `n == 1`, percentile is `0.5`. No dense, ordinal, first-occurrence, or
random tie ranking is permitted. Persist each metric's raw value, average
rank, and percentile. Boolean `multiModule` is scored as numeric `0` or `1`
using the same procedure and retains its approved 2x weight.

Ranks are calculated using exact numeric comparisons. Percentiles and the
complexity sum are represented as JSON numbers without intermediate rounding;
rendering uses the deterministic JSON serializer used for the artifacts.

## Patch paths and production classification

Canonical solution-patch paths are parsed from `diff --git` headers, decoded
from Git's quoted form when applicable, normalized to POSIX separators, and
stored once in sorted order. A deleted file uses its `a/` path, a created file
uses its `b/` path, and a rename uses the destination `b/` path for changed-file
metrics. `/dev/null` is never a production path.

Every endpoint path appearing in a patch is persisted with:

```text
path, classification, classificationRule
```

The repository mapping artifact defines the source root and test rules before
metrics are computed. A path under the mapped source root is `production`
unless it matches a repository test rule. A path outside the source root is
`test` when it matches a test rule; otherwise it is `other` (documentation,
build, CI, metadata, generated, vendored, or unrelated repository content).
No candidate-specific override is permitted. A path that matches both a
production-root rule and a test rule is `test`.

The common test rules are deterministic and repository-relative:

- a path component named `tests` or `test`;
- a basename beginning `test_` or ending `_test.py`, `.test.js`, `.test.ts`,
  `.spec.js`, or `.spec.ts`;
- repository-specific test roots listed in the module mapping artifact.

## Logical modules

`multiModule` is true only when the distinct logical production-module set has
at least two entries. It is not derived from file count. The source roots,
ignored prefix components, and logical component boundary are frozen in
`benchmarks/swebench/hard-baseline-module-mapping.json`.

The first meaningful component after the ignored source/package prefix is the
logical module. A production file directly at the source root is assigned the
stable `__root__` module. Module names are sorted lexicographically and
persisted as `productionModules`.

## Complexity and selection

For each eligible candidate, compute:

```text
complexity =
    2 * pct(productionFilesChanged)
  + 2 * pct(productionLinesChanged)
  + 2 * pct(multiModuleNumeric)
  + 1 * pct(productionHunkCount)
  + 1 * pct(failToPassCount)
  + 1 * pct(passToPassCount)
  + 1 * pct(problemStatementLength)
```

This remains the **intrinsic complexity heuristic**, not a difficulty score.
The sum is not normalized again.

The deterministic selection sequence is per repository and sequential:

1. highest unused `complexity`;
2. highest unused `productionFilesChanged`;
3. highest unused `failToPassCount`;
4. highest unused `problemStatementLength`.

Coverage criteria use the target raw metric descending, then complexity
descending, then `tieHash` ascending. All other ties use complexity descending
where applicable, then `tieHash` ascending. The tie hash is the lowercase
hexadecimal SHA-256 digest of the UTF-8 bytes of:

```text
protocol-version || instance-id
```

where `protocol-version` is the literal `v1` and `||` is the literal two-byte
ASCII separator `||`. The four selections must be unique. Selected order is
then the four-per-repository selection order in repository mapping order
(Django, Matplotlib, scikit-learn, Sphinx, SymPy); the final manifest order is
that list sorted by `tieHash` ascending.

Exactly four tasks are required from every repository. The selected manifest
must contain at least two multi-module tasks and at least eight tasks where
`productionFilesChanged >= 2 OR productionLinesChanged >= 20`; these are
validation constraints, never substitution objectives.

## Effective protocol identity

The original proposal is immutable. The addendum and module mapping are
separately hashed as UTF-8 bytes. The effective identity is the SHA-256 digest
of the UTF-8 bytes of this newline-delimited string:

```text
originalProtocolSha256\nclarificationSha256\nmoduleMappingSha256
```

The repository commit, all three component hashes, and the derived effective
identity are persisted in the selection provenance artifact.

## Fail-closed conditions

Construction stops before selection when dataset schema, pagination, revision,
repository support, duplicate IDs, patch parsing, source-root mapping, or
eligible-pool cardinality is not deterministic. Construction also stops after
selection if either validation constraint fails. No selected task is replaced.

Gold patches and candidate artifacts remain outside model-visible workspaces;
no model inference, Advisor/Scout execution, or Sol/Luna schedule construction
is part of this step.
