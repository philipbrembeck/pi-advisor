export const DEFAULT_HARBOR_AGENT_TIMEOUT_SEC = 3600;
export const MAX_HARBOR_AGENT_TIMEOUT_SEC = 7200;
export const MAX_HARBOR_INFRA_RETRIES = 2;
export const HARBOR_INFRA_RETRY_BACKOFF_MS = [5000, 15_000] as const;

// Harbor applies --agent-timeout to the agent, but setup, verification, and
// environment cleanup happen outside that clock.
export const HARBOR_SETUP_ALLOWANCE_SEC = 1800;
export const HARBOR_CLEANUP_ALLOWANCE_SEC = 600;
export const HARBOR_TERMINATION_MARGIN_SEC = 60;

export const parseHarborAgentTimeout = (value: string | undefined) => {
  if (!value) {
    return DEFAULT_HARBOR_AGENT_TIMEOUT_SEC;
  }
  const timeout = Number(value);
  if (
    !Number.isFinite(timeout) ||
    timeout <= 0 ||
    timeout > MAX_HARBOR_AGENT_TIMEOUT_SEC
  ) {
    throw new TypeError(
      `BENCH_HARBOR_AGENT_TIMEOUT_SEC must be finite and between 1 and ${MAX_HARBOR_AGENT_TIMEOUT_SEC} seconds.`
    );
  }
  return timeout;
};

const retryBackoffSec =
  HARBOR_INFRA_RETRY_BACKOFF_MS.reduce((total, value) => total + value, 0) /
  1000;

export const harborAttemptTimeoutMs = (agentTimeoutSec: number) => {
  if (
    !Number.isFinite(agentTimeoutSec) ||
    agentTimeoutSec <= 0 ||
    agentTimeoutSec > MAX_HARBOR_AGENT_TIMEOUT_SEC
  ) {
    throw new TypeError(
      "Harbor agent timeout must be within its configured bound."
    );
  }
  return Math.ceil((agentTimeoutSec + HARBOR_SETUP_ALLOWANCE_SEC) * 1000);
};

/**
 * Bounds the outer adapter command for every possible sequential attempt,
 * including fixed retry backoffs and wrapper cleanup after each attempt.
 */
export const harborCommandTimeoutMs = (agentTimeoutSec: number) =>
  Math.ceil(
    ((MAX_HARBOR_INFRA_RETRIES + 1) *
      (harborAttemptTimeoutMs(agentTimeoutSec) / 1000 +
        HARBOR_CLEANUP_ALLOWANCE_SEC) +
      retryBackoffSec +
      HARBOR_TERMINATION_MARGIN_SEC) *
      1000
  );
