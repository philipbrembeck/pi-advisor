export function cachePolicy(
  _fresh: boolean,
  _staleAllowed: boolean,
  _offline: boolean,
  _critical: boolean
): "cache" | "stale" | "network" | "error" {
  return "error";
}
