import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  fauxAssistantMessage,
  registerFauxProvider,
} from "@earendil-works/pi-ai/compat";

import type { AdvisorConfig } from "../src/config/types.ts";
import { readImageFiles } from "../src/image-attachments.ts";
import { ADVISOR_IMAGE_MAX_BYTES, imageFromPart } from "../src/images.ts";
import { consultAdvisor } from "../src/tools/consultation.ts";
import { withAgentDir } from "./helpers/config-fixture.ts";
import { asExtensionContext } from "./helpers/extension-context.ts";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";

const image = { data: png, mimeType: "image/png", type: "image" as const };

const userEntry = {
  id: "user-image",
  message: {
    content: [{ text: "Review this screenshot", type: "text" }, image],
    role: "user",
  },
  type: "message",
};

const contextFor = (cwd: string, faux: any, entries: object[]) =>
  asExtensionContext({
    cwd,
    isProjectTrusted: () => false,
    modelRegistry: {
      find: () => faux.models[0],
      getApiKeyAndHeaders: () => Promise.resolve({ apiKey: "key", ok: true }),
    },
    sessionManager: {
      getBranch: () => entries,
    },
  });

const capturedConsultation = async (
  input: ("text" | "image")[],
  entries: object[],
  config: AdvisorConfig = {}
) => {
  const faux = registerFauxProvider({
    api: "pi-advisor-image-test",
    models: [{ id: "advisor", input }],
    provider: "pi-advisor-image-test",
  });

  let request: any;

  try {
    await withAgentDir(
      {
        advisor: "pi-advisor-image-test/advisor",
        advisorGitContext: "off",
        ...config,
      },
      async (agentDir) => {
        faux.setResponses([
          (context) => {
            request = context.messages.find(
              (message) => message.role === "user"
            );

            return fauxAssistantMessage("Advice");
          },
        ]);
        await consultAdvisor(contextFor(agentDir, faux, entries));
      }
    );
  } finally {
    faux.unregister();
  }

  return request;
};

const pixels = (request: any) =>
  request.content.filter((part: any) => part.type === "image");

const text = (request: any) =>
  request.content
    .filter((part: any) => part.type === "text")
    .map((part: any) => part.text)
    .join("\n");

describe("Advisor image disclosure", () => {
  test("forwards real image pixels from selected user and full-policy tool results", async () => {
    const entries = [
      userEntry,
      {
        id: "tool-image",
        message: {
          content: [image],
          role: "toolResult",
          toolName: "read",
        },
        type: "message",
      },
    ];

    const request = await capturedConsultation(["text", "image"], entries);
    expect(pixels(request)).toEqual([image]);

    const labelParts = request.content.filter(
      (part: any) =>
        part.type === "text" && part.text.includes("attached image pixels")
    );

    expect(labelParts).toHaveLength(1);
    expect(labelParts[0].text.startsWith("\n\n")).toBe(true);
    expect(text(request)).toContain("1 image(s) attached");

    const toolOnly = await capturedConsultation(
      ["text", "image"],
      [entries[1]]
    );

    expect(pixels(toolOnly)).toEqual([image]);
    expect(text(request)).toContain("Review this screenshot");
    expect(text(request)).not.toContain(png);
  });

  test("omits image bytes for text-only models with a truthful note", async () => {
    const request = await capturedConsultation(["text"], [userEntry]);
    expect(pixels(request)).toEqual([]);
    expect(text(request)).toContain("does not support image input");
    expect(text(request)).toContain("no pixels were forwarded");
  });

  test("respects tool policy, text budget, format and size", async () => {
    const toolEntry = {
      message: { content: [image], role: "toolResult", toolName: "read" },
      type: "message",
    };

    const policy = await capturedConsultation(["text", "image"], [toolEntry], {
      advisorToolPolicies: { read: "summary" },
    });

    expect(pixels(policy)).toEqual([]);
    expect(text(policy)).toContain("output omitted by Advisor tool policy");

    const budget = await capturedConsultation(["text", "image"], [userEntry], {
      contextMaxChars: 0,
    });

    expect(pixels(budget)).toEqual([]);
    expect(imageFromPart({ ...image, mimeType: "image/jpeg" })).toBeUndefined();
    expect(imageFromPart({ ...image, data: "not-base64" })).toBeUndefined();
    expect(
      imageFromPart({
        data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64"),
        mimeType: "image/jpeg",
        type: "image",
      })
    ).toBeUndefined();
    expect(
      imageFromPart({
        ...image,
        data: Buffer.from(png, "base64").subarray(0, 33).toString("base64"),
      })
    ).toBeUndefined();

    const jpeg = readFileSync(
      join(import.meta.dir, "fixtures", "red-pixel.jpg")
    );

    expect(
      imageFromPart({
        data: jpeg.toString("base64"),
        mimeType: "image/jpeg",
        type: "image",
      })
    ).toBeDefined();

    const gif = readFileSync(
      join(import.meta.dir, "fixtures", "red-pixel.gif")
    );

    expect(
      imageFromPart({
        data: gif.toString("base64"),
        mimeType: "image/gif",
        type: "image",
      })
    ).toBeDefined();

    const webp = readFileSync(
      join(import.meta.dir, "fixtures", "red-pixel.webp")
    );

    expect(
      imageFromPart({
        data: webp.toString("base64"),
        mimeType: "image/webp",
        type: "image",
      })
    ).toBeDefined();
    expect(
      imageFromPart({
        ...image,
        data: "A".repeat(ADVISOR_IMAGE_MAX_BYTES * 2),
      })
    ).toBeUndefined();

    const bad = await capturedConsultation(
      ["text", "image"],
      [
        {
          message: {
            content: [{ ...image, mimeType: "image/jpeg" }],
            role: "user",
          },
          type: "message",
        },
      ]
    );

    expect(pixels(bad)).toEqual([]);
    expect(text(bad)).toContain("pixels not reviewed");
  });

  test("OMP fallback does not disclose images before a reset boundary", async () => {
    const faux = registerFauxProvider({
      api: "pi-advisor-image-reset-test",
      models: [{ id: "advisor", input: ["text", "image"] }],
      provider: "pi-advisor-image-reset-test",
    });

    let request: any;

    try {
      await withAgentDir(
        {
          advisor: "pi-advisor-image-reset-test/advisor",
          advisorGitContext: "off",
          advisorScoutEnabled: true,
          executor: "pi-advisor-image-reset-test/advisor",
        },
        async (agentDir) => {
          faux.setResponses([
            (context) => {
              const scoutUser = context.messages.find(
                (message) => message.role === "user"
              );

              if (
                scoutUser?.role !== "user" ||
                !Array.isArray(scoutUser.content) ||
                scoutUser.content[0]?.type !== "text"
              ) {
                throw new Error("Missing Scout manifest");
              }

              const manifest = JSON.parse(scoutUser.content[0].text);
              const manifestText = JSON.stringify(manifest);
              expect(manifestText).not.toContain("Sensitive old image");
              expect(manifestText).not.toContain("[Image ref=");

              const required = manifest.groups.find(
                (group: any) => group.required
              );

              return fauxAssistantMessage(
                JSON.stringify({ selectedIds: [required.id], synthesis: "" })
              );
            },
            (context) => {
              request = context.messages.find(
                (message) => message.role === "user"
              );

              return fauxAssistantMessage("Advice");
            },
          ]);

          const outcome = await consultAdvisor(
            contextFor(agentDir, faux, [
              {
                ...userEntry,
                message: {
                  ...userEntry.message,
                  content: [
                    { text: "Sensitive old image request", type: "text" },
                    image,
                  ],
                },
              },
              { id: "reset", type: "reset_boundary" },
              {
                id: "current",
                message: { content: "Review current code", role: "user" },
                type: "message",
              },
            ])
          );

          expect(outcome.scout).toMatchObject({ ok: true });
        }
      );
      expect(pixels(request)).toEqual([]);
      expect(text(request)).not.toContain("Sensitive old image request");
      expect(text(request)).toContain("Review current code");
    } finally {
      faux.unregister();
    }
  });

  test("OMP fallback without Scout excludes images before reset boundaries", async () => {
    const request = await capturedConsultation(
      ["text", "image"],
      [
        {
          ...userEntry,
          id: "discarded-image",
          message: {
            ...userEntry.message,
            content: [{ text: "Discarded image request", type: "text" }, image],
          },
        },
        { id: "reset", type: "reset_boundary" },
        {
          id: "current",
          message: { content: "Current request", role: "user" },
          type: "message",
        },
      ]
    );

    expect(pixels(request)).toEqual([]);
    expect(text(request)).not.toContain("Discarded image request");
    expect(text(request)).toContain("Current request");
  });

  test("OMP fallback with compaction forwards only retained images", async () => {
    const discardedImage = image;

    const retainedImage = {
      data: readFileSync(
        join(import.meta.dir, "fixtures/red-pixel.jpg")
      ).toString("base64"),
      mimeType: "image/jpeg",
      type: "image" as const,
    };

    const oldImageEntry = {
      ...userEntry,
      id: "old-image",
      message: {
        ...userEntry.message,
        content: [
          { text: "Discarded image evidence", type: "text" },
          discardedImage,
        ],
      },
    };

    const keptImageEntry = {
      ...userEntry,
      id: "kept-image",
      message: {
        ...userEntry.message,
        content: [
          { text: "Retained image evidence", type: "text" },
          retainedImage,
        ],
      },
    };

    const faux = registerFauxProvider({
      api: "pi-advisor-image-compaction-test",
      models: [{ id: "advisor", input: ["text", "image"] }],
      provider: "pi-advisor-image-compaction-test",
    });

    let request: any;

    try {
      await withAgentDir(
        {
          advisor: "pi-advisor-image-compaction-test/advisor",
          advisorGitContext: "off",
          advisorScoutEnabled: true,
          executor: "pi-advisor-image-compaction-test/advisor",
        },
        async (agentDir) => {
          faux.setResponses([
            (context) => {
              const scoutUser = context.messages.find(
                (message) => message.role === "user"
              );

              if (
                scoutUser?.role !== "user" ||
                !Array.isArray(scoutUser.content) ||
                scoutUser.content[0]?.type !== "text"
              ) {
                throw new Error("Missing Scout manifest");
              }

              const manifest = JSON.parse(scoutUser.content[0].text);
              const manifestText = JSON.stringify(manifest);
              expect(manifestText).not.toContain("Discarded image evidence");

              const retainedGroup = manifest.groups.find((group: any) =>
                group.content.includes("Retained image evidence")
              );

              expect(retainedGroup).toBeDefined();

              return fauxAssistantMessage(
                JSON.stringify({
                  selectedIds: [retainedGroup.id],
                  synthesis: "",
                })
              );
            },
            (context) => {
              request = context.messages.find(
                (message) => message.role === "user"
              );

              return fauxAssistantMessage("Advice");
            },
          ]);

          const outcome = await consultAdvisor(
            contextFor(agentDir, faux, [
              oldImageEntry,
              keptImageEntry,
              {
                firstKeptEntryId: "kept-image",
                id: "compaction",
                parentId: null,
                summary: "Compaction summary",
                timestamp: "2026-01-01T00:00:00Z",
                tokensBefore: 1000,
                type: "compaction",
              },
              {
                id: "current",
                message: { content: "Review current code", role: "user" },
                type: "message",
              },
            ])
          );

          expect(outcome.scout).toMatchObject({ ok: true });
        }
      );
      expect(pixels(request)).toEqual([retainedImage]);
      expect(pixels(request)).not.toContainEqual(discardedImage);
      expect(text(request)).not.toContain("Discarded image evidence");
      expect(text(request)).toContain("Retained image evidence");
    } finally {
      faux.unregister();
    }
  });

  test("does not forward older images omitted by the conversation budget", async () => {
    const request = await capturedConsultation(
      ["text", "image"],
      [
        userEntry,
        {
          message: { content: "x".repeat(130), role: "user" },
          type: "message",
        },
      ],
      { contextMaxChars: 300 }
    );

    expect(pixels(request)).toEqual([]);
    expect(text(request)).toContain("Older context omitted");
  });

  test("Scout selection cannot forward pixels from an unselected group", async () => {
    const faux = registerFauxProvider({
      api: "pi-advisor-image-scout-test",
      models: [{ id: "advisor", input: ["text", "image"] }],
      provider: "pi-advisor-image-scout-test",
    });

    let request: any;

    try {
      await withAgentDir(
        {
          advisor: "pi-advisor-image-scout-test/advisor",
          advisorGitContext: "off",
          advisorScoutEnabled: true,
          executor: "pi-advisor-image-scout-test/advisor",
        },
        async (agentDir) => {
          faux.setResponses([
            (context) => {
              const scoutUser = context.messages.find(
                (message) => message.role === "user"
              );

              if (
                scoutUser?.role !== "user" ||
                !Array.isArray(scoutUser.content) ||
                scoutUser.content[0]?.type !== "text"
              ) {
                throw new Error("Missing Scout manifest");
              }

              const manifest = JSON.parse(scoutUser.content[0].text);
              expect(JSON.stringify(manifest)).not.toContain(png);

              const imageGroup = manifest.groups.find((group: any) =>
                group.content.includes("[Image ref=")
              );

              expect(imageGroup).toBeDefined();

              const marker =
                imageGroup.content.match(/\[Image ref=[^\]]+\]/u)?.[0];

              return fauxAssistantMessage(
                JSON.stringify({
                  selectedIds: [
                    manifest.groups.find((group: any) => group.required).id,
                  ],
                  synthesis: `Scout echo: ${marker}`,
                })
              );
            },
            (context) => {
              request = context.messages.find(
                (message) => message.role === "user"
              );

              return fauxAssistantMessage("Advice");
            },
          ]);

          const outcome = await consultAdvisor(
            contextFor(agentDir, faux, [
              userEntry,
              {
                id: "latest",
                message: { content: "Review the code instead", role: "user" },
                type: "message",
              },
            ])
          );

          expect(outcome.scout).toMatchObject({ ok: true });
        }
      );
      expect(faux.state.callCount).toBe(2);
      expect(pixels(request)).toEqual([]);
      expect(text(request)).toContain("Review the code instead");
      expect(text(request)).toContain("[Scout synthesis");
      expect(text(request)).toContain("Scout echo: [Image ref=");
    } finally {
      faux.unregister();
    }
  });

  test("forwards pixels when Scout selects the image's evidence group", async () => {
    const faux = registerFauxProvider({
      api: "pi-advisor-image-selected-test",
      models: [{ id: "advisor", input: ["text", "image"] }],
      provider: "pi-advisor-image-selected-test",
    });

    let request: any;

    try {
      await withAgentDir(
        {
          advisor: "pi-advisor-image-selected-test/advisor",
          advisorGitContext: "off",
          advisorScoutEnabled: true,
          executor: "pi-advisor-image-selected-test/advisor",
        },
        async (agentDir) => {
          faux.setResponses([
            (context) => {
              const scoutUser = context.messages.find(
                (message) => message.role === "user"
              );

              if (
                scoutUser?.role !== "user" ||
                !Array.isArray(scoutUser.content) ||
                scoutUser.content[0]?.type !== "text"
              ) {
                throw new Error("Missing Scout manifest");
              }

              const manifest = JSON.parse(scoutUser.content[0].text);

              return fauxAssistantMessage(
                JSON.stringify({
                  selectedIds: [manifest.groups[0].id],
                  synthesis: "",
                })
              );
            },
            (context) => {
              request = context.messages.find(
                (message) => message.role === "user"
              );

              return fauxAssistantMessage("Advice");
            },
          ]);

          const outcome = await consultAdvisor(
            contextFor(agentDir, faux, [userEntry])
          );

          expect(outcome.scout).toMatchObject({ ok: true });
        }
      );
      expect(pixels(request)).toEqual([image]);
    } finally {
      faux.unregister();
    }
  });

  test("explicit untracked images reach the request only with global consent", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-advisor-image-request-"));
    execFileSync("git", ["init"], { cwd, stdio: "ignore" });
    writeFileSync(join(cwd, "capture.png"), Buffer.from(png, "base64"));

    const faux = registerFauxProvider({
      api: "pi-advisor-image-file-test",
      models: [{ id: "advisor", input: ["text", "image"] }],
      provider: "pi-advisor-image-file-test",
    });

    const requests: any[] = [];

    try {
      await withAgentDir(
        {
          advisor: "pi-advisor-image-file-test/advisor",
          advisorGitContext: "off",
          advisorUntrackedContent: true,
        },
        async () => {
          faux.setResponses([
            (context) => {
              requests.push(
                context.messages.find((message) => message.role === "user")
              );

              return fauxAssistantMessage("Advice");
            },
          ]);
          await consultAdvisor(
            contextFor(cwd, faux, []),
            undefined,
            undefined,
            undefined,
            "executor-requested",
            undefined,
            undefined,
            ["capture.png"]
          );
        }
      );
      expect(pixels(requests[0])).toEqual([image]);
      expect(text(requests[0])).toContain(
        'File "capture.png": attached image pixels'
      );
    } finally {
      faux.unregister();
      rmSync(cwd, { force: true, recursive: true });
    }
  });

  test("surfaces image forwarding counts on the consultation result", async () => {
    const faux = registerFauxProvider({
      api: "pi-advisor-image-counts-test",
      models: [{ id: "advisor", input: ["text", "image"] }],
      provider: "pi-advisor-image-counts-test",
    });

    try {
      await withAgentDir(
        {
          advisor: "pi-advisor-image-counts-test/advisor",
          advisorGitContext: "off",
        },
        async (agentDir) => {
          faux.setResponses([() => fauxAssistantMessage("Advice")]);

          const result = await consultAdvisor(
            contextFor(agentDir, faux, [userEntry, userEntry])
          );

          expect(result.imageCount).toBe(1);
          expect(result.imagePartsSeen).toBe(2);
          expect(result.imageBytes).toBeGreaterThan(0);
          expect(result.imageOmissions).toBeUndefined();
        }
      );
    } finally {
      faux.unregister();
    }
  });

  test("discloses placeholder-only images even when no pixels attach", async () => {
    const request = await capturedConsultation(
      ["text", "image"],
      [
        {
          message: {
            content:
              "[Image: original 2574x1724, displayed at 2000x1340. Multiply coordinates by 1.29 to map to original image.]",
            role: "user",
          },
          type: "message",
        },
      ]
    );

    expect(pixels(request)).toEqual([]);
    expect(text(request)).toContain("Image disclosure:");
    expect(text(request)).toContain("0 image(s) attached");
  });

  test("explicit image files require consent, Git membership and a real supported format", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-advisor-images-"));
    execFileSync("git", ["init"], { cwd, stdio: "ignore" });
    writeFileSync(join(cwd, "tracked.png"), Buffer.from(png, "base64"));
    execFileSync("git", ["add", "tracked.png"], { cwd, stdio: "ignore" });
    writeFileSync(join(cwd, "new.png"), Buffer.from(png, "base64"));
    writeFileSync(join(cwd, "bad.png"), "not an image");
    writeFileSync(join(cwd, "fake.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

    for (const index of [1, 2, 3, 4, 5]) {
      writeFileSync(join(cwd, `copy-${index}.png`), Buffer.from(png, "base64"));
    }

    symlinkSync(join(cwd, "new.png"), join(cwd, "link.png"));

    try {
      const refused = await readImageFiles(
        cwd,
        ["new.png"],
        false,
        "untracked",
        1000,
        4
      );

      expect(refused).toMatchObject({ images: [], omitted: 1 });

      const duplicateRefused = await readImageFiles(
        cwd,
        ["new.png", "new.png"],
        false,
        "untracked",
        1000,
        4
      );

      expect(duplicateRefused).toMatchObject({ images: [], omitted: 1 });

      const duplicateInvalidPath = await readImageFiles(
        cwd,
        ["../new.png", "../new.png"],
        true,
        "untracked",
        1000,
        4
      );

      expect(duplicateInvalidPath).toMatchObject({ images: [], omitted: 1 });

      const accepted = await readImageFiles(
        cwd,
        ["tracked.png", "new.png", "bad.png", "link.png", "../new.png"],
        true,
        "tracked",
        1000,
        4
      );

      expect(accepted.images.map((item) => item.path)).toEqual(["tracked.png"]);
      expect(accepted.omitted).toBe(4);

      const untracked = await readImageFiles(
        cwd,
        ["new.png", "tracked.png"],
        true,
        "untracked",
        1000,
        4
      );

      expect(untracked.images.map((item) => item.path)).toEqual(["new.png"]);

      const malformed = await readImageFiles(
        cwd,
        ["fake.jpg"],
        true,
        "untracked",
        1000,
        4
      );

      expect(malformed).toMatchObject({ images: [], omitted: 1 });
      const copies = [1, 2, 3, 4, 5].map((index) => `copy-${index}.png`);

      const countLimited = await readImageFiles(
        cwd,
        copies,
        true,
        "untracked",
        1000,
        4
      );

      expect(countLimited.images).toHaveLength(4);
      expect(countLimited.omitted).toBe(1);

      const byteLimited = await readImageFiles(
        cwd,
        copies,
        true,
        "untracked",
        Buffer.from(png, "base64").length * 2,
        5
      );

      expect(byteLimited.images).toHaveLength(2);
      expect(byteLimited.omitted).toBe(3);
    } finally {
      rmSync(cwd, { force: true, recursive: true });
    }
  });
});
