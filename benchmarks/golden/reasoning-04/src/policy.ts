/* biome-ignore-all lint/suspicious/noUnnecessaryConditions: the policy deliberately covers both online and offline branches. */
export function cachePolicy(
  fresh: boolean,
  staleAllowed: boolean,
  offline: boolean,
  critical: boolean
): "cache" | "stale" | "network" | "error" {
  if (fresh) {
    return "cache";
  }
  if (offline && staleAllowed && !critical) {
    return "stale";
  }
  if (!offline) {
    return "network";
  }
  return "error";
}
