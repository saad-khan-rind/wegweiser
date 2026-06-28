"""Lightweight retrieval over the local official corpus.

Default mode is a dependency-free TF-IDF cosine ranker so the service runs
instantly. Long official pages are split into passages (via LangChain's
RecursiveCharacterTextSplitter when available) so retrieval targets the relevant
section instead of diluting term frequencies across a whole page. An optional
embeddings mode (sentence-transformers) can be enabled with USE_EMBEDDINGS=1 for
higher-quality multilingual retrieval.
"""
from __future__ import annotations
import math
import os
import re
from dataclasses import dataclass, field
from pathlib import Path

# LangChain passage splitter (optional, used when installed).
try:
    from langchain_text_splitters import RecursiveCharacterTextSplitter  # type: ignore
    _SPLITTER = RecursiveCharacterTextSplitter(
        chunk_size=900, chunk_overlap=150, separators=["\n\n", "\n", ". ", " ", ""]
    )
except Exception:  # pragma: no cover - optional dependency
    _SPLITTER = None

CORPUS_DIR = Path(__file__).parent / "corpus"
STOP = set("the a an to of in on for and or is are i my me do how what can where "
           "when with you your it as be at this that".split())


@dataclass
class Doc:
    id: str            # chunk id (base id for single-passage docs)
    title: str
    origin: str
    updated_at: str
    tags: list[str]
    text: str          # passage text used for retrieval
    url: str = ""
    base_id: str = ""  # parent document id (for source lookup)
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


def _split_passages(text: str) -> list[str]:
    text = re.sub(r"[ \t]+", " ", text).strip()
    if len(text) <= 1100:
        return [text] if text else []
    if _SPLITTER is not None:
        chunks = [c.strip() for c in _SPLITTER.split_text(text) if c.strip()]
        if chunks:
            return chunks
    # Fallback fixed-size splitter.
    out, i, size, overlap = [], 0, 900, 150
    while i < len(text):
        out.append(text[i:i + size].strip())
        i += size - overlap
    return [c for c in out if c]


class Retriever:
    def __init__(self) -> None:
        self.docs: list[Doc] = []                 # passage-level units for retrieval
        self._full: dict[str, dict] = {}          # base_id -> full document (for /source)
        self.idf: dict[str, float] = {}
        self.embeddings = None
        self._load()
        self._index()

    def _load(self) -> None:
        for path in sorted(CORPUS_DIR.glob("*.md")):
            meta, body = parse_front_matter(path.read_text(encoding="utf-8"))
            base_id = meta.get("id", path.stem)
            title = meta.get("title", path.stem)
            origin = meta.get("origin", "integreat")
            updated = meta.get("updated_at", "2026-01-01")
            url = meta.get("url", "")
            tags = [t.strip() for t in meta.get("tags", "").split(",") if t.strip()]
            self._full[base_id] = {
                "id": base_id, "title": title, "source": origin,
                "url": url, "date": updated, "text": body,
            }
            passages = _split_passages(body) or [body]
            for i, passage in enumerate(passages):
                cid = base_id if len(passages) == 1 else f"{base_id}#{i}"
                self.docs.append(Doc(
                    id=cid, title=title, origin=origin, updated_at=updated,
                    url=url, tags=tags, text=passage, base_id=base_id,
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
        return sum(d.tf.get(t, 0.0) * self.idf.get(t, 0.0) for t in q)

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
        out, seen_base = [], set()
        for s, d in scores:
            if s <= 0 or len(out) >= k:
                continue
            # Keep at most one passage per parent document for diverse results.
            if d.base_id in seen_base:
                continue
            seen_base.add(d.base_id)
            out.append({
                "id": d.base_id or d.id, "title": d.title, "origin": d.origin,
                "updatedAt": d.updated_at, "url": d.url, "tags": d.tags,
                "text": d.text, "score": round(s, 4),
            })
        return out

    def get(self, doc_id: str) -> dict | None:
        base = (doc_id or "").split("#", 1)[0]
        return self._full.get(base)
