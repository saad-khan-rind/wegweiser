"""Vector store abstraction.

Uses Pinecone when PINECONE_API_KEY is set; otherwise an in-memory cosine store
so the whole pipeline (admin upload, RAG, citations) works in a demo without any
external account. Same interface either way.
"""
from __future__ import annotations
import logging
import math
import os
import threading
import time

import embeddings

log = logging.getLogger("vectorstore")

PINECONE_API_KEY = os.getenv("PINECONE_API_KEY", "")
PINECONE_INDEX = os.getenv("PINECONE_INDEX", "wegweiser")
PINECONE_CLOUD = os.getenv("PINECONE_CLOUD", "aws")
PINECONE_REGION = os.getenv("PINECONE_REGION", "us-east-1")


class Record(dict):
    """{id, text, metadata{title,source,url,date,...}}"""


class BaseStore:
    backend = "base"

    def upsert(self, records: list[dict]) -> int:
        raise NotImplementedError

    def query(self, text: str, k: int = 4) -> list[dict]:
        raise NotImplementedError

    def list(self, limit: int = 100) -> list[dict]:
        raise NotImplementedError


class MemoryStore(BaseStore):
    backend = "memory"

    def __init__(self) -> None:
        self._items: list[dict] = []
        self._lock = threading.Lock()

    def upsert(self, records: list[dict]) -> int:
        with self._lock:
            for r in records:
                vec = embeddings.embed_text(r["text"])
                existing = next((i for i in self._items if i["id"] == r["id"]), None)
                payload = {"id": r["id"], "vec": vec, "text": r["text"], "metadata": r.get("metadata", {})}
                if existing:
                    self._items[self._items.index(existing)] = payload
                else:
                    self._items.append(payload)
        return len(records)

    def query(self, text: str, k: int = 4) -> list[dict]:
        if not self._items:
            return []
        q = embeddings.embed_text(text)
        scored = []
        for it in self._items:
            scored.append((_cosine(q, it["vec"]), it))
        scored.sort(key=lambda x: x[0], reverse=True)
        out = []
        for s, it in scored[:k]:
            if s <= 0:
                continue
            out.append({"id": it["id"], "score": round(s, 4), "text": it["text"], "metadata": it["metadata"]})
        return out

    def list(self, limit: int = 100) -> list[dict]:
        return [{"id": i["id"], "metadata": i["metadata"]} for i in self._items[:limit]]


class PineconeStore(BaseStore):
    backend = "pinecone"

    def __init__(self) -> None:
        from pinecone import Pinecone, ServerlessSpec  # type: ignore
        self._pc = Pinecone(api_key=PINECONE_API_KEY)
        names = []
        for i in self._pc.list_indexes():
            n = getattr(i, "name", None) or (i.get("name") if isinstance(i, dict) else None)
            if n:
                names.append(n)
        if PINECONE_INDEX not in names:
            log.info("Creating Pinecone index %s (dim=%s)", PINECONE_INDEX, embeddings.dim())
            self._pc.create_index(
                name=PINECONE_INDEX,
                dimension=embeddings.dim(),
                metric="cosine",
                spec=ServerlessSpec(cloud=PINECONE_CLOUD, region=PINECONE_REGION),
            )
            time.sleep(2)
        self._index = self._pc.Index(PINECONE_INDEX)

    def upsert(self, records: list[dict]) -> int:
        vectors = []
        for r in records:
            md = dict(r.get("metadata", {}))
            md["text"] = r["text"][:3000]
            vectors.append({"id": r["id"], "values": embeddings.embed_text(r["text"]), "metadata": md})
        self._index.upsert(vectors=vectors)
        return len(vectors)

    def query(self, text: str, k: int = 4) -> list[dict]:
        res = self._index.query(vector=embeddings.embed_text(text), top_k=k, include_metadata=True)
        matches = res.get("matches", []) if isinstance(res, dict) else getattr(res, "matches", [])
        out = []
        for m in matches:
            md = (m.get("metadata") if isinstance(m, dict) else getattr(m, "metadata", {})) or {}
            mid = m.get("id") if isinstance(m, dict) else getattr(m, "id", "")
            score = m.get("score") if isinstance(m, dict) else getattr(m, "score", 0)
            out.append({"id": mid, "score": score, "text": md.get("text", ""), "metadata": md})
        return out

    def list(self, limit: int = 100) -> list[dict]:
        try:
            stats = self._index.describe_index_stats()
            return [{"id": "(pinecone)", "metadata": {"total": stats.get("total_vector_count", 0)}}]
        except Exception:  # noqa: BLE001
            return []


def _cosine(a: list[float], b: list[float]) -> float:
    n = min(len(a), len(b))
    dot = sum(a[i] * b[i] for i in range(n))
    na = math.sqrt(sum(x * x for x in a[:n])) or 1.0
    nb = math.sqrt(sum(x * x for x in b[:n])) or 1.0
    return dot / (na * nb)


_store: BaseStore | None = None


def get_store() -> BaseStore:
    global _store
    if _store is not None:
        return _store
    if PINECONE_API_KEY:
        try:
            _store = PineconeStore()
            log.info("Vector store: Pinecone (%s)", PINECONE_INDEX)
            return _store
        except Exception as e:  # noqa: BLE001
            log.warning("Pinecone unavailable (%s); using in-memory store", e)
    _store = MemoryStore()
    log.info("Vector store: in-memory")
    return _store
