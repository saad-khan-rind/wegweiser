"""Small .env loader for the AI service.

Container env still wins. This only fills missing values from apps/ai/.env so
local runs and Docker builds can use the AI-specific env file directly.
"""
from __future__ import annotations
import os
from pathlib import Path

AI_ENV_KEYS = {
    "OLLAMA_URL",
    "OLLAMA_MODEL",
    "EMBED_MODEL",
    "EMBED_PROVIDER",
    "EMBED_DIM",
    "GEMINI_API_KEY",
    "GEMINI_MODEL",
    "AGENT_USE_WEB",
    "AGENT_MAX_ITERS",
    "AGENT_OFFICIAL_WEB_ONLY",
    "LLM_TIMEOUT",
    "LLM_NUM_PREDICT",
    "PINECONE_API_KEY",
    "PINECONE_INDEX",
    "PINECONE_CLOUD",
    "PINECONE_REGION",
    "CRAWL_ON_START",
    "CRAWL_INTERVAL_MIN",
    "CRAWL_REGION",
    "CRAWL_LANG",
    "CRAWL_URLS",
}


def load_env() -> None:
    path = Path(__file__).with_name(".env")
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = _clean(value)
        if not key:
            continue
        if key in os.environ and (key not in AI_ENV_KEYS or value == ""):
            continue
        os.environ[key] = value


def _clean(value: str) -> str:
    value = value.strip()
    if not value:
        return ""
    if value[0] in {"'", '"'} and value.endswith(value[0]):
        return value[1:-1]
    return value.split("#", 1)[0].strip()
