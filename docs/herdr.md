# Herdr integration

pi-advisor can report Advisor activity, blocked-state labels, and Advisor failures to [Herdr](https://herdr.dev/). The integration is optional and never controls whether Advisor work proceeds.

## Compatibility baseline

This document was verified against:

- Herdr **0.8.0**, socket protocol **19**, schema version **1**, using the generated schema bundled with the `v0.8.0` source release.
- Herdr **0.7.5**, socket protocol **17**, schema version **1**, using the schema bundled with the installed binary. The `pane.report_metadata` and `notification.show` request definitions used by pi-advisor are identical in 0.7.5 and 0.8.0.
- Herdr's stable [Socket API](https://herdr.dev/docs/socket-api/), [CLI reference](https://herdr.dev/docs/cli-reference/), and [Agent automation](https://herdr.dev/docs/agent-automation/) documentation.

The installed binary is the authority for a particular machine. Before changing request fields, inspect its schema:

```bash
herdr --version
herdr api schema
herdr api schema --json
herdr api schema --output herdr-api.schema.json
```

Herdr documents preview features separately under `/docs/preview/`. Do not implement against preview documentation unless the project deliberately raises its compatibility baseline.

## Transport and discovery

Herdr's raw API uses newline-delimited JSON over a local Unix domain socket or a Windows named pipe. Each request has an `id`, `method`, and `params`; the response repeats the request `id` and contains either `result` or `error`.

Herdr injects these values into managed pane processes:

| Variable            | pi-advisor use                            |
| ------------------- | ----------------------------------------- |
| `HERDR_ENV=1`       | Confirms that Pi is running inside Herdr. |
| `HERDR_SOCKET_PATH` | Selects the local socket or pipe.         |
| `HERDR_PANE_ID`     | Identifies the pane receiving metadata.   |

pi-advisor sends nothing unless all three values are available. On Windows, `src/herdr.ts` converts the injected socket value to a `\\.\pipe\...` endpoint.

Herdr's documented general socket-resolution order is an explicit CLI session, `HERDR_SOCKET_PATH`, `HERDR_SESSION`, then the default-session socket. pi-advisor does not perform that resolution itself; it uses only the injected `HERDR_SOCKET_PATH`.

## Requests sent by pi-advisor

The exact TypeScript request types and transport live in [`src/herdr.ts`](../src/herdr.ts).

### Advisor activity

When the first overlapping consultation starts, pi-advisor sends a display label:

```json
{
  "id": "pi-advisor:advisor-activity:<sequence>",
  "method": "pane.report_metadata",
  "params": {
    "pane_id": "<HERDR_PANE_ID>",
    "source": "pi-advisor:advisor-activity",
    "agent": "pi",
    "applies_to_source": "herdr:pi",
    "state_labels": { "working": "seeking advice" },
    "seq": 123
  }
}
```

The label is cleared after the last overlapping consultation finishes, or when activity is explicitly reset:

```json
{
  "id": "pi-advisor:advisor-activity:<sequence>",
  "method": "pane.report_metadata",
  "params": {
    "pane_id": "<HERDR_PANE_ID>",
    "source": "pi-advisor:advisor-activity",
    "agent": "pi",
    "applies_to_source": "herdr:pi",
    "clear_state_labels": true,
    "seq": 124
  }
}
```

### Blocked state

A gate block uses two separate paths:

1. pi-advisor emits the in-process Pi event `herdr:blocked`. Herdr's Pi lifecycle integration owns the semantic blocked state.
2. pi-advisor sends `pane.report_metadata` with a display-only `blocked` label and later clears that label.

This distinction matters. Herdr documents `pane.report_metadata` as presentation metadata: it can change visible labels, but it does **not** change semantic lifecycle state, waits, notifications, or rollups. Do not replace the in-process blocked event with a metadata-only report.

The blocked label is secret-redacted, stripped of control characters, whitespace-normalized, and capped at 200 characters by pi-advisor. Repeated calls update metadata but emit only the first false-to-true blocked edge. Clearing emits the true-to-false edge once. A previously reported block is still cleared if the setting was disabled after the block occurred.

### Failure notification

Advisor failures can send:

```json
{
  "id": "pi-advisor:advisor-notification:<sequence>",
  "method": "notification.show",
  "params": {
    "title": "<sanitized title>",
    "body": "<sanitized body>",
    "position": "top-left",
    "sound": "request"
  }
}
```

Herdr 0.7.5 and 0.8.0 require a visible title after normalization. They permit `sound` values `none`, `done`, or `request`; notification delivery may still report `disabled`, `rate_limited`, `no_foreground_client`, or `busy`. pi-advisor caps titles at 80 characters and bodies at 240 characters, matching Herdr's documented normalization limits.

## Metadata ownership and ordering

- `source` identifies pi-advisor's metadata owner. Herdr restricts source identifiers to 80 characters using ASCII letters, digits, colon, dot, underscore, and hyphen.
- `agent: "pi"` guards presentation fields so they apply only to a Pi agent.
- `applies_to_source: "herdr:pi"` guards presentation fields so they apply only while Herdr's Pi lifecycle integration is authoritative.
- `seq` prevents stale updates from winning. For the same source, Herdr accepts but ignores sequence numbers less than or equal to the last accepted value.
- `clear_state_labels: true` clears labels owned by that metadata source; it does not clear semantic agent state.

Keep activity and block reports on their existing distinct sources. Combining them would let one cleanup operation erase the other's label.

## Failure behavior and privacy

Herdr is best-effort in pi-advisor:

- socket requests are destroyed after 500 ms;
- the connection closes after the first response;
- socket, emitter, and reporting errors are swallowed;
- there are no retries; and
- Herdr transport failures never weaken or strengthen Advisor safety policy.

Activity reports contain fixed labels only. Block labels and notification text pass through pi-advisor's local secret redaction before they leave the process. Session summaries and Advisor conversation context are never sent to Herdr.

The local socket has no pi-advisor-specific authentication handshake or encryption. Access control comes from the local socket or named-pipe environment managed by Herdr.

## Configuration

`advisorHerdrIntegration` is a boolean setting and defaults to `true`. Change it through `/advisor-settings` or in the global `~/.pi/agent/advisor.json` configuration. See [Configuration](configuration.md) and [Privacy and data handling](privacy.md).

Disabling the setting suppresses new activity, block-label, and failure-notification reports. Cleanup for an already reported blocked state remains enabled so Herdr is not left showing stale state.

## Change checklist

Before changing the integration:

1. Run `herdr --version` and export the installed schema.
2. Validate every changed request against that schema and the stable online Socket API.
3. Preserve the semantic-state versus display-metadata boundary.
4. Test overlapping activity, block edges, clearing after disablement, sanitization, socket errors, and timeouts.
5. Run the repository checks in [Development](development.md), then verify the state and notification behavior in a reloaded Herdr-hosted Pi TUI.

## Sources

- [Herdr stable Socket API](https://herdr.dev/docs/socket-api/)
- [Herdr stable CLI reference](https://herdr.dev/docs/cli-reference/)
- [Herdr stable Agent automation guide](https://herdr.dev/docs/agent-automation/)
- [Herdr repository](https://github.com/herdrdev/herdr)
- [`src/herdr.ts`](../src/herdr.ts) — pi-advisor's request and transport implementation
