import { visibleWidth } from "@earendil-works/pi-tui";
import type { ContextPreset } from "./types.js";

export const DEFAULT_EFFORT_LEVEL = "Default (Model Default)";
export const TOGGLE_VALUES = ["On", "Off"];
export const SIMPLE_MODE_GRADIENT_INTERVAL_MS = 100;
// One full shine sweep across the label, then the label rests on static accent.
export const SIMPLE_MODE_CELEBRATION_MS =
  SIMPLE_MODE_GRADIENT_INTERVAL_MS * 2 * "Simple mode".length;
// Purple steps with a moving light highlight, retained from the original UI.
const SIMPLE_MODE_GRADIENT_COLORS = [
  [125, 79, 205],
  [143, 96, 218],
  [160, 114, 230],
  [178, 135, 238],
  [195, 157, 245],
  [168, 120, 230],
  [143, 89, 215],
] as const;

export const withCurrentValue = (current: string, values: string[]) =>
  values.includes(current) ? values : [current, ...values];

export const numericValues = (current: number, values: number[]) => {
  const all = values.includes(current) ? values : [...values, current];
  return all.sort((a, b) => a - b).map(String);
};

export const maxCallValues = (current: string) => {
  const values = ["0", "1", "2", "3", "5", "10", "25", "50", "∞"];
  if (values.includes(current)) {
    return values;
  }
  const numeric = Number(current);
  const insertionIndex = values.findIndex(
    (value) => value !== "∞" && Number(value) > numeric
  );
  return insertionIndex === -1
    ? [...values.slice(0, -1), current, "∞"]
    : [
        ...values.slice(0, insertionIndex),
        current,
        ...values.slice(insertionIndex),
      ];
};

export const settingValue = (
  value: boolean | undefined,
  defaultValue: boolean
) => ((value ?? defaultValue) ? "On" : "Off");

export const currentContextLabel = (
  presets: ContextPreset[],
  contextMaxChars: number
): string =>
  presets.find((preset) => preset.value === contextMaxChars)?.label ??
  String(contextMaxChars);

export const contextDescription = (
  presets: ContextPreset[],
  contextMaxChars: number
): string => {
  const exactIndex = presets.findIndex(
    (preset) => preset.value === contextMaxChars
  );
  const selectedIndex =
    exactIndex >= 0
      ? exactIndex
      : presets.reduce(
          (closestIndex, preset, index) =>
            Math.abs(preset.value - contextMaxChars) <
            Math.abs(presets[closestIndex].value - contextMaxChars)
              ? index
              : closestIndex,
          0
        );
  const selectedPreset = presets[selectedIndex];
  const isFullContext =
    selectedPreset?.value === Number.MAX_SAFE_INTEGER ||
    selectedPreset?.label.toUpperCase() === "FULL" ||
    selectedPreset?.label.toUpperCase() === "ALL";
  const progress = isFullContext
    ? 1
    : selectedIndex / Math.max(1, presets.length - 1);
  const meterWidth = 20;
  const marker = Math.round(progress * meterWidth);
  const meter = Array.from({ length: meterWidth + 1 }, (_, index) => {
    if (index === marker) {
      return "●";
    }
    return index < marker ? "━" : "─";
  }).join("");
  const label = currentContextLabel(presets, contextMaxChars);
  const labelWidth = visibleWidth(label);
  const meterPrefix = "none    ";
  const markerColumn = meterPrefix.length + marker;
  const labelStart = Math.max(
    0,
    Math.min(
      meterPrefix.length + meter.length + 2 - labelWidth,
      markerColumn - Math.floor((labelWidth - 1) / 2)
    )
  );
  const markerLabel = `${" ".repeat(labelStart)}${label}`;
  const description =
    exactIndex >= 0 ? selectedPreset?.description : "Custom context limit.";
  return `${description ?? "Custom context limit."}\n${meterPrefix}${meter}  full\n${markerLabel}`;
};

export const currentEffort = (effort: string | undefined): string =>
  effort || DEFAULT_EFFORT_LEVEL;

export interface SimpleModeLabel {
  settled: boolean;
  text: string;
}

/**
 * Renders the Simple mode label: shine sweep while the flip celebration runs,
 * static accent text once it settles (or when simple mode was already on).
 */
export const simpleModeLabel = (
  celebrationStartedAt: number | undefined,
  accent: (text: string) => string
): SimpleModeLabel => {
  if (
    celebrationStartedAt !== undefined &&
    Date.now() - celebrationStartedAt < SIMPLE_MODE_CELEBRATION_MS
  ) {
    return {
      settled: false,
      text: rainbowGradient("Simple mode", celebrationStartedAt),
    };
  }
  return { settled: true, text: accent("Simple mode") };
};

export const rainbowGradient = (text: string, startedAt: number): string => {
  const frame = Math.floor(
    (Date.now() - startedAt) / SIMPLE_MODE_GRADIENT_INTERVAL_MS
  );
  const shinePosition = frame % (text.length * 2);
  return [...text]
    .map((character, index) => {
      const [baseRed, baseGreen, baseBlue] =
        SIMPLE_MODE_GRADIENT_COLORS[index % SIMPLE_MODE_GRADIENT_COLORS.length];
      const distance = Math.abs(index - shinePosition);
      let brightness = 0;
      if (distance === 0) {
        brightness = 0.7;
      } else if (distance === 1) {
        brightness = 0.35;
      }
      const red = Math.round(baseRed + (255 - baseRed) * brightness);
      const green = Math.round(baseGreen + (255 - baseGreen) * brightness);
      const blue = Math.round(baseBlue + (255 - baseBlue) * brightness);
      return `\x1b[38;2;${red};${green};${blue}m${character}`;
    })
    .join("")
    .concat("\x1b[0m");
};
