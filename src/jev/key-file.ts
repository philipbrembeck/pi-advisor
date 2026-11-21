import { randomUUID } from "node:crypto";
import {
  closeSync,
  openSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";

const KEY_FILE_MODE = 0o600;

export const writeKeyFile = (path: string, key: string) => {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let fileDescriptor: number | undefined;

  try {
    fileDescriptor = openSync(temporaryPath, "wx", KEY_FILE_MODE);
    writeFileSync(fileDescriptor, `${key}\n`, "utf-8");
    closeSync(fileDescriptor);
    fileDescriptor = undefined;
    renameSync(temporaryPath, path);
  } catch (error) {
    if (fileDescriptor !== undefined) {
      closeSync(fileDescriptor);
    }

    try {
      unlinkSync(temporaryPath);
    } catch {
      // The temporary file may not exist.
    }

    throw error;
  }
};
