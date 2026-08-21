import { createHash } from "node:crypto";
import type { SwebenchManifest } from "./types.js";

export const SEMANTIC_MANIFEST_SCHEMA_VERSION = 1 as const;

const immutableManifestFields = [
  "candidatePoolSha256",
  "dataset",
  "datasetSnapshot",
  "experimentId",
  "protocolProvenance",
  "repositorySource",
  "schemaVersion",
  "selectionProtocol",
  "tasks",
] as const;
const immutableTaskFields = [
  "baseCommit",
  "failToPass",
  "id",
  "instanceId",
  "passToPass",
  "problemStatement",
  "repo",
  "solutionPatch",
  "solutionPatchSha256",
  "testFiles",
  "testPatch",
  "testPatchSha256",
  "validation",
  "version",
] as const;
const provenanceFields = [
  "candidatePoolSha256",
  "effectiveV2ProtocolIdentity",
  "moduleMappingSha256",
  "protocolV2Sha256",
  "selectedFailToPassAtLeast2Count",
  "selectedIds",
  "selectedProductionLines20OrExpressionCount",
  "selection",
  "v1EffectiveProtocolIdentity",
  "v1SelectionDelta",
] as const;

const pick = (value: Record<string, unknown>, fields: readonly string[]) =>
  Object.fromEntries(
    fields
      .filter((field) => Object.hasOwn(value, field))
      .map((field) => [field, value[field]])
  );

const taskProjection = (task: Record<string, unknown>) =>
  pick(task, immutableTaskFields);

export const semanticManifestProjection = (
  manifest: SwebenchManifest,
  selectionProvenance?: unknown
) => {
  const raw = manifest as unknown as Record<string, unknown>;
  const projection = {
    manifest: {
      ...pick(raw, immutableManifestFields),
      tasks: manifest.tasks.map((task) => taskProjection(task as never)),
    },
    schemaVersion: SEMANTIC_MANIFEST_SCHEMA_VERSION,
  } as Record<string, unknown>;
  if (selectionProvenance && typeof selectionProvenance === "object") {
    projection.selectionProvenance = pick(
      selectionProvenance as Record<string, unknown>,
      provenanceFields
    );
  }
  return projection;
};

export const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

export const canonicalJsonHash = (value: unknown) =>
  createHash("sha256").update(stableJson(value), "utf8").digest("hex");

export const semanticManifestIdentity = (
  manifest: SwebenchManifest,
  selectionProvenance?: unknown
) =>
  canonicalJsonHash(semanticManifestProjection(manifest, selectionProvenance));
