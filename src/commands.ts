import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  advisorRef, advisorEffortRef, executorRef, executorEffortRef,
  setAdvisorRef, setAdvisorEffortRef, setExecutorRef, setExecutorEffortRef,
  loadConfig, saveConfig, parseArgs, splitRef,
} from "./config.js";
import { SearchableModelSelector } from "./ui.js";

const EFFORT_LEVELS = ["Default (Model Default)", "off", "minimal", "low", "medium", "high", "xhigh", "max"];

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

  pi.registerCommand("advisor-off", {
    description: "Disable on-demand Advisor calls; keep the current model",
    handler: async (_args, ctx) => {
      pi.setActiveTools(pi.getActiveTools().filter((name) => name !== "ask_advisor"));
      if (ctx.hasUI) ctx.ui.notify("Advisor flow disabled. Current model unchanged.", "info");
    },
  });
};
