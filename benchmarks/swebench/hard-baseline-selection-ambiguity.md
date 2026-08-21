# SWE-bench Hard Baseline Selection Protocol v1 — Blocking Ambiguity

Status: **BLOCKED before candidate dataset retrieval**

Protocol: `benchmarks/SWEBENCH-BASELINE-DESIGN-PROPOSAL.md`
Protocol SHA-256: `713969971fc2588ebf9ee300d66de9ce906dd6b4f5264e72017597912f4e33d1`
Benchmark repository commit: `156d3ca2dd435a4292484d32045068eec184d055`

## Ambiguities requiring protocol clarification

1. **Percentile-rank definition.** Protocol v1 says to use within-repository percentile ranks, but does not specify the rank convention (for example, inclusive `(rank - 1) / (n - 1)`, exclusive `rank / (n + 1)`, nearest-rank, or a tie rule). This can change the complexity ordering and therefore task membership.
2. **Multi-module indicator definition.** Protocol v1 says the indicator is derived from production paths, but does not define what constitutes a module boundary (for example, distinct top-level directories, Python package directories, or distinct files/modules). This can change both the weighted complexity score and the minimum-coverage result, and therefore can change task membership.
3. **Tie handling for equal metric values.** The protocol specifies the SHA-256 tie-break, but does not state whether percentile ties receive the same percentile, averaged ranks, or an ordered rank before the tie-break is applied. This can change the score ordering and selected tasks.

These are not resolved here. No candidate dataset was retrieved, no candidate ranking was inspected, and no interpretation was selected after observing rankings. Candidate-pool construction must not begin until protocol v2 (or an explicit clarification that freezes these definitions under v1) is reviewed and hashed.
