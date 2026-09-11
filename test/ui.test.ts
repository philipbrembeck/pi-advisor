import { describe, expect, test } from "bun:test";
import {
  getKeybindings,
  Key,
  matchesKey,
  stripTerminalSequences,
  type TUI,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { TextSettingSubmenu } from "../src/ui/text-setting-submenu.js";
import {
  AdvisorSettingsSelector,
  ManualAdvisorDialog,
  type ManualAdvisorRequest,
  SearchableModelSelector,
} from "../src/ui.js";

const theme = {
  bold: (value: string) => value,
  fg: (_color: string, value: string) => value,
} as any;

const makeTui = () => {
  let renders = 0;
  const tui = {
    requestRender: () => {
      renders += 1;
    },
    terminal: { rows: 24 },
  } as unknown as TUI;
  return { renders: () => renders, tui };
};

const makeDialog = ({
  initialMessage,
  gitContext = "summary",
}: {
  initialMessage?: string;
  gitContext?: "off" | "summary" | "full";
} = {}) => {
  const submitted: ManualAdvisorRequest[] = [];
  let cancelled = 0;
  const { tui, renders } = makeTui();
  const dialog = new ManualAdvisorDialog({
    gitContext,
    initialMessage,
    keybindings: getKeybindings(),
    onCancel: () => {
      cancelled += 1;
    },
    onSubmit: (request) => {
      submitted.push(request);
    },
    theme,
    tui,
  });
  dialog.focused = true;
  return { cancelled: () => cancelled, dialog, renders, submitted };
};

describe("ManualAdvisorDialog", () => {
  test("renders the prefilled message, context explanation, choices, and actions", () => {
    const { dialog } = makeDialog({
      gitContext: "full",
      initialMessage: "Check the migration",
    });
    const screen = stripTerminalSequences(dialog.render(90).join("\n"))
      .replace(/[│]/g, " ")
      .replace(/\s+/g, " ");

    expect(screen).toContain("Ask Advisor");
    expect(screen).toContain("▸ Message for Advisor (optional)");
    expect(screen).toContain("Check the migration");
    expect(screen).toContain("Automatic context follows your settings");
    expect(screen).toContain("conversation history");
    expect(screen).toContain("tool disclosure");
    expect(screen).toContain("project preferences");
    expect(screen).toContain("redaction");
    expect(screen).toContain("configured limits");
    expect(screen).toContain("does not expose drafts");
    expect(screen).toContain("does not remove configured conversation history");
    expect(screen).toContain("○ Summary — changed paths and status");
    expect(screen).toContain("○ None — no Git data");
    expect(screen).toContain("● Full — summary plus patch");
    expect(screen).toContain("max: Full");
    expect(screen).toContain("[Submit]");
    expect(screen).toContain("[Cancel]");
    expect(screen).toContain("Shift+Enter newline");
  });

  test("selects the configured Git default and hides choices above its ceiling", () => {
    const summary = makeDialog({ gitContext: "summary" })
      .dialog.render(90)
      .join("\n");
    expect(summary).toContain("● Summary");
    expect(summary).not.toContain("Full — summary plus patch");

    const off = makeDialog({ gitContext: "off" }).dialog.render(90).join("\n");
    expect(off).toContain("● None — no Git data");
    expect(off).not.toContain("Summary — changed paths and status");
    expect(off).not.toContain("Full — summary plus patch");
  });

  test("uses the real Enter and Shift+Enter sequences for submit and multiline editing", () => {
    const { dialog, submitted } = makeDialog({ initialMessage: "First" });

    expect(matchesKey("\r", Key.enter)).toBe(true);
    expect(matchesKey("\n", Key.shift("enter"))).toBe(false);
    dialog.handleInput("\n");
    for (const character of "Second") {
      dialog.handleInput(character);
    }

    expect(submitted).toHaveLength(0);
    dialog.handleInput("\r");
    expect(submitted).toEqual([
      { gitContext: "summary", message: "First\nSecond" },
    ]);
  });

  test("blank submission returns an optional empty message and normalizes once", () => {
    const { dialog, submitted, cancelled } = makeDialog();

    dialog.handleInput("\r");
    dialog.handleInput("\r");
    dialog.handleInput("\u001b");

    expect(submitted).toEqual([{ gitContext: "summary" }]);
    expect(cancelled()).toBe(0);
  });

  test("cycles focus, changes Git/action selection, and submits or cancels the selected action", () => {
    const { dialog, submitted, cancelled } = makeDialog({ gitContext: "full" });

    dialog.handleInput("\t");
    dialog.handleInput("\u001b[B");
    dialog.handleInput("\t");
    dialog.handleInput("\u001b[C");
    dialog.handleInput("\r");

    expect(submitted).toEqual([]);
    expect(cancelled()).toBe(1);

    const second = makeDialog({ gitContext: "full" });
    second.dialog.handleInput("\t");
    second.dialog.handleInput("\t");
    second.dialog.handleInput("\r");
    expect(second.submitted).toEqual([{ gitContext: "full" }]);
  });

  test("uses arrows and Space within Git choices, then leaves at the edges", () => {
    const summary = makeDialog({ gitContext: "summary" });
    summary.dialog.handleInput("\u001b[B");
    expect(
      stripTerminalSequences(summary.dialog.render(90).join("\n"))
    ).toContain("▸ ● Summary — changed paths and status");
    summary.dialog.handleInput("\u001b[B");
    expect(
      stripTerminalSequences(summary.dialog.render(90).join("\n"))
    ).toContain("▸ ● None — no Git data");
    summary.dialog.handleInput(" ");
    expect(
      stripTerminalSequences(summary.dialog.render(90).join("\n"))
    ).toContain("● Summary");

    const git = makeDialog({ gitContext: "full" });
    git.dialog.handleInput("\u001b[B");
    git.dialog.handleInput("\u001b[B");
    expect(stripTerminalSequences(git.dialog.render(90).join("\n"))).toContain(
      "● Summary — changed paths and status"
    );
    git.dialog.handleInput("\u001b[A");
    expect(stripTerminalSequences(git.dialog.render(90).join("\n"))).toContain(
      "● Full — summary plus patch"
    );

    const editor = makeDialog({ gitContext: "off" });
    editor.dialog.handleInput("\u001b[B");
    editor.dialog.handleInput("\u001b[A");
    editor.dialog.handleInput("x");
    expect(
      stripTerminalSequences(editor.dialog.render(90).join("\n"))
    ).toContain("│ x");

    const actions = makeDialog({ gitContext: "full" });
    actions.dialog.handleInput("\u001b[B");
    actions.dialog.handleInput("\u001b[B");
    actions.dialog.handleInput("\u001b[B");
    actions.dialog.handleInput("\u001b[A");
    actions.dialog.handleInput("\u001b[A");
    expect(actions.dialog.render(90).join("\n")).toContain("▸");
    actions.dialog.handleInput("\r");
    actions.dialog.handleInput("\r");
    expect(actions.submitted).toEqual([{ gitContext: "full" }]);
  });

  test("supports reverse focus navigation and requests redraws after state changes", () => {
    const { dialog, renders } = makeDialog();

    dialog.handleInput("\t");
    dialog.handleInput("\u001b[Z");
    expect(renders()).toBeGreaterThan(0);

    const before = dialog.render(80).join("\n");
    dialog.handleInput("x");
    const after = dialog.render(80).join("\n");
    expect(after).not.toBe(before);
  });

  test("cancels exactly once and suppresses input after completion", () => {
    const { dialog, submitted, cancelled } = makeDialog();

    dialog.handleInput("\u001b");
    dialog.handleInput("\r");
    dialog.handleInput("a");
    dialog.handleInput("\t");

    expect(cancelled()).toBe(1);
    expect(submitted).toHaveLength(0);
  });

  test("keeps every rendered line within narrow widths", () => {
    const { dialog } = makeDialog({
      gitContext: "full",
      initialMessage: "A very long message that needs to stay within the modal",
    });

    for (const width of [1, 2, 3, 4, 12, 24]) {
      for (const line of dialog.render(width)) {
        const lineWidth = visibleWidth(line);
        expect(lineWidth).toBeLessThanOrEqual(width);
        if (width >= 2) {
          expect(lineWidth).toBe(width);
        }
      }
    }
  });

  test("centers the action buttons between the borders", () => {
    const { dialog } = makeDialog();
    const actionsRow = (lines: string[]) =>
      lines
        .map((line) => stripTerminalSequences(line))
        .find((line) => line.includes("[Submit]"));
    const buttons = "[Submit]  [Cancel]".length;
    // Row structure: border(1) + pad(1) + content + pad(1) + border(1), so the
    // centered start is 1 + (width - 2 - buttons) / 2 regardless of focus.
    const centeredStart = 1 + Math.floor((90 - 2 - buttons) / 2);

    const unfocused = actionsRow(dialog.render(90));
    expect(unfocused?.indexOf("[Submit]")).toBe(centeredStart);

    dialog.handleInput("\t");
    dialog.handleInput("\t");
    const focused = actionsRow(dialog.render(90));
    expect(focused?.indexOf("[Submit]")).toBe(centeredStart);
  });
});

describe("SearchableModelSelector", () => {
  const makeSelector = (
    allOptions: string[],
    currentOption?: string,
    testTheme: any = theme
  ) => {
    let selected: string | undefined;
    const selector = new SearchableModelSelector({
      allOptions,
      currentOption,
      keybindings: { matches: () => false } as any,
      onCancel: () => undefined,
      onSelect: (value) => {
        selected = value;
      },
      theme: testTheme,
      title: "Select Model",
      tui: { requestRender: () => undefined },
    });
    return { selected: () => selected, selector };
  };

  test("keeps every rendered line within the terminal width", () => {
    const { selector } = makeSelector(
      [
        "some-very-long-provider/with-an-extremely-long-model-identifier-name",
        "provider/short",
      ],
      "provider/short"
    );

    for (const width of [20, 40, 79]) {
      for (const line of selector.render(width)) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });

  test("frames the list with single border rules and a dim hint row", () => {
    // The mock must emit real ANSI escapes: the component's final
    // truncateToWidth treats them as zero-width, unlike literal text.
    const codes: Record<string, number> = {
      accent: 36,
      border: 90,
      dim: 2,
      muted: 37,
      text: 39,
    };
    const recordingTheme = {
      bold: (value: string) => `\u001b[1m${value}\u001b[22m`,
      fg: (color: string, value: string) =>
        `\u001b[${codes[color] ?? 39}m${value}\u001b[39m`,
    } as any;
    const { selector } = makeSelector(
      ["provider/one"],
      undefined,
      recordingTheme
    );

    const lines = selector.render(60);
    expect(stripTerminalSequences(lines[0])).toBe("─".repeat(60));
    expect(stripTerminalSequences(lines.at(-1) ?? "")).toBe("─".repeat(60));
    expect(lines.join("\n")).toContain("\u001b[2mType to search");
    expect(lines.join("\n")).not.toContain("═");
  });

  test("still selects the highlighted model after truncation", () => {
    const { selected, selector } = makeSelector([
      "a-very-long-provider-name/and-a-very-long-model-name",
    ]);
    selector.render(30);
    selector.handleInput("\r");
    expect(selected()).toBe(
      "a-very-long-provider-name/and-a-very-long-model-name"
    );
  });
});

describe("TextSettingSubmenu", () => {
  test("shows a validation error and clears it on the next input change", () => {
    const submitted: string[] = [];
    const submenu = new TextSettingSubmenu({
      description: "Enter a value.",
      initial: "",
      onCancel: () => undefined,
      onSubmit: (value) => {
        if (value.includes("@")) {
          submitted.push(value);
          return { value };
        }
        return { error: "Needs an @." };
      },
      theme,
      title: "Target",
      tui: { requestRender: () => undefined },
    });

    submenu.handleInput("x");
    submenu.handleInput("\r");
    expect(submenu.render(60).join("\n")).toContain("Needs an @.");

    submenu.handleInput("@");
    expect(submenu.render(60).join("\n")).not.toContain("Needs an @.");

    submenu.handleInput("\r");
    expect(submitted).toEqual(["x@"]);
  });
});

describe("AdvisorSettingsSelector simple mode label", () => {
  const presets = [
    {
      description: "Everything",
      label: "Full",
      value: Number.MAX_SAFE_INTEGER,
    },
    { description: "20k chars", label: "20k", value: 20_000 },
  ];
  const makeSelector = (simpleMode: boolean) => {
    let renders = 0;
    const selector = new AdvisorSettingsSelector({
      effortLevels: ["Default (Model Default)"],
      initial: {
        collapseResponses: false,
        completionGate: true,
        contextMaxChars: 20_000,
        failureGate: true,
        planGate: true,
        simpleMode,
      },
      onCancel: () => undefined,
      onChange: () => undefined,
      presets,
      theme: {
        bold: (value: string) => value,
        fg: (color: string, value: string) => `[${color}]${value}`,
      } as any,
      tui: {
        requestRender: () => {
          renders += 1;
        },
      },
    });
    selector.focused = true;
    return { renders: () => renders, selector };
  };

  test("shimmers the Simple mode label while simple mode is on", () => {
    const { selector } = makeSelector(true);
    try {
      // Per-character gradient escapes fragment the label text.
      const screen = selector.render(80).join("\n");
      expect(screen).not.toContain("Simple mode");
      expect(screen).toContain("38;2;");
    } finally {
      selector.dispose();
    }
  });

  test("leaves the label plain when simple mode is off", () => {
    const { selector } = makeSelector(false);
    try {
      expect(selector.render(80).join("\n")).toContain("Simple mode");
    } finally {
      selector.dispose();
    }
  });
});
