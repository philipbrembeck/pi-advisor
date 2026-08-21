export function canUseFeature(
  _role: "admin" | "member" | "guest",
  _enabled: boolean,
  _rolloutPercent: number,
  _bucket: number
): boolean {
  return false;
}
