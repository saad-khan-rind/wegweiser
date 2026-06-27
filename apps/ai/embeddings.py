"""Embeddings with a reliable default.

Default: deterministic hashing embeddings. They are not as semantic as a real
embedding model, but they work immediately in Docker without pulling an Ollama
embedding model and keep Pinecone usable during the demo.

Optional: set EMBED_PROVIDER=ollama after pulling EMBED_MODEL inside Ollama.
"""
from __future__ import annotations
import hashlib
import math
import os

from envloader import load_env
from llm import embed as ollama_embed

load_env()

DIM = int(os.getenv("EMBED_DIM", "768"))  # nomic-embed-text = 768
_PROVIDER = os.getenv("EMBED_PROVIDER", "hash").strip().lower()  # "hash" | "ollama"
_active_provider = _PROVIDER


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


def embed_text(text: str) -> list[float]:
    global _active_provider
    if _PROVIDER == "ollama":
        v = ollama_embed(text)
        if v:
            # keep the store dimension stable even if the model differs
            if len(v) != DIM:
                _set_dim(len(v))
            _active_provider = "ollama"
            return v
        _active_provider = "hash-fallback"
    return _hash_embed(text)


def _set_dim(n: int) -> None:
    global DIM
    DIM = n


def dim() -> int:
    return DIM


def provider() -> str:
    return _active_provider
