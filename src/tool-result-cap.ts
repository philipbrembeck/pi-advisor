import {
  DEFAULT_ADVISOR_TOOL_RESULT_MAX_BYTES,
  DEFAULT_ADVISOR_TOOL_RESULT_MAX_LINES,
} from "./config/types.ts";
import { byteLength, capUtf8Bytes } from "./content-utils.ts";

export interface ToolResultTruncation {
  content: string;
  omittedLines: number;
  totalBytes: number;
  totalLines: number;
  truncated: boolean;
}

const OMITTED_MARKER = "[... omitted tool-result section ...]";

export const capToolResult = (
  value: string,
  maxLines = DEFAULT_ADVISOR_TOOL_RESULT_MAX_LINES,
  maxBytes = DEFAULT_ADVISOR_TOOL_RESULT_MAX_BYTES
): ToolResultTruncation => {
  const lines = value.split("\n");
  const totalLines = lines.length;
  const totalBytes = byteLength(value);
  if ((maxLines === 0 || maxBytes === 0) && value.length > 0) {
    return {
      content: "[Tool result omitted: configured limit is zero]",
      omittedLines: totalLines,
      totalBytes,
      totalLines,
      truncated: true,
    };
  }
  if (totalLines <= maxLines && totalBytes <= maxBytes) {
    return {
      content: value,
      omittedLines: 0,
      totalBytes,
      totalLines,
      truncated: false,
    };
  }

  const markerBytes = byteLength(OMITTED_MARKER);
  if (maxBytes < markerBytes || maxLines === 1) {
    return {
      content: capUtf8Bytes(OMITTED_MARKER, maxBytes),
      omittedLines: totalLines,
      totalBytes,
      totalLines,
      truncated: true,
    };
  }
  const headCount = Math.floor((maxLines - 1) / 2);
  const tailCount = maxLines - 1 - headCount;
  const collect = (
    candidates: string[],
    maxEntries: number,
    maxContentBytes: number
  ) => {
    const selected: string[] = [];
    let used = 0;
    for (const line of candidates.slice(0, maxEntries)) {
      const next = used + byteLength(line) + (selected.length ? 1 : 0);
      if (next > maxContentBytes) {
        break;
      }
      selected.push(line);
      used = next;
    }
    return selected;
  };
  const availableBytes = maxBytes - markerBytes - 2;
  const head = collect(lines, headCount, Math.floor(availableBytes / 2));
  const tail = collect(
    lines.slice(Math.max(head.length, lines.length - tailCount)),
    tailCount,
    availableBytes - byteLength(head.join("\n"))
  );
  const content = [...head, OMITTED_MARKER, ...tail].join("\n");
  return {
    content,
    omittedLines: Math.max(0, totalLines - head.length - tail.length),
    totalBytes,
    totalLines,
    truncated: true,
  };
};
