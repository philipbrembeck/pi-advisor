export function selectTransport(
  offline: boolean,
  websocketAvailable: boolean,
  http2Available: boolean,
  preferRealtime: boolean
): "offline" | "websocket" | "http2" | "http1" {
  if (offline) {
    return "offline";
  }
  if (preferRealtime && websocketAvailable) {
    return "websocket";
  }
  if (http2Available) {
    return "http2";
  }
  return "http1";
}
