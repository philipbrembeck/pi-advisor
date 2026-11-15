import { isRecord, isString } from "./content-utils.ts";
import {
  SCOUT_SELECTION_MAX_IDS,
  SCOUT_SYNTHESIS_MAX_BYTES,
} from "./scout-types.ts";
import type { ScoutManifest } from "./scout-types.ts";

export interface ScoutSelection {
  selectedIds: string[];
  synthesis: string;
}

const byteLength = (value: string) => Buffer.byteLength(value, "utf-8");

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(isString);

export const parseScoutSelection = (
  text: string,
  manifest: ScoutManifest
): ScoutSelection => {
  if (!text.trim()) {
    throw new Error("Scout returned an empty response.");
  }

  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error("Scout response is not a JSON object.", { cause: error });
  }

  if (!isRecord(value)) {
    throw new Error("Scout response must be a JSON object.");
  }

  const keys = Object.keys(value).toSorted();

  if (
    keys.length !== 2 ||
    keys[0] !== "selectedIds" ||
    keys[1] !== "synthesis"
  ) {
    throw new Error(
      "Scout response must contain only selectedIds and synthesis."
    );
  }

  if (!isStringArray(value.selectedIds)) {
    throw new Error("Scout selectedIds must be an array of strings.");
  }

  const { selectedIds } = value;

  if (new Set(selectedIds).size !== selectedIds.length) {
    throw new Error("Scout selected duplicate group IDs.");
  }

  const known = new Set(manifest.groups.map((group) => group.id));
  const knownSelectedIds = selectedIds.filter((id) => known.has(id));

  const requiredIds = manifest.groups
    .filter((group) => group.required)
    .map((group) => group.id);

  if (requiredIds.length > SCOUT_SELECTION_MAX_IDS) {
    throw new Error(
      `Manifest contains more than ${SCOUT_SELECTION_MAX_IDS} required groups.`
    );
  }

  const required = new Set(requiredIds);

  const optionalIds = knownSelectedIds
    .filter((id) => !required.has(id))
    .slice(0, SCOUT_SELECTION_MAX_IDS - requiredIds.length);

  const retained = new Set([...requiredIds, ...optionalIds]);

  const normalizedIds = manifest.groups
    .filter((group) => retained.has(group.id))
    .map((group) => group.id);

  if (!isString(value.synthesis)) {
    throw new TypeError("Scout synthesis must be a string.");
  }

  if (byteLength(value.synthesis) > SCOUT_SYNTHESIS_MAX_BYTES) {
    throw new Error(
      `Scout synthesis exceeds ${SCOUT_SYNTHESIS_MAX_BYTES} UTF-8 bytes.`
    );
  }

  return {
    selectedIds: normalizedIds,
    synthesis: knownSelectedIds.length > 0 ? value.synthesis : "",
  };
};
