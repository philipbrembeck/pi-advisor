import { visibleWidth } from "@earendil-works/pi-tui";

import { DEFAULT_EFFORT_LEVEL } from "../commands/model-options.ts";
import type { ContextPreset } from "./types.ts";

export const TOGGLE_VALUES = ["On", "Off"];
export const SIMPLE_MODE_GRADIENT_INTERVAL_MS = 100;
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
  return all.toSorted((a, b) => a - b).map(String);
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

const closestPresetIndex = (
  presets: ContextPreset[],
  contextMaxChars: number
): number => {
  let closestIndex = 0;
  for (let index = 0; index < presets.length; index += 1) {
    if (
      Math.abs(presets[index].value - contextMaxChars) <
      Math.abs(presets[closestIndex].value - contextMaxChars)
    ) {
      closestIndex = index;
    }
  }
  return closestIndex;
};

export const contextDescription = (
  presets: ContextPreset[],
  contextMaxChars: number
): string => {
  const exactIndex = presets.findIndex(
    (preset) => preset.value === contextMaxChars
  );
  const selectedIndex =
    exactIndex === -1
      ? closestPresetIndex(presets, contextMaxChars)
      : exactIndex;
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
    exactIndex === -1 ? "Custom context limit." : selectedPreset?.description;
  return `${description ?? "Custom context limit."}\n${meterPrefix}${meter}  full\n${markerLabel}`;
};

export const currentEffort = (effort: string | undefined): string =>
  effort || DEFAULT_EFFORT_LEVEL;

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
      return `\u001B[38;2;${red};${green};${blue}m${character}`;
    })
    .join("")
    .concat("\u001B[0m");
};
