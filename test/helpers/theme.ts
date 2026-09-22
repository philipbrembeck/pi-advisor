import type { Theme } from "@earendil-works/pi-coding-agent";

/** Passthrough theme stand-in: text passes through unstyled for render assertions. */
// SAFETY: mock implements only the bg/bold/fg passthroughs components under test call; other Theme members are never invoked.
export const plainThemeMock = {
  bg: (_color: string, value: string) => value,
  bold: (value: string) => value,
  fg: (_color: string, value: string) => value,
} as Theme;
