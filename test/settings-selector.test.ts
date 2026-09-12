import { describe, expect, test } from "bun:test";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { registerCommands } from "../src/commands.ts";
import {
  advisorScoutEnabledRef,
  setAdvisorCollapseResponsesRef,
} from "../src/config.ts";
import { adviceForDisplay } from "../src/tools.ts";
import { AdvisorSettingsSelector } from "../src/ui.ts";
import { savedConfig, withAgentDir } from "./helpers/config-fixture.ts";
import { mockPi } from "./helpers/mock-pi.ts";
import {
  changeSetting,
  focusSettingsRow,
} from "./helpers/settings-navigation.ts";

initTheme();

const SCOUT_ON_PATTERN = /Experimental Advisor Scout\s+On/;
const MAX_CALLS_ROW_PATTERN = /Max Advisor calls\/session\s+10/;

const selectorTheme = {
  bold: (text: string) => text,
  fg: (_color: string, text: string) => text,
} as any;

const openSelector = (overrides: {
  onChange?: (settings: any) => void;
  onSave?: (settings: any) => void;
  initial?: Record<string, unknown>;
  presets?: Array<{ description: string; label: string; value: number }>;
}) => {
  const saved: any[] = [];
  const selector = new AdvisorSettingsSelector({
    effortLevels: ["Default (Model Default)", "high"],
    initial: {
      collapseResponses: false,
      completionGate: true,
      contextMaxChars: 0,
      failureGate: true,
      planGate: true,
      ...overrides.initial,
    },
    onCancel: () => undefined,
    onChange:
      overrides.onChange ??
      (overrides.onSave ? undefined : (settings) => saved.push(settings)),
    onSave: overrides.onSave,
    presets: overrides.presets ?? [
      { description: "No history", label: "0", value: 0 },
      { description: "Recent history", label: "10k", value: 10_000 },
    ],
    theme: selectorTheme,
    tui: { requestRender: () => undefined },
  });
  return { saved, selector };
};

describe("Advisor settings selector", () => {
  test("uses a compact searchable settings list and saves each change", () => {
    const { saved, selector } = openSelector({});
    const screen = selector.render(80).join("\n");
    expect(screen).toContain("Advisor reasoning");
    expect(screen).toContain("Experimental Advisor Scout");
    expect(screen).toContain("Show usage and cost details");
    expect(screen).not.toContain("Save changes");
    expect(screen).toContain("Type to search");

    changeSetting(selector, "Context window");
    changeSetting(selector, "Show usage and cost details");
    expect(saved.at(-1)).toMatchObject({
      contextMaxChars: 10_000,
      showUsageDetails: false,
    });

    for (const key of ["s", "e", "c", "r", "e", "t"]) {
      selector.handleInput(key);
    }
    expect(selector.render(100).join("\n")).toContain("Redact common secrets");
  });

  test("uses arrow keys to change the selected setting", () => {
    let saved: any;
    const { selector } = openSelector({
      onChange: (settings) => {
        saved = settings;
      },
    });
    selector.handleInput("\u001b[C");
    expect(saved.contextMaxChars).toBe(10_000);
    selector.handleInput("\u001b[D");
    expect(saved.contextMaxChars).toBe(0);
  });

  test("uses Space to toggle and auto-save a setting", () => {
    let saved: any;
    const { selector } = openSelector({
      onChange: (settings) => {
        saved = settings;
      },
      presets: [{ description: "No history", label: "0", value: 0 }],
    });
    focusSettingsRow(selector, "Always on");
    selector.handleInput(" ");
    expect(saved.alwaysOn).toBe(true);
  });

  test("renders a context depth meter", () => {
    const { selector } = openSelector({
      initial: { contextMaxChars: Number.MAX_SAFE_INTEGER },
      presets: [
        { description: "No history", label: "0", value: 0 },
        {
          description: "Full branch",
          label: "ALL",
          value: Number.MAX_SAFE_INTEGER,
        },
      ],
    });
    const screen = selector.render(100).join("\n");
    const stripped = stripTerminalSequences(screen);
    const lines = stripped.split("\n");
    const meterLine = lines.find((line) => line.includes("none"));
    const labelLine = lines.find((line) => line.trim() === "ALL");
    if (!(meterLine && labelLine)) {
      throw new Error("Context meter did not render its marker and label");
    }
    expect(meterLine).toContain("full");
    expect(meterLine).toContain("●");
    expect(labelLine.indexOf("ALL")).toBe(meterLine.indexOf("●") - 1);
    expect(stripped).not.toContain("████");
  });

  test("restores Simple mode animation", () => {
    const { selector } = openSelector({
      initial: { simpleMode: true },
      presets: [{ description: "No history", label: "0", value: 0 }],
    });
    expect(selector.render(100).join("\n")).toContain("\u001b[38;2;");
    selector.dispose();
  });

  test("hides Scout in Simple mode without losing its saved value", () => {
    let saved: any;
    const { selector } = openSelector({
      initial: { scoutEnabled: true, simpleMode: true },
      onSave: (settings) => {
        saved = settings;
      },
      presets: [{ description: "No history", label: "0", value: 0 }],
    });
    expect(selector.render(100).join("\n")).not.toContain(
      "Experimental Advisor Scout"
    );
    changeSetting(selector, "Simple mode");
    expect(stripTerminalSequences(selector.render(100).join("\n"))).toMatch(
      SCOUT_ON_PATTERN
    );
    expect(saved.scoutEnabled).toBe(true);
    selector.dispose();
  });

  test("preserves explicit privacy settings through the selector", () => {
    let saved: any;
    const { selector } = openSelector({
      initial: {
        redactSecrets: true,
        toolPolicies: { bash: "summary", deploy: "exclude" },
      },
      onSave: (settings) => {
        saved = settings;
      },
      presets: [{ description: "No history", label: "0", value: 0 }],
    });
    changeSetting(selector, "Simple mode");
    expect(saved).toMatchObject({
      redactSecrets: true,
      toolPolicies: { bash: "summary", deploy: "exclude" },
    });
  });

  test("keeps invalid tool disclosure policies open with an actionable error", () => {
    const { selector } = openSelector({
      onSave: () => undefined,
      presets: [{ description: "No history", label: "0", value: 0 }],
    });
    focusSettingsRow(selector, "Tool disclosure policies");
    selector.handleInput("\r");
    const editor = (selector as any).settingsList.submenuComponent;
    editor.input.onSubmit('{"bash":"invalid"}');
    expect(selector.render(120).join("\n")).toContain(
      "Use non-empty tool names with full, summary, or exclude values."
    );
    editor.input.onSubmit("{");
    expect(selector.render(120).join("\n")).toContain(
      "Enter a valid JSON object."
    );
  });

  test("edits the custom invocation rule inline", () => {
    let saved: any;
    const { selector } = openSelector({
      onSave: (settings) => {
        saved = settings;
      },
      presets: [{ description: "No history", label: "0", value: 0 }],
    });
    focusSettingsRow(selector, "Custom invocation");
    selector.handleInput("\r");
    for (const character of "deploy") {
      selector.handleInput(character);
    }
    selector.handleInput("\r");
    expect(saved.customRule).toBe("deploy");
  });

  test("reopens Advisor settings with the value saved in the same session", async () => {
    await withAgentDir({ advisorMaxCallsPerSession: 5 }, async () => {
      const commands = new Map<string, any>();
      const custom = async (factory: any) =>
        new Promise<any>((resolve) => {
          const selector = factory(
            { requestRender: () => undefined },
            selectorTheme,
            {},
            resolve
          );
          focusSettingsRow(selector, "Experimental Advisor Scout");
          changeSetting(selector, "Experimental Advisor Scout");
          changeSetting(selector, "Max Advisor calls/session");
          selector.handleInput("\u001b");
        });
      const reopened = async (factory: any) =>
        new Promise<any>((resolve) => {
          const selector = factory(
            { requestRender: () => undefined },
            selectorTheme,
            {},
            resolve
          );
          const initialScreen = stripTerminalSequences(
            selector.render(100).join("\n")
          );
          expect(initialScreen).toMatch(SCOUT_ON_PATTERN);
          for (const key of ["m", "a", "x"]) {
            selector.handleInput(key);
          }
          const screen = stripTerminalSequences(
            selector.render(100).join("\n")
          );
          expect(screen).toMatch(MAX_CALLS_ROW_PATTERN);
          selector.handleInput("\u001b");
        });
      registerCommands(mockPi({ commands }));
      const context = {
        cwd: "/",
        hasUI: true,
        isProjectTrusted: () => false,
        ui: { custom, notify: () => undefined, setStatus: () => undefined },
      } as any;

      await commands.get("advisor-settings").handler("", context);
      expect(
        savedConfig(process.env.PI_CODING_AGENT_DIR as string)
      ).toMatchObject({
        advisorMaxCallsPerSession: 10,
        advisorScoutEnabled: true,
      });
      expect(advisorScoutEnabledRef).toBe(true);
      context.ui.custom = reopened;
      await commands.get("advisor-settings").handler("", context);
    });
  });

  test("keeps Advisor answers expanded unless collapse is enabled", () => {
    const longAnswer = Array.from(
      { length: 14 },
      (_, index) => `line ${index + 1}`
    ).join("\n");
    setAdvisorCollapseResponsesRef(false);
    expect(adviceForDisplay(longAnswer, false)).toBe(longAnswer);
    setAdvisorCollapseResponsesRef(true);
    expect(adviceForDisplay(longAnswer, false)).toContain("Ctrl+O to expand");
    expect(adviceForDisplay(longAnswer, true)).toBe(longAnswer);
    setAdvisorCollapseResponsesRef(false);
  });
});
