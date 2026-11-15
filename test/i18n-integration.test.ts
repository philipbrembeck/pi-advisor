import { describe, expect, test } from "bun:test";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { applyLocale } from "@juicesharp/rpiv-i18n";

import { plainThemeMock } from "./helpers/theme.ts";

// Importing the extension entry runs registerLocalesFromDir against the
// package-root locales/ directory — the same path a Pi session takes.
await import("../extensions/index.ts");

describe("i18n integration", () => {
  test("settings labels follow the active Pi locale", async () => {
    const { createSettingsItems } = await import("../src/ui/settings-items.ts");

    const buildItems = () => {
      const items = createSettingsItems({
        effortLevels: ["low"],
        fallbackModel: { currentValue: "", id: "fallback", label: "Fallback" },
        modelWhitelist: {
          currentValue: "",
          id: "whitelist",
          label: "Whitelist",
        },
        presets: [],
        // SAFETY: an empty settings fixture exercises every ?? default; no field is required to be present.
        settings: {} as never,
        theme: plainThemeMock,
        tui: { requestRender: () => undefined },
      });

      return new Map(items.map((item) => [item.id, item]));
    };

    // Items are snapshots: the settings dialog rebuilds them per render, so
    // each switch is followed by a fresh build — mirroring the TUI cycle.
    applyLocale("de");
    expect(buildItems().get("simpleMode")?.label).toBe("Einfacher Modus");

    applyLocale("fr");
    expect(buildItems().get("simpleMode")?.label).toBe("Mode simple");

    applyLocale(undefined);
    expect(buildItems().get("simpleMode")?.label).toBe("Simple mode");
  });

  test("the extension entry still exposes its Pi registration default export", async () => {
    // SAFETY: the entry module's only default export is registerPiAdvisor; the cast names that shape for the call below.
    const entry = (await import("../extensions/index.ts")) as {
      default: (pi: ExtensionAPI) => void;
    };

    expect(entry.default).toBeInstanceOf(Function);
  });
});
