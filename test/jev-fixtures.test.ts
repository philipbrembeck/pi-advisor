import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { setAdvisorRedactSecretsRef } from "../src/config/state.ts";
import { JevClient } from "../src/jev/client.ts";
import { composeScreeningVerdict } from "../src/jev/questions.ts";
import { buildJevState } from "../src/jev/state.ts";
import { branchFromLines, systemOneMock } from "./helpers/jev-mock.ts";

const ONLY_Q = /^q+$/u;
const FIXTURE_DIR = resolve("test/fixtures/jev");
const PRIVACY_CANARY = "super-secret-replay-token";

interface ScreeningFixture {
  conversation?: [string, string][];
  draft?: string;
  expected: "allow" | "skip";
  name: string;
  question?: string;
  response: unknown;
}

const fixtureFiles = () =>
  readdirSync(FIXTURE_DIR)
    .filter((name) => name.endsWith(".json"))
    .toSorted()
    .map((name) => ({
      fixture: JSON.parse(
        readFileSync(join(FIXTURE_DIR, name), "utf-8")
      ) as ScreeningFixture,
      name,
    }));

describe("Jev screening fixtures", () => {
  test("every fixture passes the real pipeline with zero false skips", async () => {
    setAdvisorRedactSecretsRef(true);
    try {
      for (const { fixture, name } of fixtureFiles()) {
        const conversation: [string, string][] = [
          ...(fixture.conversation ?? []),
          ["user", `Scratch note: api_key: ${PRIVACY_CANARY}`],
        ];
        const ctx = {
          cwd: "/",
          hasUI: false,
          isProjectTrusted: () => false,
          sessionManager: { getBranch: () => branchFromLines(conversation) },
        } as unknown as ExtensionContext;
        const state = buildJevState(ctx, {
          draft: fixture.draft,
          question: fixture.question,
        });
        const mock = systemOneMock([fixture.response]);
        const client = new JevClient({
          apiKey: "tsk-fixture-key",
          fetch: mock.fetch,
          model: "jev-latest",
          timeoutMs: 5000,
          transport: "typesafe",
        });
        // biome-ignore lint/performance/noAwaitInLoops: fixtures replay serially by design.
        const result = await client.ask(state, {
          self_answerable: { type: "noul" },
          stakes: { criteria: ["a", "b", "c"], type: "score" },
        });
        const verdict = composeScreeningVerdict(result.answers, {
          noulMargin: 0.35,
          skipConfidence: 0.85,
        });
        expect(verdict.skip, `${name}: expected ${fixture.expected}`).toBe(
          fixture.expected === "skip"
        );
        const wire = JSON.stringify(mock.captured);
        expect(wire, `${name}: privacy canary leaked`).not.toContain(
          PRIVACY_CANARY
        );
      }
    } finally {
      setAdvisorRedactSecretsRef(false);
    }
  });

  test("question and draft are capped in the outbound state", () => {
    const ctx = {
      cwd: "/",
      hasUI: false,
      isProjectTrusted: () => false,
      sessionManager: { getBranch: () => [] },
    } as unknown as ExtensionContext;
    const state = buildJevState(ctx, {
      draft: "d".repeat(20 * 1024),
      question: "q".repeat(20 * 1024),
    });
    expect(String(state.executor_question).length).toBeLessThanOrEqual(
      8 * 1024
    );
    expect(String(state.executor_draft).length).toBeLessThanOrEqual(8 * 1024);
    expect(ONLY_Q.test(String(state.executor_question))).toBe(true);
  });
});
