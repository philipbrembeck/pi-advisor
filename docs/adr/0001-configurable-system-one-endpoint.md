# Configurable System One–compatible Jev endpoint

pi-advisor shipped three hardcoded Jev providers: TypeSafe's own API, an OpenRouter route, and OpenAI Decisions. TypeSafe-compatible endpoints are an established pattern elsewhere (LangSmith, GoModel, Vercel AI Gateway, Codiv/OpenJev, and local decision-model servers all document a configurable base URL against the same `POST {base}/v1/systemone` contract), and pi-advisor had no way to reach them.

We added `typesafe-compatible` as a fourth transport with a user-supplied `advisorJevBaseUrl`, plus an optional `advisorJevKeyProvider` that reuses a named Pi provider login. We also split provider selection out of the consultation-filter row into its own **Jev provider** row.

This deliberately reverses a documented promise: `docs/configuration.md` stated that "the standalone unverified transport control is intentionally absent", because a provider was only ever saved after a successful live verification, together with the filter's enabled state. The standalone row is now present, so the safety property is enforced differently — the provider row still live-verifies before saving, and the filter row performs a credential _resolution_ check (no network call) before it will switch on. The old atomic write transaction is retired; it existed to keep a verified provider from being saved without the filter, which is no longer a meaningful pairing.

## Considered options

- **A provider profile (`{ contract, baseUrl, model, keySource }`) replacing the transport enum.** Modelled the domain more honestly and would have collapsed OpenRouter into a profile, but it is a config migration that redefines `auto` and invalidates released documentation. Rejected as premature; revisit if two custom endpoints are ever needed at once.
- **Storing a full endpoint URL instead of a Base URL.** A superset that could have expressed OpenRouter's `/alpha/decisions` path, at the cost of abandoning the convention every other implementation follows. Rejected; OpenRouter stays a named transport.
- **Letting `auto` select the custom endpoint.** Rejected: `auto` is a zero-config bootstrap, and a stale Base URL would silently resume receiving screening evidence after the user switched away.
- **Mirroring the TypeSafe chain's plaintext `advisor.json` key fallback.** Rejected as legacy we should not propagate; the endpoint key lives in Bun.secrets, `JEV_API_KEY`, or a 0600 file.

## Consequences

An arbitrary user-supplied host can now receive screening evidence (the question, draft, and digest). That is the same bounded evidence every provider receives, and the endpoint is always an explicit, live-verified choice, but it is no longer a vendor pi-advisor can vouch for. Plain `http` is permitted only for loopback addresses, because local decision-model servers are a documented target and cannot present TLS.
