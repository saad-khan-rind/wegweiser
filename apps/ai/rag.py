"""Lightweight retrieval over the local corpus.

Default mode is a dependency-free TF-IDF cosine ranker so the service runs
instantly. An optional embeddings mode (sentence-transformers) can be enabled
with USE_EMBEDDINGS=1 for higher-quality, multilingual retrieval over uploaded
documents, official web pages, and Integreat content where available.
"""
from __future__ import annotations
import math
import os
import re
from dataclasses import dataclass, field
from pathlib import Path

CORPUS_DIR = Path(__file__).parent / "corpus"
STOP = set("the a an to of in on for and or is are i my me do how what can where "
           "when with you your it as be at this that".split())


@dataclass
class Doc:
    id: str
    title: str
    origin: str
    updated_at: str
    tags: list[str]
    text: str
    url: str = ""
    tf: dict[str, float] = field(default_factory=dict)


def _stem(w: str) -> str:
    for suf in ("ing", "ed", "es", "s"):
        if len(w) > len(suf) + 2 and w.endswith(suf):
            return w[: -len(suf)]
    return w


def tokenize(s: str) -> list[str]:
    words = re.sub(r"[^\w\s]", " ", s.lower(), flags=re.UNICODE).split()
    return [_stem(w) for w in words if len(w) > 2 and w not in STOP]


def parse_front_matter(raw: str) -> tuple[dict, str]:
    meta: dict = {}
    body = raw
    if raw.startswith("---"):
        _, fm, body = raw.split("---", 2)
        for line in fm.strip().splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                meta[k.strip()] = v.strip()
    return meta, body.strip()


class Retriever:
    def __init__(self) -> None:
        self.docs: list[Doc] = []
        self.idf: dict[str, float] = {}
        self.embeddings = None
        self._load()
        self._index()

    def _load(self) -> None:
        for path in sorted(CORPUS_DIR.glob("*.md")):
            meta, body = parse_front_matter(path.read_text(encoding="utf-8"))
            self.docs.append(Doc(
                id=meta.get("id", path.stem),
                title=meta.get("title", path.stem),
                origin=meta.get("origin", "integreat"),
                updated_at=meta.get("updated_at", "2026-01-01"),
                url=meta.get("url", ""),
                tags=[t.strip() for t in meta.get("tags", "").split(",") if t.strip()],
                text=body,
            ))

    def _index(self) -> None:
        df: dict[str, int] = {}
        for d in self.docs:
            counts: dict[str, float] = {}
            toks = tokenize(d.title + " " + d.text)
            for t in toks:
                counts[t] = counts.get(t, 0) + 1
            d.tf = {t: c / max(len(toks), 1) for t, c in counts.items()}
            for t in set(toks):
                df[t] = df.get(t, 0) + 1
        n = max(len(self.docs), 1)
        self.idf = {t: math.log(1 + n / (1 + c)) for t, c in df.items()}

        if os.getenv("USE_EMBEDDINGS") == "1":
            try:
                from sentence_transformers import SentenceTransformer  # type: ignore
                self._model = SentenceTransformer("sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2")
                self.embeddings = self._model.encode([d.text for d in self.docs], normalize_embeddings=True)
            except Exception:
                self.embeddings = None

    def _tfidf_score(self, query: str, d: Doc) -> float:
        q = tokenize(query)
        score = 0.0
        for t in q:
            score += d.tf.get(t, 0.0) * self.idf.get(t, 0.0)
        return score

    def retrieve(self, query: str, tags: list[str], k: int = 3) -> list[dict]:
        scores: list[tuple[float, Doc]] = []
        if self.embeddings is not None:
            qv = self._model.encode([query], normalize_embeddings=True)[0]
            for vec, d in zip(self.embeddings, self.docs):
                base = float(sum(a * b for a, b in zip(qv, vec)))
                boost = 1.5 * sum(1 for t in tags if t in d.tags)
                scores.append((base + boost * 0.1, d))
        else:
            for d in self.docs:
                base = self._tfidf_score(query, d)
                boost = 0.05 * sum(1 for t in tags if t in d.tags)
                scores.append((base + boost, d))
        scores.sort(key=lambda x: x[0], reverse=True)
        out = []
        for s, d in scores[:k]:
            if s <= 0:
                continue
            out.append({
                "id": d.id, "title": d.title, "origin": d.origin,
                "updatedAt": d.updated_at, "url": d.url, "tags": d.tags, "text": d.text, "score": round(s, 4),
            })
        return out

    def get(self, doc_id: str) -> dict | None:
        for d in self.docs:
            if d.id == doc_id:
                return {
                    "id": d.id, "title": d.title, "source": d.origin,
                    "url": d.url, "date": d.updated_at, "text": d.text,
                }
        return None
