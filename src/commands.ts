import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  advisorCollapseResponsesRef, advisorCompletionGateRef, advisorCustomInvocationRef, advisorFailureGateRef, advisorPlanGateRef,
  advisorRef, advisorEffortRef, executorRef, executorEffortRef,
  setAdvisorCollapseResponsesRef, setAdvisorCompletionGateRef, setAdvisorCustomInvocationRef, setAdvisorFailureGateRef, setAdvisorPlanGateRef,
  setAdvisorRef, setAdvisorEffortRef, setContextMaxCharsRef, setExecutorRef, setExecutorEffortRef,
  contextMaxCharsRef, loadConfig, saveConfig, parseArgs, splitRef,
} from "./config.js";
import { AdvisorSettingsSelector, SearchableModelSelector, type AdvisorSettings, type ContextPreset } from "./ui.js";

const EFFORT_LEVELS = ["Default (Model Default)", "off", "minimal", "low", "medium", "high", "xhigh", "max"];

const CONTEXT_PRESETS: ContextPreset[] = [
  { label: "0", value: 0, description: "No conversation history. The Advisor receives only its standing instructions." },
  { label: "10k", value: 10_000, description: "The most recent 10,000 characters of the current branch." },
  { label: "25k", value: 25_000, description: "The most recent 25,000 characters of the current branch." },
  { label: "100k", value: 100_000, description: "The most recent 100,000 characters of the current branch." },
  { label: "200k", value: 200_000, description: "The most recent 200,000 characters of the current branch." },
  { label: "ALL", value: Number.MAX_SAFE_INTEGER, description: "The complete reconstructed conversation branch. Cost and model context limits apply." },
];

export const registerCommands = (pi: ExtensionAPI) => {
  const flowEnabled = () => pi.getActiveTools().includes("ask_advisor");

  pi.registerCommand("advisor", {
    description: "Enable the Executor/Advisor flow and switch to the configured Executor model; accepts contextMaxChars=N",
    handler: async (args, ctx) => {
      loadConfig(ctx);
      const argumentError = parseArgs(args);
      if (argumentError) {
        if (ctx.hasUI) ctx.ui.notify(argumentError, "error");
        return;
      }
      const [provider, modelId] = splitRef(executorRef);
      const executor = ctx.modelRegistry.find(provider, modelId);
      if (!executor) return ctx.hasUI ? ctx.ui.notify(`Executor model not found: ${executorRef}`, "error") : undefined;
      const [ap, am] = splitRef(advisorRef);
      if (!ctx.modelRegistry.find(ap, am)) return ctx.hasUI ? ctx.ui.notify(`Advisor model not found: ${advisorRef}`, "error") : undefined;
      if (!(await pi.setModel(executor))) return ctx.hasUI ? ctx.ui.notify(`No API key for Executor ${executorRef}`, "error") : undefined;
      if (executorEffortRef) pi.setThinkingLevel(executorEffortRef as any);
      if (!flowEnabled()) pi.setActiveTools([...pi.getActiveTools(), "ask_advisor"]);
      if (ctx.hasUI) ctx.ui.notify(`Advisor flow ready — Executor: ${executorRef} (thinking: ${executorEffortRef || "default"}) · Advisor: ${advisorRef} (thinking: ${advisorEffortRef || "default"})`, "info");
    },
  });

  pi.registerCommand("advisor-models", {
    description: "Select and persist the Executor and Advisor models with reasoning levels",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) return;
      const refs = ctx.modelRegistry.getAvailable().map((m) => `${m.provider}/${m.id}`);

      const executor = await ctx.ui.custom<string | undefined>((tui, theme, keybindings, done) =>
        new SearchableModelSelector({ tui, title: "Select Executor Model", allOptions: refs, theme, keybindings, onSelect: done, onCancel: () => done(undefined) })
      );
      if (!executor) return;

      const executorEffort = await ctx.ui.select("Select Executor Reasoning/Thinking Level", EFFORT_LEVELS);
      if (!executorEffort) return;

      const advisor = await ctx.ui.custom<string | undefined>((tui, theme, keybindings, done) =>
        new SearchableModelSelector({ tui, title: "Select Advisor Model", allOptions: refs, theme, keybindings, onSelect: done, onCancel: () => done(undefined) })
      );
      if (!advisor) return;

      const advisorEffort = await ctx.ui.select("Select Advisor Reasoning/Thinking Level", EFFORT_LEVELS);
      if (!advisorEffort) return;

      setExecutorRef(executor);
      setAdvisorRef(advisor);
      setExecutorEffortRef(executorEffort === "Default (Model Default)" ? undefined : executorEffort);
      setAdvisorEffortRef(advisorEffort === "Default (Model Default)" ? undefined : advisorEffort);

      const path = saveConfig(ctx);
      ctx.ui.notify(`Saved Executor + Advisor configurations to ${path}`, "info");
    },
  });

  pi.registerCommand("advisor-settings", {
    description: "Configure Advisor context and reasoning effort",
    handler: async (_args, ctx) => {
      loadConfig(ctx);
      if (!ctx.hasUI) return;

      const initial: AdvisorSettings = {
        contextMaxChars: contextMaxCharsRef,
        effort: advisorEffortRef,
        planGate: advisorPlanGateRef,
        failureGate: advisorFailureGateRef,
        completionGate: advisorCompletionGateRef,
        collapseResponses: advisorCollapseResponsesRef,
        customRule: advisorCustomInvocationRef,
      };
      const settings = await ctx.ui.custom<AdvisorSettings | undefined>((tui, theme, _keybindings, done) =>
        new AdvisorSettingsSelector({
          tui,
          theme,
          presets: CONTEXT_PRESETS,
          effortLevels: EFFORT_LEVELS,
          initial,
          onSave: done,
          onCancel: () => done(undefined),
        })
      );
      if (!settings) return;

      setAdvisorEffortRef(settings.effort === "Default (Model Default)" ? undefined : settings.effort);
      setContextMaxCharsRef(settings.contextMaxChars);
      setAdvisorPlanGateRef(settings.planGate);
      setAdvisorFailureGateRef(settings.failureGate);
      setAdvisorCompletionGateRef(settings.completionGate);
      setAdvisorCollapseResponsesRef(settings.collapseResponses);
      setAdvisorCustomInvocationRef(settings.customRule);
      const path = saveConfig(ctx);
      ctx.ui.notify(`Saved Advisor settings to ${path}`, "info");
    },
  });

  pi.registerCommand("advisor-off", {
    description: "Disable on-demand Advisor calls; keep the current model",
    handler: async (_args, ctx) => {
      pi.setActiveTools(pi.getActiveTools().filter((name) => name !== "ask_advisor"));
      if (ctx.hasUI) ctx.ui.notify("Advisor flow disabled. Current model unchanged.", "info");
    },
  });
};
