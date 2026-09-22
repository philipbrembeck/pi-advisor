import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { advisorModelWhitelistRef } from "../config/state.ts";

type AdvisorModelAccess =
  | { allowed: true; modelRef?: string }
  | { allowed: false; modelRef?: string; reason: string };

const currentModelRef = (
  ctx: Pick<ExtensionContext, "model">
): string | undefined => {
  const { model } = ctx;
  return model ? `${model.provider}/${model.id}` : undefined;
};

export const advisorModelAccess = (
  ctx: Pick<ExtensionContext, "model">
): AdvisorModelAccess => {
  const modelRef = currentModelRef(ctx);
  if (advisorModelWhitelistRef.length === 0) {
    return { allowed: true, ...(modelRef ? { modelRef } : {}) };
  }
  if (modelRef && advisorModelWhitelistRef.includes(modelRef)) {
    return { allowed: true, modelRef };
  }
  const current = modelRef ?? "no current model";
  return {
    allowed: false,
    ...(modelRef ? { modelRef } : {}),
    reason: `Advisor calls are restricted to the configured model whitelist (${advisorModelWhitelistRef.join(", ")}). Current model: ${current}.`,
  };
};

export const advisorModelIsAllowed = (
  ctx: Pick<ExtensionContext, "model">
): boolean => advisorModelAccess(ctx).allowed;

export const advisorModelAccessReason = (
  ctx: Pick<ExtensionContext, "model">
): string | undefined => {
  const access = advisorModelAccess(ctx);
  return access.allowed ? undefined : access.reason;
};
