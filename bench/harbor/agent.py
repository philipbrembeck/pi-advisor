"""Pinned Pi agent used by the repository-only Harbor adapter.

ReactBench currently resolves Harbor 0.18.0.  Its built-in Pi agent cannot
load an extension or configure a benchmark-local Codex endpoint, so this
class keeps those two pieces explicit while retaining compatibility with the
older Harbor agent API (and the newer API used by local Harbor installations).
A host-side broker owns the ChatGPT OAuth credential and enforces the USD lease
before normal Pi requests reach Codex; no credential is mounted into Harbor.
"""

from __future__ import annotations

import json
import shlex
import tempfile
from pathlib import Path, PurePosixPath
from typing import Any, override

from harbor.agents.installed.base import CliFlag, with_prompt_template
from harbor.agents.installed.pi import Pi
from harbor.agents.installed.node_install import nvm_node_install_snippet
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext

_REMOTE_PI_CONFIG_DIR = PurePosixPath("/tmp/harbor-pi-agent")
_CUSTOM_PROVIDER = "openai-codex"
_RECORDER_PATH = "/bench-source/bench/harbor/recorder.ts"
_DUMMY_CODEX_TOKEN = (
    "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0."
    "eyJodHRwczovL2FwaS5vcGVuYWkuY29tL2F1dGgiOnsiY2hhdGdwdF9hY2NvdW50X2lkIjoiYmVuY2gtcHJveHkifX0.x"
)
_CODEX_API = "openai-codex-responses"


class PiAdvisorAgent(Pi):
    """Run one pinned Pi treatment with the benchmark extension loaded."""

    CLI_FLAGS = [
        CliFlag(
            "thinking",
            cli="--thinking",
            type="enum",
            choices=["off", "minimal", "low", "medium", "high", "xhigh", "max"],
        ),
    ]

    def __init__(
        self,
        *args: Any,
        extension_path: str = "/bench-source/extensions/index.ts",
        extension_version: str | None = None,
        benchmark_arm: str | None = None,
        advisor_model: str | None = None,
        advisor_effort: str | None = None,
        codex_proxy_url: str | None = None,
        codex_broker_token: str | None = None,
        model_api: str = _CODEX_API,
        scout_enabled: str | bool = False,
        **kwargs: Any,
    ) -> None:
        # Harbor 0.18's Pi has no model_api parameter; newer Harbor versions
        # do.  Passing only the common BaseInstalledAgent arguments keeps this
        # class importable and runnable against both versions.
        super().__init__(*args, **kwargs)
        self._extension_path = extension_path
        self._extension_version = extension_version
        self._benchmark_arm = benchmark_arm
        self._advisor_model = advisor_model
        self._advisor_effort = advisor_effort
        self._codex_proxy_url = codex_proxy_url
        self._codex_broker_token = codex_broker_token
        self._model_api = model_api
        self._scout_enabled = str(scout_enabled).lower() in {"1", "true", "yes"}

    @staticmethod
    @override
    def name() -> str:
        return "pi-advisor"

    async def install(self, environment: BaseEnvironment) -> None:
        if not self._version:
            raise ValueError("PiAdvisorAgent requires an exact Pi package version")
        await self.exec_as_root(
            environment,
            command="apt-get update && apt-get install -y curl",
            env={"DEBIAN_FRONTEND": "noninteractive"},
        )
        package = shlex.quote(
            f"@earendil-works/pi-coding-agent@{self._version}"
        )
        await self.exec_as_agent(
            environment,
            command=(
                "set -euo pipefail; "
                "if command -v node >/dev/null 2>&1 && "
                "node -e 'process.exit(process.versions.node.startsWith(\"22.\") ? 0 : 1)'; then "
                "node --version; "
                "else "
                f"{nvm_node_install_snippet()}; "
                "fi && "
                f"npm install -g --ignore-scripts {package} && "
                "pi --version"
            ),
        )

    async def _upload_text(
        self,
        environment: BaseEnvironment,
        content: str,
        remote_path: str,
        filename: str,
    ) -> None:
        # _upload_config_text was added after Harbor 0.18.  The underlying
        # environment transfer API is present in both versions.
        with tempfile.TemporaryDirectory(prefix="pi-advisor-config-") as directory:
            local_path = Path(directory) / filename
            local_path.write_text(content, encoding="utf-8")
            await environment.upload_file(local_path, remote_path)

    def _models_json(self, model_id: str) -> dict[str, Any]:
        if not self._codex_proxy_url:
            raise ValueError("PiAdvisorAgent requires a host-side Codex proxy URL")
        if not self._codex_broker_token:
            raise ValueError("PiAdvisorAgent requires a per-trial broker token")

        model_ids = [model_id]
        if self._advisor_model and "/" in self._advisor_model:
            advisor_provider, advisor_id = self._advisor_model.split("/", 1)
            if advisor_provider != _CUSTOM_PROVIDER:
                raise ValueError(
                    f"PiAdvisorAgent only accepts the pinned {_CUSTOM_PROVIDER} Advisor provider"
                )
            if advisor_id not in model_ids:
                model_ids.append(advisor_id)
        models = [
            {
                "compat": {"supportsReasoningEffort": True},
                "contextWindow": 1_000_000,
                "id": current_id,
                "input": ["text"],
                "maxTokens": 16_384,
                "reasoning": True,
                "thinkingLevelMap": {
                    "high": "high",
                    "low": "low",
                    "max": "max",
                    "medium": "medium",
                    "minimal": "minimal",
                    "off": None,
                    "xhigh": "xhigh",
                },
            }
            for current_id in model_ids
        ]
        return {
            "providers": {
                _CUSTOM_PROVIDER: {
                    "api": self._model_api,
                    # Pi's Codex transport extracts an account id from a JWT
                    # before sending. This is deliberately non-secret; the
                    # host broker replaces the Authorization header with OAuth.
                    "apiKey": _DUMMY_CODEX_TOKEN,
                    "baseUrl": self._codex_proxy_url,
                    "compat": {"supportsReasoningEffort": True},
                    "headers": {"x-bench-proxy-token": self._codex_broker_token},
                    "models": models,
                }
            }
        }

    async def _write_config(
        self,
        environment: BaseEnvironment,
        executor_ref: str,
        model_id: str,
    ) -> None:
        if self._benchmark_arm == "E+A":
            if not self._advisor_model or not self._advisor_effort:
                raise ValueError("E+A requires an Advisor model and effort pin")
            advisor_config: dict[str, Any] = {
                "advisor": self._advisor_model,
                "advisorAutoLoopGate": False,
                "advisorCompletionGate": False,
                "advisorEffort": self._advisor_effort,
                "advisorFailureGate": True,
                "advisorMaxCallsPerSession": 1,
                "advisorPlanGate": False,
                "advisorRedactSecrets": True,
                "advisorScoutEnabled": self._scout_enabled,
            }
        else:
            advisor_config = {
                "advisorAutoLoopGate": False,
                "advisorCompletionGate": False,
                "advisorFailureGate": False,
                "advisorMaxCallsPerSession": 0,
                "advisorPlanGate": False,
                "advisorScoutEnabled": False,
            }
        config = {
            **advisor_config,
            "advisorGitContext": "summary",
            "advisorHerdrIntegration": False,
            "advisorTrackedFileContent": False,
            "advisorUntrackedContent": False,
            "executor": executor_ref,
            "executorEffort": self._resolved_flags.get("thinking", "max"),
            "simpleMode": False,
        }
        config_dir = _REMOTE_PI_CONFIG_DIR.as_posix()
        await self.exec_as_agent(
            environment,
            command=f"mkdir -p {shlex.quote(config_dir)} && chmod 700 {shlex.quote(config_dir)}",
        )
        await self._upload_text(
            environment,
            json.dumps(self._models_json(model_id), sort_keys=True) + "\n",
            (_REMOTE_PI_CONFIG_DIR / "models.json").as_posix(),
            "models.json",
        )
        await self._upload_text(
            environment,
            json.dumps(config, sort_keys=True) + "\n",
            (_REMOTE_PI_CONFIG_DIR / "advisor.json").as_posix(),
            "advisor.json",
        )
        await self.exec_as_agent(
            environment,
            command=(
                f"chmod 600 {shlex.quote((_REMOTE_PI_CONFIG_DIR / 'models.json').as_posix())} "
                f"{shlex.quote((_REMOTE_PI_CONFIG_DIR / 'advisor.json').as_posix())}"
            ),
        )

    @override
    @with_prompt_template
    async def run(
        self,
        instruction: str,
        environment: BaseEnvironment,
        context: AgentContext,
    ) -> None:
        del context
        if not self._extension_version:
            raise ValueError("PiAdvisorAgent requires an extension version pin")
        if not self._benchmark_arm:
            raise ValueError("PiAdvisorAgent requires a benchmark arm")
        if self._model_api != _CODEX_API:
            raise ValueError(
                "PiAdvisorAgent requires the pinned openai-codex-responses transport"
            )
        if not self.model_name or "/" not in self.model_name:
            raise ValueError("Model name must be in provider/model format")
        provider, model_id = self.model_name.split("/", 1)
        if provider != _CUSTOM_PROVIDER:
            raise ValueError(
                f"PiAdvisorAgent only accepts the pinned {_CUSTOM_PROVIDER} provider"
            )
        if not self._codex_proxy_url or not self._codex_broker_token:
            raise ValueError("PiAdvisorAgent requires host-side Codex broker settings")

        await self._write_config(environment, self.model_name, model_id)

        # Harbor scopes ``extra_env`` onto every agent command. The trial
        # wrapper never supplies provider credentials here, and the model
        # config contains only the dummy JWT above.
        env = dict(getattr(self, "_extra_env", {}))
        env.update(
            {
                "BENCH_ADAPTER_MODE": (
                    "advisor" if self._benchmark_arm == "E+A" else "executor"
                ),
                "BENCH_TASK_ARM": self._benchmark_arm,
                "BENCH_ADVISOR_EFFORT": self._advisor_effort or "",
                "BENCH_ADVISOR_MODEL": self._advisor_model or "",
                "BENCH_EXECUTOR_EFFORT": self._resolved_flags.get("thinking", "max"),
                "BENCH_EXECUTOR_MODEL": self.model_name,
                "BENCH_PI_ADVISOR_VERSION": self._extension_version,
                "PI_CODING_AGENT_DIR": _REMOTE_PI_CONFIG_DIR.as_posix(),
            }
        )
        is_advisor_treatment = self._benchmark_arm == "E+A"
        quoted_instruction = shlex.quote(
            (
                "BENCHMARK PROTOCOL (mandatory): before using any other tool, "
                "call ask_advisor with an empty JSON object exactly once. Wait "
                "for its result, then continue the task and do not call it again.\n\n"
                if is_advisor_treatment
                else ""
            )
            + instruction
        )
        system_prompt = (
            "This is a benchmark E+A treatment. The first tool call must be "
            "ask_advisor with {} before any read, shell, edit, or write. Make "
            "exactly one Advisor call total, wait for its result, and then "
            "continue the task."
            if is_advisor_treatment
            else None
        )
        excluded_tools = (
            " --exclude-tools ask_advisor,record_advisor_outcome"
            if not is_advisor_treatment
            else ""
        )
        cli_flags = self.build_cli_flags()
        cli_flags = f" {cli_flags}" if cli_flags else ""
        appended_system_prompt = (
            f" --append-system-prompt {shlex.quote(system_prompt)}"
            if system_prompt
            else ""
        )
        command = (
            "set -euo pipefail; "
            "test -d /logs/agent && test -w /logs/agent; "
            "printf 'benchmark agent started\\n' > /logs/agent/pi.txt; "
            ". ~/.nvm/nvm.sh 2>/dev/null || true; "
            "export NODE_PATH=\"$(npm root -g)\"; "
            f"pi --print --mode json --no-extensions --no-context-files "
            f"--extension {shlex.quote(self._extension_path)} "
            f"--extension {shlex.quote(_RECORDER_PATH)} "
            "--session-dir /logs/agent/pi/sessions "
            f"--provider {shlex.quote(_CUSTOM_PROVIDER)} "
            f"--model {shlex.quote(model_id)}"
            f"{cli_flags}{appended_system_prompt}{excluded_tools} "
            f"{quoted_instruction} "
            "2>&1 | tee -a /logs/agent/pi.txt"
        )
        await self.exec_as_agent(environment, command=command, env=env)
