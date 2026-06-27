"""The agent: goal-based, self-verifying RAG.

Loop (bounded):
  1. Gather sources  — vector store (admin uploads) + crawled corpus + live web.
  2. Draft           — answer the goal using ONLY those sources, with citations.
  3. Verify          — the model critiques its own draft against the sources:
                       are all claims supported? is anything hallucinated? is a
                       user-specific fact missing that we must ASK for, not assume?
  4. Act             — finalize, or refine the query and gather more context,
                       or return a clarifying question to the user.

Every claim is grounded; sources are cited; when unsure it asks instead of guessing.
"""
from __future__ import annotations
import logging
import os

import web
import llm
from vectorstore import get_store
from rag import Retriever

log = logging.getLogger("agent")

MAX_ITERS = int(os.getenv("AGENT_MAX_ITERS", "1"))
USE_WEB = os.getenv("AGENT_USE_WEB", "1") == "1"

_corpus = Retriever()


# --------------------------------------------------------------------------- #
# Source gathering
# --------------------------------------------------------------------------- #
def gather_sources(query: str, tags: list[str], k: int = 4) -> list[dict]:
    sources: list[dict] = []

    # 1) admin-uploaded documents (vector store)
    for m in get_store().query(query, k=k):
        md = m.get("metadata", {})
        sources.append({
            "title": md.get("title", "Uploaded document"),
            "text": m.get("text") or md.get("text", ""),
            "source": md.get("source", "admin upload"),
            "url": md.get("url", ""),
            "date": md.get("date", ""),
            "origin": "upload",
            "score": m.get("score", 0),
        })

    # 2) crawled / bundled Integreat content
    for d in _corpus.retrieve(query, tags, k=k):
        sources.append({
            "title": d["title"], "text": d["text"], "source": d["origin"],
            "url": d.get("url", ""), "date": d.get("updatedAt", ""),
            "origin": "integreat", "score": d.get("score", 0),
        })

    # 3) live web for the latest info
    if USE_WEB:
        for r in web.search(query, k=2):
            snippet = r.get("snippet", "")
            if len(snippet) < 400 and r.get("url"):
                more = web.fetch(r["url"], 1500)
                snippet = (snippet + " " + more).strip()
            sources.append({
                "title": r.get("title", "Web result"), "text": snippet,
                "source": "web", "url": r.get("url", ""), "date": "latest",
                "origin": "web", "score": 0.5,
            })

    return _dedupe(sources)[: k * 2]


def _dedupe(sources: list[dict]) -> list[dict]:
    seen, out = set(), []
    for s in sources:
        key = (s["title"].lower().strip(), s.get("url", ""))
        if key in seen or not s.get("text"):
            continue
        seen.add(key)
        out.append(s)
    return out


# --------------------------------------------------------------------------- #
# LLM steps
# --------------------------------------------------------------------------- #
def _source_block(sources: list[dict]) -> str:
    lines = []
    for i, s in enumerate(sources, 1):
        meta = f"{s['source']}" + (f", {s['date']}" if s.get("date") else "")
        lines.append(f"[{i}] {s['title']} ({meta})\n{s['text'][:700]}")
    return "\n\n".join(lines) if lines else "(no sources found)"


DRAFT_SYS = (
    "You are Wegweiser, a migration guidance assistant for newcomers in Germany. "
    "Your goal is to help the user achieve their goal accurately. "
    "Use ONLY the provided sources. Cite them inline as [1], [2]. "
    "Do NOT invent offices, dates, amounts, or rules. Keep the answer to 2-4 short sentences in plain language. "
    "Respond as strict JSON: "
    '{"answer": string, "used": number[], "confidence": number, "assumptions": string[]}.'
)

VERIFY_SYS = (
    "You verify a draft answer against the sources, like a careful reviewer. Check every claim. "
    "Decide the verdict: 'ok' if fully supported; 'needs_user_input' if answering correctly REQUIRES a "
    "user-specific fact that is missing (never assume it — ask); 'needs_more_context' if the sources are "
    "insufficient and a better search could help; 'unsupported' if the draft makes claims the sources don't back. "
    "Respond as strict JSON: "
    '{"verdict": "ok|needs_user_input|needs_more_context|unsupported", '
    '"missing_question": string, "refined_query": string, "corrected_answer": string, "confidence": number}.'
)


def _draft(goal: str, tags: list[str], sources: list[dict]) -> dict | None:
    user = (f"User goal: {goal}\nKnown context tags: {', '.join(tags) or 'none'}\n\n"
            f"Sources:\n{_source_block(sources)}")
    return llm.chat_json(DRAFT_SYS, user, temperature=0.1)


def _verify(goal: str, draft: dict, sources: list[dict]) -> dict | None:
    user = (f"User goal: {goal}\n\nDraft answer: {draft.get('answer','')}\n"
            f"Draft assumptions: {draft.get('assumptions', [])}\n\n"
            f"Sources:\n{_source_block(sources)}")
    return llm.chat_json(VERIFY_SYS, user, temperature=0.0)


# --------------------------------------------------------------------------- #
# Public entry
# --------------------------------------------------------------------------- #
def run(query: str, tags: list[str], region: str = "", language: str = "en",
        extra_context: str = "") -> dict:
    goal = query if not extra_context else f"{query}\nAdditional info from user: {extra_context}"
    trace: list[str] = []
    sources = gather_sources(query, tags)
    trace.append(f"Gathered {len(sources)} sources (uploads + Integreat + web)")

    if not llm.available().get("reachable"):
        return _grounded_fallback(sources, "LLM unreachable", trace)

    draft = _draft(goal, tags, sources)
    if not draft or not draft.get("answer"):
        return _grounded_fallback(sources, "draft failed", trace)
    trace.append("Drafted an answer with citations")

    used = draft.get("used", [])
    confidence = float(draft.get("confidence", 0.6) or 0.6)
    answer = draft["answer"]

    for it in range(MAX_ITERS + 1):
        verdict = _verify(goal, {"answer": answer, "assumptions": draft.get("assumptions", [])}, sources)
        if not verdict:
            break
        v = verdict.get("verdict", "ok")
        confidence = float(verdict.get("confidence", confidence) or confidence)
        trace.append(f"Self-check {it + 1}: {v}")

        if v == "needs_user_input" and verdict.get("missing_question"):
            return {
                "answer": "I want to get this right for your situation, so I need one detail first.",
                "clarifying_question": verdict["missing_question"],
                "citations": _citations(sources, used),
                "confidence": min(confidence, 0.5),
                "escalate": False,
                "trace": trace,
                "needs_input": True,
            }

        if v == "needs_more_context" and it < MAX_ITERS and verdict.get("refined_query"):
            more = gather_sources(verdict["refined_query"], tags)
            sources = _dedupe(sources + more)
            trace.append(f"Improved context with: '{verdict['refined_query']}'")
            draft = _draft(goal, tags, sources) or draft
            answer = draft.get("answer", answer)
            used = draft.get("used", used)
            continue

        if verdict.get("corrected_answer"):
            answer = verdict["corrected_answer"]
        if v == "unsupported":
            confidence = min(confidence, 0.45)
        break

    escalate = _should_escalate(query, confidence)
    return {
        "answer": answer,
        "citations": _citations(sources, used),
        "confidence": round(max(0.0, min(1.0, confidence)), 2),
        "escalate": escalate,
        "trace": trace,
        "needs_input": False,
    }


def _citations(sources: list[dict], used: list[int]) -> list[dict]:
    chosen = [sources[i - 1] for i in used if isinstance(i, int) and 1 <= i <= len(sources)] or sources[:3]
    out = []
    for s in chosen:
        out.append({"title": s["title"], "source": s["source"], "url": s.get("url", ""), "date": s.get("date", "")})
    # de-dup
    uniq, seen = [], set()
    for c in out:
        key = (c["title"], c["url"])
        if key not in seen:
            seen.add(key)
            uniq.append(c)
    return uniq


def _grounded_fallback(sources: list[dict], reason: str, trace: list[str]) -> dict:
    trace.append(f"Fallback: {reason}")
    if not sources:
        return {"answer": "I couldn't find this in the official sources yet. A counselor can help.",
                "citations": [], "confidence": 0.2, "escalate": True, "trace": trace, "needs_input": False}
    top = sources[0]
    text = top["text"]
    snippet = " ".join(text.split(". ")[:2]).strip()
    return {"answer": snippet, "citations": _citations(sources, [1]), "confidence": 0.55,
            "escalate": False, "trace": trace, "needs_input": False}


def _should_escalate(query: str, confidence: float) -> bool:
    import re
    if confidence < 0.4:
        return True
    return bool(re.search(r"lawyer|deport|abschieb|denied|rejected|emergency|police|violence|suicide", query, re.I))
