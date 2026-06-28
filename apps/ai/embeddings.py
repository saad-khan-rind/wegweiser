"""Embeddings with a reliable default and an automatic semantic upgrade.

Provider resolution (EMBED_PROVIDER):
  - "auto"  (default): use Gemini's text-embedding-004 when GEMINI_API_KEY is
              set (semantic, multilingual); otherwise fall back to the
              deterministic hash embedding so the pipeline always works.
  - "gemini": force Gemini embeddings (hash fallback if a call fails).
  - "ollama": use the configured Ollama EMBED_MODEL (hash fallback if absent).
  - "hash":   deterministic hashing embeddings only (no external calls).

The hash embedding is not as semantic as a real model, but it works instantly
in Docker without pulling a model and keeps Pinecone usable for a demo.

NOTE: all vectors in one index must share an embedding space. If you switch
providers after ingesting, clear the vector store (admin "clear") and re-ingest.
"""
from __future__ import annotations
import hashlib
import math
import os

from envloader import load_env
from llm import embed as ollama_embed, gemini_embed

load_env()

DIM = int(os.getenv("EMBED_DIM", "768"))  # nomic-embed-text & text-embedding-004 = 768
_PROVIDER = os.getenv("EMBED_PROVIDER", "auto").strip().lower()  # auto|gemini|ollama|hash
_active_provider = _PROVIDER


def _gemini_key_present() -> bool:
    return bool(os.getenv("GEMINI_API_KEY", "").strip())


def _hash_embed(text: str) -> list[float]:
    vec = [0.0] * DIM
    for tok in _features(text):
        h = int(hashlib.md5(tok.encode("utf-8")).hexdigest(), 16)
        idx = h % DIM
        sign = 1.0 if (h >> 7) & 1 else -1.0
        vec[idx] += sign
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


def _tokens(text: str) -> list[str]:
    return [w for w in "".join(c.lower() if c.isalnum() else " " for c in text).split() if len(w) > 1]


def _features(text: str) -> list[str]:
    features: list[str] = []
    for tok in _tokens(text):
        features.append(f"w:{tok}")
        if len(tok) > 5:
            for i in range(0, len(tok) - 3):
                features.append(f"g:{tok[i:i + 4]}")
    return features


def _resolve_provider() -> str:
    if _PROVIDER == "auto":
        return "gemini" if _gemini_key_present() else "hash"
    return _PROVIDER


def embed_text(text: str) -> list[float]:
    global _active_provider
    provider = _resolve_provider()

    if provider == "gemini":
        v = gemini_embed(text, DIM)
        if v:
            if len(v) != DIM:
                _set_dim(len(v))
            _active_provider = "gemini"
            return v
        _active_provider = "hash-fallback"
        return _hash_embed(text)

    if provider == "ollama":
        v = ollama_embed(text)
        if v:
            if len(v) != DIM:
                _set_dim(len(v))
            _active_provider = "ollama"
            return v
        _active_provider = "hash-fallback"
        return _hash_embed(text)

    _active_provider = "hash"
    return _hash_embed(text)


def _set_dim(n: int) -> None:
    global DIM
    DIM = n


def dim() -> int:
    return DIM


def provider() -> str:
    return _active_provider
