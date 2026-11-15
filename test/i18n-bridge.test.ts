import { describe, expect, test } from "bun:test";

import { I18N_NAMESPACE, t } from "../src/i18n.ts";

describe("i18n bridge", () => {
  test("returns the fallback verbatim for keys missing from the registry", () => {
    expect(t("bridge.neverRegistered", "Fallback text")).toBe("Fallback text");
  });

  test("exposes the npm package name as the namespace", () => {
    expect(I18N_NAMESPACE).toBe("pi-advisor-flow");
  });
});
