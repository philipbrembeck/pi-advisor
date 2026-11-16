import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const ADVISOR_TOOL_NAMES = new Set(["ask_advisor", "record_advisor_outcome"]);

const ALL_ADVISOR_TOOL_NAMES = new Set([
  ...ADVISOR_TOOL_NAMES,
  "advisor_config",
]);

const CONFIGURATION_TOOL_NAME = new Set(["advisor_config"]);

const setToolsActive = (
  pi: Pick<ExtensionAPI, "getActiveTools" | "setActiveTools">,
  enabled: boolean,
  names: Set<string>
) => {
  const current = pi.getActiveTools();

  const next = current.filter((name) => enabled || !names.has(name));

  if (enabled) {
    for (const name of names) {
      if (!next.includes(name)) {
        next.push(name);
      }
    }
  }

  if (
    next.length !== current.length ||
    next.some((name, index) => name !== current[index])
  ) {
    pi.setActiveTools(next);
  }
};

export const setAdvisorToolsActive = (
  pi: Pick<ExtensionAPI, "getActiveTools" | "setActiveTools">,
  enabled: boolean,
  includeConfiguration = false
) =>
  setToolsActive(
    pi,
    enabled,
    includeConfiguration ? ALL_ADVISOR_TOOL_NAMES : ADVISOR_TOOL_NAMES
  );

export const enableAdvisorConfigurationTool = (
  pi: Pick<ExtensionAPI, "getActiveTools" | "setActiveTools">
) => setToolsActive(pi, true, CONFIGURATION_TOOL_NAME);
