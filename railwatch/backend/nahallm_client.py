from __future__ import annotations

import asyncio
import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class NahaLLMConfig:
    base_url: str
    api_key: str
    model: str = "balanced"
    timeout_seconds: float = 20.0

    @property
    def configured(self) -> bool:
        return bool(self.base_url and self.api_key)


def get_config() -> NahaLLMConfig:
    return NahaLLMConfig(
        base_url=os.getenv("NAHALLM_URL", "").rstrip("/"),
        api_key=os.getenv("NAHALLM_API_KEY", ""),
        model=os.getenv("NAHALLM_MODEL", "balanced"),
        timeout_seconds=float(os.getenv("NAHALLM_TIMEOUT_SECONDS", "20")),
    )


class NahaLLMError(RuntimeError):
    pass


async def chat(messages: list[dict[str, str]], *, model: str | None = None) -> dict[str, Any]:
    config = get_config()
    if not config.configured:
        raise NahaLLMError("NahaLLM is not configured")

    payload = json.dumps({
        "model": model or config.model,
        "messages": messages,
        "stream": False,
        "temperature": 0.2,
    }).encode("utf-8")

    def call() -> dict[str, Any]:
        request = urllib.request.Request(
            f"{config.base_url}/v1/chat/completions",
            data=payload,
            method="POST",
            headers={
                "Authorization": f"Bearer {config.api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=config.timeout_seconds) as response:
                body = response.read().decode("utf-8")
                return json.loads(body)
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:1000]
            raise NahaLLMError(f"NahaLLM HTTP {exc.code}: {detail}") from exc
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            raise NahaLLMError(f"NahaLLM request failed: {exc}") from exc

    return await asyncio.to_thread(call)


def extract_text(response: dict[str, Any]) -> str:
    choices = response.get("choices") or []
    if not choices:
        raise NahaLLMError("NahaLLM returned no choices")
    content = choices[0].get("message", {}).get("content", "")
    if not isinstance(content, str) or not content.strip():
        raise NahaLLMError("NahaLLM returned empty content")
    return content.strip()
