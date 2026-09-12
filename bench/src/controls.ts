import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { nullAdvice } from "./arms/null.ts";
import { oracleAdvice } from "./arms/oracle.ts";
import { mechanicalPositiveCatch } from "./score/mechanical.ts";

import type {
  DecisionItem,
  DecisionKey,
  DecisionPolarity,
  DecisionScore,
  DecisionTrap,
} from "./types.ts";

interface ControlFile {
  id: string;
  key: DecisionKey;
  polarity: DecisionPolarity;
  traps: DecisionTrap[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const readControls = (root: string): DecisionItem[] =>
  readdirSync(resolve(root))
    .sort()
    .map((name) => join(resolve(root), name))
    .filter((path) => path.endsWith(".json"))
    .map((path) => {
      const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
      if (!isRecord(value)) {
        throw new TypeError(`${path} must contain an object.`);
      }
      if (
        typeof value.id !== "string" ||
        (value.polarity !== "positive" && value.polarity !== "negative") ||
        !isRecord(value.key) ||
        !Array.isArray(value.traps)
      ) {
        throw new TypeError(`${path} is not a valid control fixture.`);
      }
      const file = value as unknown as ControlFile;
      return {
        conversation: "Control fixture evidence.",
        draft: "Review the supplied direction.",
        id: file.id,
        key: file.key,
        polarity: file.polarity,
        provenance: { origin: "pi-advisor control fixture" },
        repoPath: resolve(root),
        traps: file.traps,
      };
    });

const includesToken = (text: string, token: string) =>
  text.toLocaleLowerCase().includes(token.toLocaleLowerCase());

/** Deterministic control judge used before the live judge exists. */
export const controlJudge = (item: DecisionItem, advice: string) => {
  if (item.polarity === "positive") {
    return (
      mechanicalPositiveCatch(item, advice) &&
      item.key.reasonTokens.every((token) => includesToken(advice, token))
    );
  }
  return !item.traps.some((trap) =>
    trap.tokens.some((token) => includesToken(advice, token))
  );
};

export const scoreControl = (
  item: DecisionItem,
  arm: "null" | "oracle",
  advice: string
): DecisionScore => {
  const mechanical =
    item.polarity === "positive" ? mechanicalPositiveCatch(item, advice) : null;
  const judgePass = controlJudge(item, advice);
  return {
    arm,
    caught: item.polarity === "positive" && judgePass,
    falseAlarm: item.polarity === "negative" && !judgePass,
    itemId: item.id,
    judge: judgePass,
    judgeAvailable: true,
    mechanical,
    ...(item.polarity === "negative"
      ? {
          justification: judgePass
            ? "No trap was flagged."
            : "A known trap was flagged.",
        }
      : {
          justification: judgePass
            ? "Keyed defect was identified."
            : "No keyed defect was identified.",
        }),
  };
};

export interface ControlRunResult {
  controls: NonNullable<import("./types.js").BenchmarkReport["controls"]>;
  scores: DecisionScore[];
}

export const runControls = (
  root: string,
  adviceFor: (arm: "null" | "oracle", item: DecisionItem) => string
): ControlRunResult => {
  const items = readControls(root);
  if (
    items.filter((item) => item.polarity === "positive").length === 0 ||
    items.filter((item) => item.polarity === "negative").length === 0
  ) {
    throw new Error(
      "Control run requires both positive and negative fixtures."
    );
  }
  const scores = (["null", "oracle"] as const).flatMap((arm) =>
    items.map((item) => scoreControl(item, arm, adviceFor(arm, item)))
  );
  const rate = (
    arm: "null" | "oracle",
    polarity: DecisionPolarity,
    field: "caught" | "falseAlarm"
  ) => {
    const selected = scores.filter(
      (score) =>
        score.arm === arm &&
        items.find((item) => item.id === score.itemId)?.polarity === polarity
    );
    return selected.length
      ? selected.filter((score) => score[field]).length / selected.length
      : 0;
  };
  const controls = {
    invalid:
      rate("null", "positive", "caught") > 0.2 ||
      rate("oracle", "positive", "caught") < 0.9 ||
      rate("oracle", "negative", "falseAlarm") > 0.1,
    nullCatchRate: rate("null", "positive", "caught"),
    oracleCatchRate: rate("oracle", "positive", "caught"),
    oracleFalseAlarmRate: rate("oracle", "negative", "falseAlarm"),
  };
  return { controls, scores };
};

export const defaultControlAdvice = (
  arm: "null" | "oracle",
  item: DecisionItem
) => (arm === "null" ? nullAdvice(item) : oracleAdvice(item));
