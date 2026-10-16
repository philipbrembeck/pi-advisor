import type {
  JevClassifierKeyStoreDeps,
  JevClassifierSecrets,
} from "../../src/jev/classifier-key-store.ts";

export class JevClassifierKeyStoreHarness {
  value: string | undefined;
  readonly calls: string[] = [];
  readonly deps: JevClassifierKeyStoreDeps;

  constructor(initial?: string) {
    this.value = initial;

    const secrets: JevClassifierSecrets = {
      delete: async () => {
        this.calls.push("delete");
        this.value = undefined;

        return true;
      },
      get: async () => {
        this.calls.push("get");

        return this.value;
      },
      set: async ({ value }) => {
        this.calls.push("set");
        this.value = value;
      },
    };

    this.deps = { secrets };
  }
}
