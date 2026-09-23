const STABLE_VERSION_PATTERN =
  /^(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)$/u;

const isString = (value: unknown): value is string => typeof value === "string";

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(isString);

const parsePublishedVersions = (json: string): string[] => {
  const parsed: unknown = JSON.parse(json);
  if (isString(parsed)) {
    return [parsed];
  }
  if (isStringArray(parsed)) {
    return parsed;
  }
  throw new TypeError("npm returned an invalid package version list.");
};

export const nextDevVersion = (
  packageVersion: string,
  publishedVersions: readonly string[]
): string => {
  const match = STABLE_VERSION_PATTERN.exec(packageVersion);
  if (!match?.groups) {
    throw new TypeError(
      `Expected a stable package version, received ${packageVersion}.`
    );
  }

  const major = Number(match.groups.major);
  const minor = Number(match.groups.minor);
  const patch = Number(match.groups.patch);
  if (
    ![major, minor, patch].every((value) => Number.isSafeInteger(value)) ||
    !Number.isSafeInteger(patch + 1)
  ) {
    throw new RangeError(
      `Package version is outside the supported numeric range: ${packageVersion}.`
    );
  }

  const prefix = `${major}.${minor}.${patch + 1}-dev.`;
  let highestSequence = 0;

  for (const version of publishedVersions) {
    if (!version.startsWith(prefix)) {
      continue;
    }

    const sequenceMatch = /^(?<sequence>0|[1-9]\d*)$/u.exec(
      version.slice(prefix.length)
    );
    if (!sequenceMatch?.groups?.sequence) {
      continue;
    }

    const sequence = Number(sequenceMatch.groups.sequence);
    if (!Number.isSafeInteger(sequence)) {
      throw new RangeError(
        `Published development version has an invalid sequence: ${version}.`
      );
    }
    highestSequence = Math.max(highestSequence, sequence);
  }

  if (!Number.isSafeInteger(highestSequence + 1)) {
    throw new RangeError(
      `Development sequence is outside the supported numeric range for ${prefix}.`
    );
  }

  return `${prefix}${highestSequence + 1}`;
};

if (import.meta.main) {
  const packageVersion = process.argv.at(2);
  if (packageVersion === undefined) {
    throw new TypeError(
      "Pass the stable package version as the first argument."
    );
  }

  const publishedVersions = parsePublishedVersions(await Bun.stdin.text());
  process.stdout.write(
    `${nextDevVersion(packageVersion, publishedVersions)}\n`
  );
}
