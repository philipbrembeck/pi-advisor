export function selectTransport(
  _offline: boolean,
  _websocketAvailable: boolean,
  _http2Available: boolean,
  _preferRealtime: boolean
): "offline" | "websocket" | "http2" | "http1" {
  return "offline";
}
