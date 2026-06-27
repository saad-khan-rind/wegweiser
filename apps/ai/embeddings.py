"""Embeddings with a graceful fallback.

Primary: Ollama embeddings (open-weights, self-hosted — e.g. nomic-embed-text).
Fallback: a deterministic hashing embedder so ingestion/retrieval never hard-fails
when Ollama's embed model isn't pulled. Both produce a fixed dimension so the
vector store stays consistent.
"""
from __future__ import annotations
import hashlib
import math
import os

from llm import embed as ollama_embed

DIM = int(os.getenv("EMBED_DIM", "768"))  # nomic-embed-text = 768
_PROVIDER = os.getenv("EMBED_PROVIDER", "ollama")  # "ollama" | "hash"


def _hash_embed(text: str) -> list[float]:
    vec = [0.0] * DIM
    for tok in _tokens(text):
        h = int(hashlib.md5(tok.encode("utf-8")).hexdigest(), 16)
        idx = h % DIM
        sign = 1.0 if (h >> 7) & 1 else -1.0
        vec[idx] += sign
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


def _tokens(text: str) -> list[str]:
    return [w for w in "".join(c.lower() if c.isalnum() else " " for c in text).split() if len(w) > 1]


def embed_text(text: str) -> list[float]:
    if _PROVIDER == "ollama":
        v = ollama_embed(text)
        if v:
            # keep the store dimension stable even if the model differs
            if len(v) != DIM:
                _set_dim(len(v))
            return v
    return _hash_embed(text)


def _set_dim(n: int) -> None:
    global DIM
    DIM = n


def dim() -> int:
    return DIM
