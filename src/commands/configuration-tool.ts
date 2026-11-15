import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

import { readGlobalAdvisorConfig } from "../config/storage.ts";
import { textFrom } from "../conversation.ts";
import type { SelectAdvisorModels } from "./configuration-tool-models.ts";
import { getAdvisorConfigForAgent } from "./configuration-tool-policy.ts";
import { executeAdvisorConfigUpdate } from "./configuration-tool-update.ts";
import type { CommandRuntime } from "./types.ts";

const CONFIGURATION_VALUE = Type.Union([
  Type.String(),
  Type.Number(),
  Type.Boolean(),
  Type.Null(),
  Type.Array(Type.String()),
  Type.Record(Type.String(), Type.String()),
]);

const CONFIGURATION_TOOL_PARAMETERS = Type.Object(
  {
    action: Type.String({ enum: ["read", "update"] }),
    changes: Type.Optional(Type.Record(Type.String(), CONFIGURATION_VALUE)),
  },
  { additionalProperties: false }
);

const readCurrentConfig = (ctx: ExtensionContext) => {
  const config = getAdvisorConfigForAgent(readGlobalAdvisorConfig());

  const currentSessionModel = ctx.model
    ? `${ctx.model.provider}/${ctx.model.id}`
    : null;

  return {
    ...config,
    currentSessionModel,
    scope: "global",
  };
};

export interface AdvisorConfigurationToolDependencies {
  selectModels?: SelectAdvisorModels;
}

export const registerAdvisorConfigurationTool = (
  runtime: CommandRuntime,
  dependencies: AdvisorConfigurationToolDependencies = {}
) => {
  runtime.pi.registerTool({
    description:
      "Read or update pi-advisor settings at the user's request. Start with action=read to inspect current effective settings, persisted global overrides, and writable keys. For action=update, pass a sparse changes object using exact keys from writableKeys; use null to remove a saved override and restore the extension default. Every changing update previews global old-to-new values and requires user confirmation. Model settings open the existing interactive model picker; supplied model strings are proposed selections, not approval. Jev classifier/credential setup must use /advisor-settings, and outcome logging must be changed by itself through its dedicated consent path.",
    async execute(_id, params, signal, _onUpdate, ctx) {
      if (params.action === "read") {
        if (params.changes) {
          throw new Error("Do not pass changes with action=read.");
        }

        const settings = readCurrentConfig(ctx);

        return {
          content: [{ text: JSON.stringify(settings, null, 2), type: "text" }],
          details: { action: "read", applied: false, settings },
        };
      }

      return await executeAdvisorConfigUpdate(
        runtime,
        ctx,
        params.changes,
        signal,
        dependencies.selectModels
      );
    },
    executionMode: "sequential",
    label: "Configure Advisor",
    name: "advisor_config",
    parameters: CONFIGURATION_TOOL_PARAMETERS,
    promptGuidelines: [
      "Use advisor_config when the user asks to inspect or change pi-advisor settings. Read before updates when the current value affects the requested outcome.",
      "Send only settings the user asked to change. advisor_config asks for confirmation before writing and preserves unrelated settings; do not edit advisor.json directly.",
      "Wait for advisor_config to report a successful update before saying a setting changed. Use /advisor-settings for Jev classifier/credential setup.",
    ],
    promptSnippet: "Read or change the user's pi-advisor configuration",
    renderCall: () => new Text("[advisor] Configure settings", 0, 0),
    renderResult: (result) => new Text(textFrom(result.content), 0, 0),
  });
};
