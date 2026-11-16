import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
  setAdvisorEffortRef,
  setAdvisorFallbackModelRef,
  setAdvisorRef,
  setContextMaxCharsRef,
  setExecutorEffortRef,
  setExecutorRef,
} from "./state.ts";

export interface SessionActivationValues {
  advisor: string;
  advisorEffort: string | undefined;
  advisorFallbackModel: string | undefined;
  contextMaxChars: number;
  executor: string;
  executorEffort: string | undefined;
}

export const SESSION_ACTIVATION_KEYS = [
  "advisor",
  "advisorEffort",
  "advisorFallbackModel",
  "contextMaxChars",
  "executor",
  "executorEffort",
] as const satisfies readonly (keyof SessionActivationValues)[];

const overrides = new WeakMap<object, Partial<SessionActivationValues>>();

const sessionKey = (ctx: ExtensionContext): object => ctx.sessionManager ?? ctx;

export const getSessionActivationOverrides = (ctx: ExtensionContext) =>
  overrides.get(sessionKey(ctx));

export const applySessionActivationOverrides = (ctx: ExtensionContext) => {
  const values = getSessionActivationOverrides(ctx);

  if (!values) {
    return;
  }

  if (Object.hasOwn(values, "advisor")) {
    setAdvisorRef(values.advisor ?? "");
  }

  if (Object.hasOwn(values, "advisorEffort")) {
    setAdvisorEffortRef(values.advisorEffort);
  }

  if (Object.hasOwn(values, "advisorFallbackModel")) {
    setAdvisorFallbackModelRef(values.advisorFallbackModel);
  }

  if (values.contextMaxChars !== undefined) {
    setContextMaxCharsRef(values.contextMaxChars);
  }

  if (Object.hasOwn(values, "executor")) {
    setExecutorRef(values.executor ?? "");
  }

  if (Object.hasOwn(values, "executorEffort")) {
    setExecutorEffortRef(values.executorEffort);
  }
};

export const rememberSessionActivationOverrides = (
  ctx: ExtensionContext,
  previous: SessionActivationValues,
  current: SessionActivationValues
) => {
  const next = { ...getSessionActivationOverrides(ctx) };

  for (const key of SESSION_ACTIVATION_KEYS) {
    if (previous[key] !== current[key]) {
      Object.assign(next, { [key]: current[key] });
    }
  }

  if (Object.keys(next).length > 0) {
    overrides.set(sessionKey(ctx), next);
  }
};

export const clearSessionActivationOverrides = (
  ctx: ExtensionContext,
  keys: readonly (keyof SessionActivationValues)[] = SESSION_ACTIVATION_KEYS
) => {
  const key = sessionKey(ctx);
  const existing = overrides.get(key);

  if (!existing) {
    return;
  }

  const remaining = { ...existing };

  for (const name of keys) {
    Reflect.deleteProperty(remaining, name);
  }

  if (Object.keys(remaining).length === 0) {
    overrides.delete(key);
  } else {
    overrides.set(key, remaining);
  }
};
