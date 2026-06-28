"""Wegweiser AI service.

Owns the agentic RAG brain: vector store (Pinecone / in-memory), document
ingestion, the always-fresh crawler, optional live web, and the self-verifying
agent loop. The NestJS API proxies user questions to /agent and admin uploads
to /ingest.
"""
from __future__ import annotations
import logging
import os
import re

from envloader import load_env

load_env()

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

import agent
import llm
import vectorstore
from vectorstore import get_store
from crawl import crawl_region
from rag import Retriever

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("main")
_corpus = Retriever()

app = FastAPI(title="Wegweiser AI", version="0.2.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# --------------------------------------------------------------------------- #
# Schemas
# --------------------------------------------------------------------------- #
class AgentRequest(BaseModel):
    query: str
    tags: list[str] = []
    region: str = ""
    language: str = "en"
    extra_context: str = ""


class RetrieveRequest(BaseModel):
    query: str
    tags: list[str] = []
    k: int = 4


class IngestRequest(BaseModel):
    title: str
    text: str
    source: str = "admin upload"
    url: str = ""
    date: str = ""


class RefreshRequest(BaseModel):
    region: str = "bavaria"
    lang: str = "en"


# --------------------------------------------------------------------------- #
# Endpoints
# --------------------------------------------------------------------------- #
@app.get("/health")
def health() -> dict:
    store = get_store()
    return {
        "ok": True,
        "vector_store": store.backend,
        "pinecone": vectorstore.diagnostics(),
        "documents": store.list(1),
        "llm": llm.available(),
        "use_web": os.getenv("AGENT_USE_WEB", "1") == "1",
    }


@app.post("/agent")
def run_agent(req: AgentRequest) -> dict:
    return agent.run(req.query, req.tags, req.region, _lang(req.language), req.extra_context)


@app.post("/retrieve")
def retrieve(req: RetrieveRequest) -> dict:
    # Backward-compatible retrieval used by the NestJS knowledge service.
    sources = agent.gather_sources(req.query, req.tags, req.k)
    docs = [{
        "id": s["title"], "title": s["title"], "origin": s["source"],
        "updatedAt": s.get("date", ""), "url": s.get("url", ""),
        "tags": [], "text": s["text"], "score": s.get("score", 0),
    } for s in sources]
    return {"documents": docs}


def _chunk(text: str, size: int = 900, overlap: int = 150) -> list[str]:
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= size:
        return [text] if text else []
    out, i = [], 0
    while i < len(text):
        out.append(text[i:i + size])
        i += size - overlap
    return out


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:50] or "doc"


def _ingest(title: str, text: str, source: str, url: str, date: str) -> dict:
    chunks = _chunk(text)
    if not chunks:
        return {"ok": False, "chunks": 0, "error": "no text"}
    base = _slug(title)
    records = [{
        "id": f"{base}-{i}",
        "text": f"{title}. {c}",
        "metadata": {
            "id": f"{base}-{i}",
            "title": title,
            "source": source or "admin upload",
            "source_type": "admin",
            "url": url,
            "date": date,
            "chunk": i,
        },
    } for i, c in enumerate(chunks)]
    n = get_store().upsert(records)
    log.info("Ingested '%s' as %s chunks", title, n)
    return {"ok": True, "chunks": n, "title": title}


@app.post("/ingest")
def ingest(req: IngestRequest) -> dict:
    return _ingest(req.title, req.text, req.source, req.url, req.date)


@app.post("/ingest-file")
async def ingest_file(
    file: UploadFile = File(...),
    title: str = Form(""),
    source: str = Form("admin upload"),
    url: str = Form(""),
    date: str = Form(""),
) -> dict:
    raw = await file.read()
    name = file.filename or "document"
    text = ""
    if name.lower().endswith(".pdf"):
        text = _pdf_text(raw)
    else:
        text = raw.decode("utf-8", errors="ignore")
    return _ingest(title or name, text, source, url, date)


def _pdf_text(raw: bytes) -> str:
    try:
        import io
        from pypdf import PdfReader  # type: ignore
        reader = PdfReader(io.BytesIO(raw))
        return "\n".join((p.extract_text() or "") for p in reader.pages)
    except Exception as e:  # noqa: BLE001
        log.warning("pdf parse failed: %s", e)
        return ""


@app.get("/documents")
def documents() -> dict:
    return {"documents": get_store().list(200)}


@app.delete("/documents")
def clear_documents() -> dict:
    n = get_store().clear()
    return {"ok": True, "deleted": n}


@app.get("/source/{source_id}")
def source(source_id: str) -> JSONResponse:
    item = get_store().get(source_id)
    if not item:
        corpus = _corpus.get(source_id)
        if corpus:
            return JSONResponse(corpus)
        raise HTTPException(status_code=404, detail="source not found")
    md = item.get("metadata", {})
    return JSONResponse({
        "id": item.get("id", source_id),
        "title": md.get("title", source_id),
        "source": md.get("source", "admin upload"),
        "url": md.get("url", ""),
        "date": md.get("date", ""),
        "text": item.get("text", ""),
    })


@app.post("/refresh")
def refresh(req: RefreshRequest) -> dict:
    lang = _lang(req.lang)
    n = crawl_region(req.region, lang)
    return {"ok": True, "pages": n, "region": req.region, "lang": lang}


def _lang(value: str) -> str:
    return "de" if value == "de" else "en"


@app.on_event("startup")
def _startup() -> None:
    if os.getenv("CRAWL_ON_START", "0") == "1" or int(os.getenv("CRAWL_INTERVAL_MIN", "0")) > 0:
        log.info("Automatic crawler is disabled; use the admin portal to add crawler data explicitly")
