export function choose(version: number, cached: boolean): string {
  if (cached) {
    return "cached";
  }
  return version >= 2 ? "v2" : "legacy";
}
