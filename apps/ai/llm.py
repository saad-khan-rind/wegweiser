"""Ollama client: chat (JSON) + embeddings, with sane timeouts and logging.

This is the single place that talks to the LLM. It is deliberately defensive:
generous timeouts (CPU inference is slow), bounded output, and clear errors so
"the AI isn't responding" is always diagnosable from the logs.
"""
from __future__ import annotations
import json
import logging
import os
import urllib.request
import urllib.error
import urllib.parse

from envloader import load_env

log = logging.getLogger("ollama")

load_env()

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://ollama:11434").rstrip("/")
CHAT_MODEL = os.getenv("OLLAMA_MODEL", "llama3.1:8b")
EMBED_MODEL = os.getenv("EMBED_MODEL", "nomic-embed-text")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-flash-latest")
# CPU inference is slow; default to a long ceiling so requests aren't killed.
LLM_TIMEOUT = int(os.getenv("LLM_TIMEOUT", "180"))
NUM_PREDICT = int(os.getenv("LLM_NUM_PREDICT", "900"))
_embed_warned = False


def _post(path: str, payload: dict, timeout: int) -> dict:
    req = urllib.request.Request(
        f"{OLLAMA_URL}{path}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def _gemini_key() -> str:
    return os.getenv("GEMINI_API_KEY", "").strip()


def _provider() -> str:
    return "gemini" if _gemini_key() else "ollama"


def available() -> dict:
    """Health probe for the active provider. Gemini is used when a key exists."""
    if _gemini_key():
        return {
            "reachable": True,
            "provider": "gemini",
            "chat_model": GEMINI_MODEL,
            "chat_model_present": True,
            "embed_model": EMBED_MODEL,
            "embed_model_present": False,
        }

    info = {"reachable": False, "chat_model": CHAT_MODEL, "chat_model_present": False,
            "embed_model": EMBED_MODEL, "embed_model_present": False, "url": OLLAMA_URL,
            "provider": "ollama"}
    try:
        req = urllib.request.Request(f"{OLLAMA_URL}/api/tags")
        with urllib.request.urlopen(req, timeout=5) as r:
            tags = json.loads(r.read().decode("utf-8"))
        info["reachable"] = True
        names = {m.get("name", "").split(":")[0] for m in tags.get("models", [])}
        full = {m.get("name", "") for m in tags.get("models", [])}
        info["chat_model_present"] = CHAT_MODEL in full or CHAT_MODEL.split(":")[0] in names
        info["embed_model_present"] = EMBED_MODEL in full or EMBED_MODEL.split(":")[0] in names
    except Exception as e:  # noqa: BLE001
        info["error"] = str(e)
    return info


def chat_json(system: str, user: str, temperature: float = 0.1) -> dict | None:
    """Ask the model for a strict JSON object. Returns parsed dict or None."""
    provider = _provider()
    try:
        if provider == "gemini":
            return _parse_json(_gemini(system, user, temperature))
        data = _post("/api/chat", {
            "model": CHAT_MODEL,
            "stream": False,
            "format": "json",
            "options": {"temperature": temperature, "num_predict": NUM_PREDICT},
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }, LLM_TIMEOUT)
        content = (data.get("message") or {}).get("content", "")
        return _parse_json(content)
    except urllib.error.URLError as e:
        log.warning("Ollama chat failed (%s): %s", OLLAMA_URL, e)
        return None
    except Exception as e:  # noqa: BLE001
        log.warning("%s chat error: %s", provider, e)
        return None


def _gemini(system: str, user: str, temperature: float) -> str:
    key = urllib.parse.quote(_gemini_key(), safe="")
    model = urllib.parse.quote(GEMINI_MODEL, safe="")
    payload = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": user}]}],
        "generationConfig": {
            "temperature": temperature,
            "maxOutputTokens": NUM_PREDICT,
            "responseMimeType": "application/json",
        },
    }
    req = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=LLM_TIMEOUT) as r:
        data = json.loads(r.read().decode("utf-8"))
    parts = (((data.get("candidates") or [{}])[0].get("content") or {}).get("parts") or [])
    return "".join(str(p.get("text", "")) for p in parts)


def embed(text: str) -> list[float] | None:
    global _embed_warned
    last_error: Exception | None = None
    try:
        # Ollama's current embeddings endpoint is /api/embed. Older installs
        # used /api/embeddings, so keep both for compatibility.
        data = _post("/api/embed", {"model": EMBED_MODEL, "input": text}, 60)
        embeddings = data.get("embeddings")
        emb = embeddings[0] if isinstance(embeddings, list) and embeddings else data.get("embedding")
        if isinstance(emb, list) and emb:
            return emb
    except Exception as e:  # noqa: BLE001
        last_error = e
    try:
        data = _post("/api/embeddings", {"model": EMBED_MODEL, "prompt": text}, 60)
        emb = data.get("embedding")
        return emb if isinstance(emb, list) and emb else None
    except Exception as e:  # noqa: BLE001
        last_error = e
        if not _embed_warned:
            _embed_warned = True
            log.warning("Ollama embed unavailable, using configured fallback if present: %s", last_error)
        return None


def _parse_json(raw: str) -> dict | None:
    if not raw:
        return None
    cleaned = raw.replace("```json", "").replace("```", "").strip()
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start == -1 or end == -1:
        return None
    try:
        return json.loads(cleaned[start:end + 1])
    except Exception:  # noqa: BLE001
        return None