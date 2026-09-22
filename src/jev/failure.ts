export type JevErrorCategory =
  | "auth"
  | "timeout"
  | "network"
  | "malformed"
  | "error";

/** A classified, redacted Jev failure; never carries key material. */
export class JevFailureError extends Error {
  readonly category: JevErrorCategory;

  constructor(category: JevErrorCategory, message: string) {
    super(message);
    this.name = "JevFailureError";
    this.category = category;
  }
}

export { JevFailureError as JevFailure };
