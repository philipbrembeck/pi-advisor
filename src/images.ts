import { createHash } from "node:crypto";

import type { ImageContent, TextContent } from "@earendil-works/pi-ai/compat";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { AdvisorToolPolicies } from "./config/types.ts";
import { contentParts, isRecordOf, isString } from "./content-utils.ts";
import type { RecordValue } from "./content-utils.ts";
import { detectImageFormat } from "./image-validation.ts";
import { sessionContextEntries } from "./session-context.ts";

export const ADVISOR_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
export const ADVISOR_IMAGES_TOTAL_MAX_BYTES = 8 * 1024 * 1024;
export const ADVISOR_IMAGES_MAX_COUNT = 4;

export const imageFromBytes = (
  bytes: Buffer,
  mimeType?: string
): ImageContent | undefined => {
  if (!bytes.length || bytes.length > ADVISOR_IMAGE_MAX_BYTES) {
    return;
  }

  const actual = detectImageFormat(bytes);

  if (!actual || (mimeType && mimeType !== actual)) {
    return;
  }

  return { data: bytes.toString("base64"), mimeType: actual, type: "image" };
};

export const imageFromPart = (part: RecordValue): ImageContent | undefined => {
  if (
    part.type !== "image" ||
    !isString(part.data) ||
    !isString(part.mimeType) ||
    part.data.length > Math.ceil((ADVISOR_IMAGE_MAX_BYTES * 4) / 3) + 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      part.data
    )
  ) {
    return;
  }

  const bytes = Buffer.from(part.data, "base64");

  if (bytes.toString("base64") !== part.data) {
    return;
  }

  return imageFromBytes(bytes, part.mimeType);
};

const IMAGE_OMITTED_MARKER =
  "[Image omitted: unsupported format, invalid data, or over 4 MiB; pixels not reviewed]";

const imageMarkerFromImage = (
  image: Pick<ImageContent, "data">,
  nonce = ""
): string => {
  const id = createHash("sha256")
    .update(nonce)
    .update(image.data)
    .digest("hex")
    .slice(0, 24);

  return `[Image ref=img_${id}; pixels reviewed only if attached below]`;
};

export const imageMarker = (
  part: RecordValue,
  nonce = ""
): string | undefined => {
  if (part.type !== "image") {
    return;
  }

  const image = imageFromPart(part);

  return image ? imageMarkerFromImage(image, nonce) : IMAGE_OMITTED_MARKER;
};

interface SelectedImage {
  image: ImageContent;
  marker: string;
}

export interface ConversationImageCensus {
  imagePartsSeen: number;
  selected: SelectedImage[];
}

const eligibleImagePart = (part: RecordValue) =>
  part.type === "image" && isString(part.data) && isString(part.mimeType);

interface ImagePartCensus {
  parts: number;
  selected: SelectedImage[];
}

const entryImageCensus = (
  content: string | (ImageContent | TextContent)[],
  conversation: string,
  nonce: string,
  seen: Set<string>
): ImagePartCensus => {
  let parts = 0;
  const selected: SelectedImage[] = [];

  for (const part of contentParts(content)) {
    if (!isRecordOf(part)) {
      continue;
    }

    if (eligibleImagePart(part)) {
      parts += 1;
    }

    if (part.type !== "image") {
      continue;
    }

    const image = imageFromPart(part);

    const marker = image
      ? imageMarkerFromImage(image, nonce)
      : IMAGE_OMITTED_MARKER;

    if (!image || seen.has(marker) || !conversation.includes(marker)) {
      continue;
    }

    seen.add(marker);
    selected.push({ image, marker });
  }

  return { parts, selected };
};

export const selectedConversationImages = (
  ctx: ExtensionContext,
  conversation: string,
  policies: AdvisorToolPolicies,
  selectedEntryIds: ReadonlySet<string> | undefined,
  nonce: string
): ConversationImageCensus => {
  if (!conversation) {
    return { imagePartsSeen: 0, selected: [] };
  }

  const entries = sessionContextEntries(ctx);
  const images: SelectedImage[] = [];
  const seen = new Set<string>();
  let imagePartsSeen = 0;

  for (const [index, entry] of entries.entries()) {
    if (
      entry.type !== "message" ||
      (selectedEntryIds !== undefined &&
        !selectedEntryIds.has(entry.id ?? String(index)))
    ) {
      continue;
    }

    const { message } = entry;

    if (message.role !== "user" && message.role !== "toolResult") {
      continue;
    }

    if (
      message.role === "toolResult" &&
      (policies[message.toolName] ?? "full") !== "full"
    ) {
      continue;
    }

    const census = entryImageCensus(message.content, conversation, nonce, seen);
    imagePartsSeen += census.parts;
    images.push(...census.selected);
  }

  return { imagePartsSeen, selected: images };
};
