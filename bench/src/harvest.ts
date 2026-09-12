import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  CandidateBand,
  DecisionKey,
  DecisionPolarity,
  DecisionTrap,
} from "./types.ts";

export interface HarvestTrajectory {
  answer: DecisionKey;
  band: CandidateBand;
  conversation: string;
  draft: string;
  polarity: DecisionPolarity;
  repoPath: string;
  sourceRun: string;
  sourceSeed: number;
  taskId: string;
  traps: DecisionTrap[];
}

const requiredText = (value: string, name: string) => {
  if (!value.trim()) {
    throw new TypeError(`${name} must be non-empty.`);
  }
  return value;
};

/** Turns a real screened trajectory into a Tier 2 item without copying its repo. */
export const harvestTrajectory = (trajectory: HarvestTrajectory) => {
  requiredText(trajectory.taskId, "taskId");
  requiredText(trajectory.conversation, "conversation");
  requiredText(trajectory.draft, "draft");
  requiredText(trajectory.sourceRun, "sourceRun");
  if (
    !Number.isSafeInteger(trajectory.sourceSeed) ||
    trajectory.sourceSeed < 0
  ) {
    throw new TypeError("sourceSeed must be a non-negative integer.");
  }
  if (
    trajectory.polarity === "positive" &&
    trajectory.band !== "candidate-uplift"
  ) {
    throw new Error(
      "Harvested positives must come from the candidate-uplift band."
    );
  }
  if (trajectory.polarity === "negative" && trajectory.band !== "trivial") {
    throw new Error("Harvested negatives must come from the trivial band.");
  }
  return {
    ...trajectory,
    sourceRun: trajectory.sourceRun,
    traps: trajectory.traps.map((trap) => ({
      choice: trap.choice,
      tokens: [...trap.tokens],
    })),
  };
};

const tomlString = (value: string) => JSON.stringify(value);

export const writeHarvestedItem = (
  root: string,
  trajectory: HarvestTrajectory,
  reactBenchCommit: string
) => {
  const harvested = harvestTrajectory(trajectory);
  const id = `harvested-${harvested.taskId}-${harvested.sourceSeed}`;
  const directory = join(root, id);
  mkdirSync(join(directory, "repo"), { recursive: true });
  mkdirSync(join(directory, "key"), { recursive: true });
  writeFileSync(join(directory, "repo", ".gitkeep"), "");
  writeFileSync(
    join(directory, "item.toml"),
    [
      `band = ${tomlString(harvested.band)}`,
      `id = ${tomlString(id)}`,
      `origin = ${tomlString(`${harvested.sourceRun} (${harvested.taskId}, seed ${harvested.sourceSeed})`)}`,
      `polarity = ${tomlString(harvested.polarity)}`,
      `reactBenchCommit = ${tomlString(reactBenchCommit)}`,
      "",
    ].join("\n")
  );
  writeFileSync(
    join(directory, "conversation.json"),
    `${JSON.stringify(harvested.conversation, null, 2)}\n`
  );
  writeFileSync(join(directory, "draft.md"), harvested.draft);
  writeFileSync(
    join(directory, "key", "answer.toml"),
    [
      `defectClass = ${tomlString(harvested.answer.defectClass)}`,
      ...(harvested.answer.findingId
        ? [`findingId = ${tomlString(harvested.answer.findingId)}`]
        : []),
      `reasonTokens = ${JSON.stringify(harvested.answer.reasonTokens)}`,
      `targetFile = ${tomlString(harvested.answer.targetFile)}`,
      `targetSymbol = ${tomlString(harvested.answer.targetSymbol)}`,
      "",
    ].join("\n")
  );
  writeFileSync(
    join(directory, "key", "traps.toml"),
    `choices = ${JSON.stringify(harvested.traps)}\n`
  );
  return directory;
};

export interface DiscriminationSummary {
  frontierNullCatchSpread: number;
  frontierOracleCatchSpread: number;
  harvested: boolean;
}

export const compareDiscrimination = (scores: {
  frontierCatchRate: number;
  nullCatchRate: number;
  oracleCatchRate: number;
  harvested: boolean;
}): DiscriminationSummary => ({
  frontierNullCatchSpread: scores.frontierCatchRate - scores.nullCatchRate,
  frontierOracleCatchSpread: scores.oracleCatchRate - scores.frontierCatchRate,
  harvested: scores.harvested,
});

export const reharvestNotice = (date: string) =>
  `Re-harvest due: ${requiredText(date, "date")}. Public answer keys are contamination-prone; compare harvested and authored corpora before retiring either.`;
