import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { resolve } from "node:path";

import type { ImageContent } from "@earendil-works/pi-ai/compat";

import {
  imageFileCandidate,
  imageMime,
  normalizeRequestedPath,
  permittedPaths,
  repositoryRoot,
  within,
} from "./attachments.ts";
import { isString } from "./content-utils.ts";
import { ADVISOR_IMAGE_MAX_BYTES, imageFromBytes } from "./images.ts";

export interface ImageAttachment {
  bytes: number;
  image: ImageContent;
  path: string;
}

const readImageAttachment = async (
  root: string,
  name: string,
  mimeType: string,
  remaining: number
): Promise<ImageAttachment | undefined> => {
  const absolute = resolve(root, name);

  if (!within(root, absolute)) {
    return;
  }

  const stats = await lstat(absolute);

  if (stats.isSymbolicLink() || !stats.isFile()) {
    return;
  }

  const resolved = await realpath(absolute);

  if (!within(root, resolved)) {
    return;
  }

  const flags = constants.O_NOFOLLOW
    ? constants.O_RDONLY + constants.O_NOFOLLOW
    : constants.O_RDONLY;

  const file = await open(resolved, flags);

  try {
    const opened = await file.stat();

    if (
      !opened.isFile() ||
      opened.size > ADVISOR_IMAGE_MAX_BYTES ||
      opened.size > remaining
    ) {
      return;
    }

    const buffer = Buffer.alloc(opened.size + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);

    if (bytesRead !== opened.size) {
      return;
    }

    const image = imageFromBytes(buffer.subarray(0, bytesRead), mimeType);

    return image ? { bytes: bytesRead, image, path: name } : undefined;
  } finally {
    await file.close();
  }
};

export const readImageFiles = async (
  cwd: string,
  requested: string[],
  enabled: boolean,
  kind: "tracked" | "untracked",
  remainingBytes: number,
  remainingCount: number
): Promise<{ images: ImageAttachment[]; omitted: number }> => {
  const names = [
    ...new Set(
      Array.isArray(requested)
        ? requested.filter((path) => isString(path) && imageFileCandidate(path))
        : []
    ),
  ];

  if (!enabled || !names.length) {
    return { images: [], omitted: names.length };
  }

  const root = await repositoryRoot(cwd);

  if (!root) {
    return { images: [], omitted: names.length };
  }

  const seen = new Set<string>();
  const candidates: { mime: string; name: string }[] = [];

  for (const path of names) {
    const name = normalizeRequestedPath(root, path);

    if (!name || seen.has(name)) {
      continue;
    }

    seen.add(name);

    const mime = imageMime(name);

    if (mime) {
      candidates.push({ mime, name });
    }
  }

  let permitted: Set<string>;

  try {
    permitted = permittedPaths(
      root,
      candidates.map((candidate) => candidate.name),
      kind
    );
  } catch {
    return { images: [], omitted: names.length };
  }

  const images: ImageAttachment[] = [];
  let omitted = names.length - candidates.length;
  let bytes = 0;

  for (const { mime, name } of candidates) {
    try {
      const image =
        images.length < remainingCount &&
        remainingBytes - bytes > 0 &&
        permitted.has(name)
          ? await readImageAttachment(root, name, mime, remainingBytes - bytes)
          : undefined;

      if (image) {
        images.push(image);
        bytes += image.bytes;
      } else {
        omitted += 1;
      }
    } catch {
      omitted += 1;
    }
  }

  return { images, omitted };
};
