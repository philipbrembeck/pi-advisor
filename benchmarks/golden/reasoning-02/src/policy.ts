export function canUseFeature(
  role: "admin" | "member" | "guest",
  enabled: boolean,
  rolloutPercent: number,
  bucket: number
): boolean {
  if (role === "admin") {
    return true;
  }
  if (role === "guest" || !enabled) {
    return false;
  }
  const rollout = Math.max(0, Math.min(100, rolloutPercent));
  return bucket >= 0 && bucket < rollout;
}
