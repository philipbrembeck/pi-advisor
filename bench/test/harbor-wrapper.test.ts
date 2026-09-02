import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import {
  buildHarborTrialArgs,
  DEFAULT_HARBOR_AGENT_TIMEOUT_SEC,
  HARBOR_INFRA_RETRY_BACKOFF_MS,
  type HarborTrialRequest,
  harborInfrastructureFailureCategory,
  harborTrialAttemptName,
  isPreAgentHarborInfrastructureFailure,
  MAX_HARBOR_INFRA_RETRIES,
  parseHarborAgentTimeout,
  parseHarborEnvironment,
  parseHarborTrialArgs,
  pruneDockerBuildCache,
  validateHarborArtifacts,
  validateHarborTrialPricing,
} from "../harbor/run-trial.js";
import {
  createHarborTaskOverlay,
  patchGitHubCloneCommands,
} from "../harbor/task-compat.js";

const requestFor = (arm: "E" | "E+A" = "E+A"): HarborTrialRequest => ({
  ...(arm === "E+A"
    ? {
        advisorEffort: "medium",
        advisorModel: "openai-codex/gpt-5.6-sol",
      }
    : {}),
  arm,
  artifactRoot: "/tmp/unused",
  executorEffort: "max",
  executorModel: "openai-codex/gpt-5.6-luna",
  pricing: {
    ...(arm === "E+A"
      ? {
          advisor: {
            cacheReadPerMillion: 1,
            cacheWritePerMillion: 1,
            inputPerMillion: 1,
            outputPerMillion: 1,
          },
        }
      : {}),
    executor: {
      cacheReadPerMillion: 1,
      cacheWritePerMillion: 1,
      inputPerMillion: 1,
      outputPerMillion: 1,
    },
  },
  seed: 101,
  taskPath: "/tmp/reactbench/tasks/example-task",
});

const usage = {
  cacheRead: 0,
  cacheWrite: 0,
  input: 10,
  output: 5,
  totalTokens: 15,
};

const makeArtifacts = (
  root: string,
  request: HarborTrialRequest,
  changes: (records: Record<string, unknown>[]) => void = () => {
    // Keep the default artifact set unchanged.
  },
  smokeProtocol = false
) => {
  const trialName = basename(root);
  const agent = join(root, "agent");
  const verifier = join(root, "verifier");
  mkdirSync(agent, { recursive: true });
  mkdirSync(verifier, { recursive: true });
  writeFileSync(join(agent, "pi.txt"), '{"type":"message_end"}\n');
  const advisor = request.arm === "E+A";
  const records: Record<string, unknown>[] = [
    {
      extension: "pi-advisor-flow",
      extensionVersion: "0.5.0",
      kind: "extension_loaded",
      loaded: true,
      mode: advisor ? "advisor" : "executor",
      smokeProtocol,
    },
    {
      adapter: "pi-advisor-harbor",
      advisorCalls: 0,
      extension: "pi-advisor-flow",
      extensionVersion: "0.5.0",
      kind: "attestation",
      loaded: true,
      mode: advisor ? "advisor" : "executor",
      shutdown: false,
      smokeProtocol,
    },
    {
      effort: request.executorEffort,
      kind: "request",
      model: request.executorModel,
      role: "executor",
      source: "before_provider_request",
    },
    {
      kind: "usage",
      model: request.executorModel,
      role: "executor",
      source: "message_end",
      usage,
    },
  ];
  if (advisor) {
    records.push(
      {
        effort: request.advisorEffort,
        kind: "request",
        model: request.advisorModel,
        role: "advisor",
        source: "ask_advisor_tool_result",
        usage,
      },
      {
        kind: "usage",
        model: request.advisorModel,
        role: "advisor",
        source: "ask_advisor_tool_result",
        usage,
      }
    );
  }
  records.push({
    adapter: "pi-advisor-harbor",
    advisorCalls: advisor ? 1 : 0,
    extension: "pi-advisor-flow",
    extensionVersion: "0.5.0",
    kind: "attestation",
    loaded: true,
    mode: advisor ? "advisor" : "executor",
    shutdown: true,
    smokeProtocol,
  });
  changes(records);
  writeFileSync(
    join(agent, "bench-records.jsonl"),
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`
  );
  writeFileSync(
    join(agent, "bench-attestation.json"),
    `${JSON.stringify(records.at(-1))}\n`
  );
  writeFileSync(
    join(verifier, "reward.json"),
    '{"reward":1,"tests":1,"react_doctor":1}\n'
  );
  writeFileSync(
    join(root, "result.json"),
    `${JSON.stringify({
      agent_info: {
        model_info: {
          name: "gpt-5.6-luna",
          provider: "openai-codex",
        },
      },
      config: { agent: { override_timeout_sec: 3600 } },
      exception_info: null,
      trial_name: trialName,
      verifier_result: { rewards: { reward: 1 } },
    })}\n`
  );
};

describe("Harbor trial wrapper protocol", () => {
  test("accepts only supported local Harbor runtimes", () => {
    expect(parseHarborEnvironment(undefined)).toBeUndefined();
    expect(parseHarborEnvironment("docker")).toBe("docker");
    expect(parseHarborEnvironment("apple-container")).toBe("apple-container");
    expect(() => parseHarborEnvironment("podman")).toThrow(
      "must be docker or apple-container"
    );
  });

  test("validates and pins the Harbor agent timeout", () => {
    expect(parseHarborAgentTimeout(undefined)).toBe(
      DEFAULT_HARBOR_AGENT_TIMEOUT_SEC
    );
    expect(parseHarborAgentTimeout("3600")).toBe(3600);
    expect(() => parseHarborAgentTimeout("0")).toThrow(
      "must be finite and between 1 and 7200"
    );
    expect(() => parseHarborAgentTimeout("7201")).toThrow(
      "must be finite and between 1 and 7200"
    );
    expect(() => parseHarborAgentTimeout("not-a-number")).toThrow(
      "must be finite and between 1 and 7200"
    );

    const args = buildHarborTrialArgs({
      artifactRoot: "/tmp/artifacts",
      codexBrokerToken: "trial-token",
      codexProxyUrl: "http://host.docker.internal:18765",
      extensionPath: join(process.cwd(), "extensions/index.ts"),
      extensionVersion: "0.5.0",
      harborBinary: "harbor",
      piVersion: "0.84.4",
      recorderPath: join(process.cwd(), "bench/harbor/recorder.ts"),
      request: requestFor("E"),
      trialName: "pi-advisor-example-E-101-timeout",
    });
    expect(
      args.slice(
        args.indexOf("--agent-timeout"),
        args.indexOf("--agent-timeout") + 2
      )
    ).toEqual(["--agent-timeout", "3600"]);
  });

  test("retries only recognized pre-agent Harbor infrastructure failures", () => {
    expect(MAX_HARBOR_INFRA_RETRIES).toBe(2);
    expect(HARBOR_INFRA_RETRY_BACKOFF_MS).toEqual([5000, 15_000]);
    expect(harborTrialAttemptName("trial", 0)).toBe("trial");
    expect(harborTrialAttemptName("trial", 1)).toBe("trial-retry-1");
    expect(harborTrialAttemptName("trial", 2)).toBe("trial-retry-2");

    const root = mkdtempSync(
      join(process.env.TMPDIR ?? "/tmp", "harbor-retry-allow-")
    );
    try {
      const buildFailure = Object.assign(new Error("Harbor trial failed"), {
        stderr:
          "Docker compose command failed: RPC failed; GnuTLS recv error; early EOF",
      });
      expect(harborInfrastructureFailureCategory(buildFailure)).toBe(
        "git-transport"
      );
      expect(isPreAgentHarborInfrastructureFailure(buildFailure, root)).toBe(
        true
      );

      mkdirSync(join(root, "agent"), { recursive: true });
      writeFileSync(join(root, "agent", "pi.txt"), "started\n");
      expect(isPreAgentHarborInfrastructureFailure(buildFailure, root)).toBe(
        false
      );

      rmSync(join(root, "agent", "pi.txt"));
      writeFileSync(
        join(root, "agent", "bench-records.jsonl"),
        '{"kind":"usage"}\n'
      );
      expect(isPreAgentHarborInfrastructureFailure(buildFailure, root)).toBe(
        false
      );
      expect(
        harborInfrastructureFailureCategory(new Error("agent failed"))
      ).toBeUndefined();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test("keeps pinned task sources clean while fixing GitHub build clones", () => {
    const root = mkdtempSync(
      join(process.env.TMPDIR ?? "/tmp", "harbor-task-")
    );
    const dockerfile = [
      "FROM example/base",
      "RUN rm -rf /app && git clone --filter=blob:none https://github.com/example/repo /app",
    ].join("\n");
    const untouched = "git clone https://gitlab.com/example/repo /other\n";
    try {
      mkdirSync(join(root, "environment"), { recursive: true });
      mkdirSync(join(root, "tests"), { recursive: true });
      writeFileSync(join(root, "environment", "Dockerfile"), dockerfile);
      writeFileSync(join(root, "tests", "Dockerfile"), untouched);
      const overlay = createHarborTaskOverlay(root);
      try {
        expect(overlay.taskPath).not.toBe(root);
        expect(overlay.patchedDockerfiles).toEqual(["environment/Dockerfile"]);
        expect(
          readFileSync(join(root, "environment", "Dockerfile"), "utf8")
        ).toBe(dockerfile);
        expect(
          readFileSync(
            join(overlay.taskPath, "environment", "Dockerfile"),
            "utf8"
          )
        ).toContain(
          "git -c protocol.version=1 -c http.version=HTTP/1.1 clone --filter=blob:none"
        );
        expect(
          readFileSync(join(overlay.taskPath, "tests", "Dockerfile"), "utf8")
        ).toBe(untouched);
      } finally {
        const overlayPath = overlay.taskPath;
        overlay.cleanup();
        expect(existsSync(overlayPath)).toBe(false);
        overlay.cleanup();
      }
    } finally {
      rmSync(root, { force: true, recursive: true });
    }

    expect(
      patchGitHubCloneCommands("FROM example/base\nRUN echo ready\n")
    ).toBe("FROM example/base\nRUN echo ready\n");
  });

  test("bounds optional Docker build-cache cleanup", async () => {
    const calls: [string, string[], { maxBuffer: number }][] = [];
    const run = (
      command: string,
      args: string[],
      options: { maxBuffer: number }
    ) => Promise.resolve(calls.push([command, args, options]));
    const previous = process.env.BENCH_HARBOR_PRUNE;
    delete process.env.BENCH_HARBOR_PRUNE;
    try {
      await pruneDockerBuildCache(undefined, { run });
      expect(calls).toHaveLength(0);
      await pruneDockerBuildCache("apple-container", { enabled: true, run });
      expect(calls).toHaveLength(0);
      await pruneDockerBuildCache("docker", { enabled: true, run });
      expect(calls).toEqual([
        [
          "docker",
          ["builder", "prune", "--all", "--force"],
          { maxBuffer: 4 * 1024 * 1024 },
        ],
      ]);
      await expect(
        pruneDockerBuildCache("docker", {
          enabled: true,
          run: () => Promise.reject(new Error("prune failed")),
        })
      ).resolves.toBeUndefined();
    } finally {
      if (previous === undefined) {
        delete process.env.BENCH_HARBOR_PRUNE;
      } else {
        process.env.BENCH_HARBOR_PRUNE = previous;
      }
    }
  });

  test("rejects different pricing for a shared executor/Advisor model", () => {
    const sameModel = requestFor("E+A");
    sameModel.advisorModel = sameModel.executorModel;
    sameModel.pricing = {
      advisor: {
        cacheReadPerMillion: 1,
        cacheWritePerMillion: 1,
        inputPerMillion: 1,
        outputPerMillion: 1,
      },
      executor: {
        cacheReadPerMillion: 1,
        cacheWritePerMillion: 1,
        inputPerMillion: 1,
        outputPerMillion: 2,
      },
    };
    expect(() => validateHarborTrialPricing(sameModel)).toThrow(
      "different trial pricing"
    );

    const executorPricing = sameModel.pricing.executor;
    if (!executorPricing) {
      throw new Error("test executor pricing is missing");
    }
    executorPricing.outputPerMillion = 1;
    expect(() => validateHarborTrialPricing(sameModel)).not.toThrow();

    sameModel.pricing.executor = {
      ...executorPricing,
      unexpected: 1,
    } as typeof executorPricing;
    expect(() => validateHarborTrialPricing(sameModel)).toThrow(
      "Invalid executor pricing"
    );
  });

  test("passes only the broker token and allows setup hosts", () => {
    const extensionPath = join(process.cwd(), "extensions/index.ts");
    const recorderPath = join(process.cwd(), "bench/harbor/recorder.ts");
    const request = { ...requestFor(), budgetUsd: 3 };
    const args = buildHarborTrialArgs({
      artifactRoot: "/tmp/artifacts",
      codexBrokerToken: "trial-token",
      codexProxyUrl: "http://host.docker.internal:18765",
      extensionPath,
      extensionVersion: "0.5.0",
      harborBinary: "harbor",
      piVersion: "0.84.4",
      recorderPath,
      request,
      trialName: "pi-advisor-example-E-A-101-test",
    });
    expect(args.join("\u0000")).toContain("codex_broker_token=trial-token");
    expect(args.join("\u0000")).toContain(
      "codex_proxy_url=http://host.docker.internal:18765"
    );
    expect(args.join("\u0000")).not.toContain("BENCH_API_KEY");
    expect(args.join("\u0000")).not.toContain("BENCH_BASE_URL");
    expect(args.join("\u0000")).not.toContain("smoke_protocol=true");
    expect(args.join("\u0000")).toContain("BENCH_SMOKE_PROTOCOL=false");
    expect(
      buildHarborTrialArgs({
        artifactRoot: "/tmp/artifacts",
        codexBrokerToken: "trial-token",
        codexProxyUrl: "http://host.docker.internal:18765",
        extensionPath,
        extensionVersion: "0.5.0",
        harborBinary: "harbor",
        piVersion: "0.84.4",
        recorderPath,
        request,
        smokeProtocol: true,
        trialName: "pi-advisor-example-E-A-101-smoke",
      }).join("\u0000")
    ).toContain("smoke_protocol=true");
    expect(
      buildHarborTrialArgs({
        artifactRoot: "/tmp/artifacts",
        codexBrokerToken: "trial-token",
        codexProxyUrl: "http://host.docker.internal:18765",
        extensionPath,
        extensionVersion: "0.5.0",
        harborBinary: "harbor",
        piVersion: "0.84.4",
        recorderPath,
        request,
        smokeProtocol: true,
        trialName: "pi-advisor-example-E-A-101-smoke",
      }).join("\u0000")
    ).toContain("BENCH_SMOKE_PROTOCOL=true");
    expect(args).toContain("--allow-environment-host");
    expect(args).toContain("registry.npmjs.org");
    const appleArgs = buildHarborTrialArgs({
      artifactRoot: "/tmp/artifacts",
      codexBrokerToken: "trial-token",
      codexProxyUrl: "http://host.docker.internal:18765",
      extensionPath,
      extensionVersion: "0.5.0",
      harborBinary: "harbor",
      harborEnvironment: "apple-container",
      piVersion: "0.84.4",
      recorderPath,
      request,
      trialName: "pi-advisor-example-E-A-101-apple",
    });
    expect(
      appleArgs.slice(
        appleArgs.indexOf("--env"),
        appleArgs.indexOf("--env") + 2
      )
    ).toEqual(["--env", "apple-container"]);
    const mounts = JSON.parse(
      args[args.indexOf("--mounts") + 1] ?? "null"
    ) as Record<string, unknown>[];
    expect(mounts).toContainEqual({
      read_only: true,
      source: recorderPath,
      target: "/bench-source/bench/harbor/recorder.ts",
      type: "bind",
    });
    expect(mounts).not.toContainEqual(
      expect.objectContaining({ target: expect.stringContaining("proxy") })
    );
  });

  test("forwards and parses seed, both pins, and pricing", () => {
    const parsed = parseHarborTrialArgs([
      "--task",
      "/tmp/task",
      "--seed",
      "101",
      "--arm",
      "E+A",
      "--budget-usd",
      "3",
      "--executor-model",
      "openai-codex/gpt-5.6-luna",
      "--executor-effort",
      "max",
      "--advisor-model",
      "openai-codex/gpt-5.6-sol",
      "--advisor-effort",
      "medium",
      "--artifact-root",
      "/tmp/artifacts",
      "--pricing-json",
      JSON.stringify({ executor: requestFor().pricing?.executor }),
    ]);
    expect(parsed.seed).toBe(101);
    expect(parsed.arm).toBe("E+A");
    expect(parsed.budgetUsd).toBe(3);
    expect(parsed.advisorModel).toBe("openai-codex/gpt-5.6-sol");
    expect(parsed.pricing?.executor?.inputPerMillion).toBe(1);
  });

  test("accepts a complete E+A artifact set and computes cost", () => {
    const root = mkdtempSync(join(process.env.TMPDIR ?? "/tmp", "harbor-ok-"));
    try {
      makeArtifacts(root, requestFor());
      const result = validateHarborArtifacts(root, requestFor(), "0.5.0");
      expect(result.passed).toBe(true);
      expect(result.consultations).toBe(1);
      expect(result.requests).toHaveLength(2);
      expect(
        validateHarborArtifacts(root, requestFor(), "0.5.0", {
          agentTimeoutSec: 3600,
        }).passed
      ).toBe(true);
      expect(() =>
        validateHarborArtifacts(root, requestFor(), "0.5.0", {
          agentTimeoutSec: 1800,
        })
      ).toThrow("pinned agent timeout");
      expect(result.cost).toBeGreaterThan(0);

      const smokeRoot = mkdtempSync(
        join(process.env.TMPDIR ?? "/tmp", "harbor-smoke-")
      );
      try {
        makeArtifacts(smokeRoot, requestFor(), undefined, true);
        const smokeResult = validateHarborArtifacts(
          smokeRoot,
          requestFor(),
          "0.5.0",
          { smokeProtocol: true }
        );
        expect(smokeResult.attestation.smokeProtocol).toBe(true);

        const zeroSmokeRoot = mkdtempSync(
          join(process.env.TMPDIR ?? "/tmp", "harbor-smoke-zero-")
        );
        try {
          makeArtifacts(
            zeroSmokeRoot,
            requestFor(),
            (records) => {
              const advisorRequestIndex = records.findIndex(
                (record) =>
                  record.kind === "request" && record.role === "advisor"
              );
              if (advisorRequestIndex >= 0) {
                records.splice(advisorRequestIndex, 2);
              }
              const final = records.at(-1);
              if (final) {
                final.advisorCalls = 0;
              }
            },
            true
          );
          expect(() =>
            validateHarborArtifacts(zeroSmokeRoot, requestFor(), "0.5.0", {
              smokeProtocol: true,
            })
          ).toThrow("bounded consultation count");
        } finally {
          rmSync(zeroSmokeRoot, { force: true, recursive: true });
        }
      } finally {
        rmSync(smokeRoot, { force: true, recursive: true });
      }
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test("fails closed for missing trajectory, grader, usage, and attestation", () => {
    const cases = [
      ["trajectory", (root: string) => rmSync(join(root, "agent", "pi.txt"))],
      [
        "grader",
        (root: string) => rmSync(join(root, "verifier", "reward.json")),
      ],
      [
        "usage",
        (root: string) => {
          const path = join(root, "agent", "bench-records.jsonl");
          const lines = readFileSync(path, "utf8").split("\n");
          writeFileSync(
            path,
            `${lines.filter((line: string) => !line.includes('"kind":"usage"')).join("\n")}`
          );
        },
      ],
      [
        "shutdown",
        (root: string) => {
          const path = join(root, "agent", "bench-attestation.json");
          const value = JSON.parse(readFileSync(path, "utf8"));
          value.shutdown = false;
          writeFileSync(path, JSON.stringify(value));
        },
      ],
    ] as const;
    for (const [label, change] of cases) {
      const root = mkdtempSync(
        join(process.env.TMPDIR ?? "/tmp", `harbor-${label}-`)
      );
      try {
        makeArtifacts(root, requestFor());
        change(root);
        expect(() =>
          validateHarborArtifacts(root, requestFor(), "0.5.0")
        ).toThrow();
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    }
  });

  test("rejects wrong extension versions and allows zero consultations", () => {
    const root = mkdtempSync(join(process.env.TMPDIR ?? "/tmp", "harbor-pin-"));
    try {
      makeArtifacts(root, requestFor());
      expect(() =>
        validateHarborArtifacts(root, requestFor(), "0.6.0")
      ).toThrow("pinned extension");

      const zeroRoot = mkdtempSync(
        join(process.env.TMPDIR ?? "/tmp", "harbor-zero-")
      );
      try {
        makeArtifacts(zeroRoot, requestFor(), (records) => {
          const advisorRequestIndex = records.findIndex(
            (record) => record.kind === "request" && record.role === "advisor"
          );
          if (advisorRequestIndex >= 0) {
            records.splice(advisorRequestIndex, 2);
          }
          const final = records.at(-1);
          if (final) {
            final.advisorCalls = 0;
          }
        });
        const result = validateHarborArtifacts(zeroRoot, requestFor(), "0.5.0");
        expect(result.consultations).toBe(0);
        expect(result.cost).toBeGreaterThan(0);
      } finally {
        rmSync(zeroRoot, { force: true, recursive: true });
      }

      const mismatchRoot = mkdtempSync(
        join(process.env.TMPDIR ?? "/tmp", "harbor-mismatch-")
      );
      try {
        makeArtifacts(mismatchRoot, requestFor(), (records) => {
          const final = records.at(-1);
          if (final) {
            final.advisorCalls = 0;
          }
        });
        expect(() =>
          validateHarborArtifacts(mismatchRoot, requestFor(), "0.5.0")
        ).toThrow("does not match recorded Advisor requests");
      } finally {
        rmSync(mismatchRoot, { force: true, recursive: true });
      }
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test("rejects extra roles and wrong request pins", () => {
    for (const change of [
      (records: Record<string, unknown>[]) =>
        records.push({
          effort: "medium",
          kind: "request",
          model: "openai-codex/gpt-5.6-sol",
          role: "judge",
          source: "before_provider_request",
          usage,
        }),
      (records: Record<string, unknown>[]) => {
        const requestRecord = records.find(
          (record) => record.kind === "request"
        );
        if (requestRecord) {
          requestRecord.effort = "low";
        }
      },
    ]) {
      const root = mkdtempSync(
        join(process.env.TMPDIR ?? "/tmp", "harbor-extra-")
      );
      try {
        makeArtifacts(root, requestFor("E"), change);
        expect(() =>
          validateHarborArtifacts(root, requestFor("E"), "0.5.0")
        ).toThrow();
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    }
  });
});
