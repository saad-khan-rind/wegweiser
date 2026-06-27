"""Wegweiser RAG service.

A small FastAPI app that retrieves the most relevant Integreat-style documents
for a (de-identified) query. The NestJS API calls /retrieve when AI_SERVICE_URL
is set; otherwise the API falls back to its own keyword search.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from rag import Retriever

app = FastAPI(title="Wegweiser RAG", version="0.1.0")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)

retriever = Retriever()


class RetrieveRequest(BaseModel):
    query: str
    tags: list[str] = []
    k: int = 3


@app.get("/health")
def health() -> dict:
    return {"ok": True, "docs": len(retriever.docs), "embeddings": retriever.embeddings is not None}


@app.post("/retrieve")
def retrieve(req: RetrieveRequest) -> dict:
    return {"documents": retriever.retrieve(req.query, req.tags, req.k)}
