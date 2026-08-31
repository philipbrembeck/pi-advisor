/* biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: the recorder keeps provider, Scout, attestation, and shutdown evidence together. */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const RECORDS_PATH = "/logs/agent/bench-records.jsonl";
const ATTESTATION_PATH = "/logs/agent/bench-attestation.json";
const ADAPTER_ID = "pi-advisor-harbor";
const EXTENSION_ID = "pi-advisor-flow";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const environmentValue = (name: string) => {
  const value = process.env[name]?.trim();
  return value || undefined;
};

const modelId = (ref: string | undefined) => {
  if (!ref) {
    return;
  }
  const separator = ref.indexOf("/");
  return separator === -1 ? ref : ref.slice(separator + 1);
};

const modelRefForPayload = (
  payloadModel: string | undefined,
  contextModel: { id?: unknown; provider?: unknown } | undefined
) => {
  if (!payloadModel) {
    return;
  }
  if (payloadModel.includes("/")) {
    return payloadModel;
  }
  const executor = environmentValue("BENCH_EXECUTOR_MODEL");
  const advisor = environmentValue("BENCH_ADVISOR_MODEL");
  if (payloadModel === modelId(executor)) {
    return executor;
  }
  if (payloadModel === modelId(advisor)) {
    return advisor;
  }
  if (
    typeof contextModel?.provider === "string" &&
    contextModel.provider.trim()
  ) {
    return `${contextModel.provider}/${payloadModel}`;
  }
  return payloadModel;
};

const effortFromPayload = (payload: Record<string, unknown>) => {
  if (typeof payload.reasoning_effort === "string") {
    return payload.reasoning_effort;
  }
  if (isRecord(payload.reasoning)) {
    return typeof payload.reasoning.effort === "string"
      ? payload.reasoning.effort
      : undefined;
  }
  if (typeof payload.thinking === "string") {
    return payload.thinking;
  }
};

const appendRecord = (record: Record<string, unknown>) => {
  mkdirSync("/logs/agent", { recursive: true });
  appendFileSync(RECORDS_PATH, `${JSON.stringify(record)}\n`, "utf8");
};

const readUsage = (value: unknown) => (isRecord(value) ? value : undefined);

export default function (pi: ExtensionAPI) {
  let advisorCalls = 0;
  const mode = environmentValue("BENCH_ADAPTER_MODE");
  const extensionVersion = environmentValue("BENCH_PI_ADVISOR_VERSION");

  const writeAttestation = (shutdown: boolean) => {
    const attestation = {
      adapter: ADAPTER_ID,
      advisorCalls,
      extension: EXTENSION_ID,
      extensionVersion,
      loaded: true,
      mode,
      shutdown,
    };
    mkdirSync("/logs/agent", { recursive: true });
    writeFileSync(ATTESTATION_PATH, `${JSON.stringify(attestation)}\n`, "utf8");
    appendRecord({ kind: "attestation", ...attestation });
  };

  writeAttestation(false);
  appendRecord({
    extension: EXTENSION_ID,
    extensionVersion,
    kind: "extension_loaded",
    loaded: true,
    mode,
  });

  pi.on("before_provider_request", (event, ctx) => {
    const payload = isRecord(event.payload) ? event.payload : {};
    const payloadModel =
      typeof payload.model === "string" ? payload.model : undefined;
    const contextModel = isRecord(ctx.model) ? ctx.model : undefined;
    const contextModelId =
      typeof contextModel?.id === "string" ? contextModel.id : undefined;
    const model = modelRefForPayload(
      payloadModel ?? contextModelId,
      contextModel
    );
    appendRecord({
      effort: effortFromPayload(payload),
      kind: "request",
      model,
      provider:
        typeof contextModel?.provider === "string"
          ? contextModel.provider
          : undefined,
      role: "executor",
      source: "before_provider_request",
    });
  });

  pi.on("message_end", (event) => {
    if (!isRecord(event.message) || event.message.role !== "assistant") {
      return;
    }
    const provider =
      typeof event.message.provider === "string"
        ? event.message.provider
        : undefined;
    const model =
      typeof event.message.model === "string" && provider
        ? `${provider}/${event.message.model}`
        : undefined;
    appendRecord({
      kind: "usage",
      model,
      role: "executor",
      source: "message_end",
      usage: readUsage(event.message.usage),
    });
  });

  pi.on("tool_execution_end", (event) => {
    if (event.toolName !== "ask_advisor") {
      return;
    }
    advisorCalls += 1;
    const result = isRecord(event.result) ? event.result : {};
    const details = isRecord(result.details) ? result.details : {};
    const model =
      typeof details.advisor === "string"
        ? details.advisor
        : environmentValue("BENCH_ADVISOR_MODEL");
    const usage = readUsage(result.usage ?? details.usage);
    appendRecord({
      effort: environmentValue("BENCH_ADVISOR_EFFORT"),
      kind: "request",
      model,
      role: "advisor",
      source: "ask_advisor_tool_result",
      usage,
    });
    appendRecord({
      kind: "usage",
      model,
      role: "advisor",
      source: "ask_advisor_tool_result",
      usage,
    });

    // Scout calls use pi-ai directly and therefore do not pass through
    // before_provider_request.  The final ask_advisor details contain the
    // Scout's model, status, and usage; record that call explicitly so the
    // wrapper can reject both unpriced Scout work and unexpected extra calls.
    const scout = isRecord(details.scout) ? details.scout : undefined;
    const scoutStatus = typeof scout?.status === "string" ? scout.status : "";
    const fallbackReason =
      typeof scout?.fallbackReason === "string" ? scout.fallbackReason : "";
    const scoutCalled =
      scout &&
      ["curated", "fallback", "cancelled"].includes(scoutStatus) &&
      !fallbackReason.startsWith("missing-model:");
    if (scoutCalled) {
      const scoutModel =
        typeof scout.model === "string"
          ? scout.model
          : environmentValue("BENCH_EXECUTOR_MODEL");
      const scoutUsage = readUsage(scout.usage);
      appendRecord({
        effort: environmentValue("BENCH_EXECUTOR_EFFORT"),
        kind: "request",
        model: scoutModel,
        role: "executor",
        source: "advisor_scout",
        status: scoutStatus,
        usage: scoutUsage,
      });
      appendRecord({
        kind: "usage",
        model: scoutModel,
        role: "executor",
        source: "advisor_scout",
        usage: scoutUsage,
      });
    }
  });

  pi.on("session_shutdown", () => {
    writeAttestation(true);
  });
}
