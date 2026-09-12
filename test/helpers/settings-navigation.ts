// Row navigation is resolved by label so that adding a settings row cannot
// silently retarget an existing test's keystrokes.

// biome-ignore lint/suspicious/noControlCharactersInRegex: strips terminal SGR codes
const SGR_CODE = /\u001b\[[0-9;]*m/g;

export const plainScreen = (selector: any) =>
  selector.render(100).join("\n").replace(SGR_CODE, "");

export const focusSettingsRow = (selector: any, label: string): number => {
  for (let presses = 0; presses < 60; presses += 1) {
    const screen = selector.render(120).join("\n").replace(SGR_CODE, "");
    if (screen.includes(`→ ${label}`)) {
      return presses;
    }
    selector.handleInput("\u001b[B");
  }
  throw new Error(`Settings row not reachable: ${label}`);
};

export const changeSetting = (selector: any, label: string): number => {
  const presses = focusSettingsRow(selector, label);
  selector.handleInput("\r");
  return presses;
};
