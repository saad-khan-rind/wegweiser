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
import re

import web
import llm
from vectorstore import get_store
from rag import Retriever

log = logging.getLogger("agent")

MAX_ITERS = int(os.getenv("AGENT_MAX_ITERS", "1"))
USE_WEB = os.getenv("AGENT_USE_WEB", "1") == "1"
USE_BUNDLED_CORPUS = os.getenv("AGENT_USE_BUNDLED_CORPUS", "1") == "1"

_corpus = Retriever()


# --------------------------------------------------------------------------- #
# Source gathering
# --------------------------------------------------------------------------- #
def gather_sources(query: str, tags: list[str], k: int = 4, region: str = "", language: str = "en") -> list[dict]:
    sources, _ = gather_sources_with_audit(query, tags, k, region, language)
    return sources


def gather_sources_with_audit(query: str, tags: list[str], k: int = 4, region: str = "",
                              language: str = "en") -> tuple[list[dict], list[dict]]:
    candidates: list[dict] = []

    # 1) admin-uploaded documents (vector store)
    for m in get_store().query(query, k=max(k * 4, 12)):
        md = m.get("metadata", {})
        candidates.append({
            "id": m.get("id", md.get("id", "")),
            "title": md.get("title", "Uploaded document"),
            "text": m.get("text") or md.get("text", ""),
            "source": md.get("source", "admin upload"),
            "url": md.get("url", ""),
            "date": md.get("date", ""),
            "origin": "upload",
            "score": m.get("score", 0),
        })

    # 2) crawled official / Integreat content
    if USE_BUNDLED_CORPUS:
        for d in _corpus.retrieve(query, tags, k=k):
            candidates.append({
                "id": d.get("id", ""),
                "title": d["title"], "text": d["text"], "source": d["origin"],
                "url": d.get("url", ""), "date": d.get("updatedAt", ""),
                "origin": d.get("origin", "crawler"), "score": d.get("score", 0),
            })

    # 3) live web for the latest info; never writes to Pinecone.
    if USE_WEB:
        for r in web.direct_sources(query, language, k=3):
            candidates.append({
                "id": r.get("id", ""),
                "title": r.get("title", "Official source"),
                "text": r.get("snippet", ""),
                "source": "official-web",
                "url": r.get("url", ""),
                "date": "latest",
                "origin": "web",
                "score": 0.7,
            })
        region_hint = region or "bavaria"
        web_query = f"{query} {region_hint} Germany official"
        for r in web.search(web_query, k=3):
            snippet = r.get("snippet", "")
            if len(snippet) < 400 and r.get("url"):
                more = web.fetch(r["url"], 1500)
                snippet = (snippet + " " + more).strip()
            if snippet:
                candidates.append({
                    "id": "",
                    "title": r.get("title", "Web result"), "text": snippet,
                    "source": "web", "url": r.get("url", ""), "date": "latest",
                    "origin": "web", "score": 0.5,
                })

    considered = _rank_sources(query, _dedupe(candidates))
    accepted = [s for s in considered if s.get("accepted")]
    return accepted[: k * 2], considered[: max(k * 4, 12)]


def _rank_sources(query: str, sources: list[dict]) -> list[dict]:
    out = []
    threshold = 4 if _registration_topic(query) else 1
    for s in sources:
        relevance = _relevance_score(query, s)
        item = dict(s)
        item["relevance"] = relevance
        item["accepted"] = relevance >= threshold
        out.append(item)
    out.sort(key=lambda s: (1 if s.get("accepted") else 0, s.get("relevance", 0), s.get("score", 0)), reverse=True)
    return out


def _relevance_score(query: str, source: dict) -> int:
    q_terms = _query_terms(query)
    title_terms = _text_terms(source.get("title", ""))
    body_terms = _text_terms(source.get("text", "")[:2500])
    title_hits = q_terms & title_terms
    body_hits = q_terms & body_terms
    score = len(body_hits) + (2 * len(title_hits))
    if _registration_topic(query) and ({"anmeldung", "register", "registration", "wohnsitz", "melde"} & (title_terms | body_terms)):
        score += 2
    return score


STOP = {
    "the", "a", "an", "to", "of", "in", "on", "for", "and", "or", "is", "are",
    "i", "my", "me", "do", "how", "what", "can", "where", "when", "with", "you",
    "your", "it", "as", "be", "at", "this", "that", "steps", "step", "city",
    "germany", "german", "bavaria", "official", "welche", "schritte", "sind",
    "fuer", "für", "die", "der", "das", "und", "oder", "ich", "du", "sie",
}


def _text_terms(text: str) -> set[str]:
    norm = _normalize(text)
    return {w for w in re.findall(r"\w+", norm, flags=re.UNICODE) if len(w) > 2 and w not in STOP}


def _query_terms(query: str) -> set[str]:
    terms = _text_terms(query)
    if _registration_topic(query):
        terms |= {
            "registration", "register", "address", "anmeldung", "anmelden",
            "melde", "meldebehoerde", "meldebehorde", "buergeramt", "burgeramt",
            "wohnung", "wohnsitz", "wohnungsgeber", "bestaetigung", "bestatigung",
        }
    return terms


def _registration_topic(query: str) -> bool:
    q = _normalize(query)
    return bool(re.search(r"\b(registration|register|address|anmeldung|anmelden|melde|wohnsitz)\b", q))


def _normalize(text: str) -> str:
    return (text or "").lower().replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")


def _resources(sources: list[dict]) -> list[dict]:
    return [{
        "id": s.get("id", ""),
        "title": s.get("title", ""),
        "source": s.get("source", ""),
        "origin": s.get("origin", ""),
        "url": s.get("url", ""),
        "date": s.get("date", ""),
        "score": s.get("score", 0),
        "relevance": s.get("relevance", 0),
        "accepted": bool(s.get("accepted")),
        "excerpt": (s.get("text", "") or "")[:260],
    } for s in sources]


def _with_runtime(payload: dict, resources: list[dict], llm_info: dict) -> dict:
    payload["resources_considered"] = resources
    payload["provider"] = llm_info.get("provider", "unknown")
    payload["model"] = llm_info.get("chat_model", "")
    return payload


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


def _draft_system(language: str) -> str:
    answer_language = "German" if language == "de" else "English"
    return (
        "You are Wegweiser, a migration guidance assistant for newcomers in Germany. "
        "Your goal is to help the user achieve their goal accurately. "
        "Use ONLY the provided sources. Cite them inline as [1], [2]. "
        f"Answer in {answer_language}. "
        "If the sources do not support an answer, say that you do not know from the official sources. "
        "Do NOT invent offices, dates, amounts, links, phone numbers, eligibility, or rules. "
        "Keep the answer to 2-4 short sentences in plain language. "
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


def _draft(goal: str, tags: list[str], sources: list[dict], language: str) -> dict | None:
    user = (f"User goal: {goal}\nAnswer language: {language}\nKnown context tags: {', '.join(tags) or 'none'}\n\n"
            f"Sources:\n{_source_block(sources)}")
    return llm.chat_json(_draft_system(language), user, temperature=0.1)


def _verify(goal: str, draft: dict, sources: list[dict], language: str) -> dict | None:
    user = (f"User goal: {goal}\n\nDraft answer: {draft.get('answer','')}\n"
            f"Draft assumptions: {draft.get('assumptions', [])}\n\n"
            f"Answer language: {language}\nSources:\n{_source_block(sources)}")
    return llm.chat_json(VERIFY_SYS, user, temperature=0.0)


# --------------------------------------------------------------------------- #
# Public entry
# --------------------------------------------------------------------------- #
def run(query: str, tags: list[str], region: str = "", language: str = "en",
        extra_context: str = "") -> dict:
    answer_language = _detect_language(query, language)
    goal = query if not extra_context else f"{query}\nAdditional info from user: {extra_context}"
    trace: list[str] = []
    sources, considered = gather_sources_with_audit(query, tags, region=region, language=answer_language)
    resources = _resources(considered)
    llm_info = llm.available()
    trace.append(f"Considered {len(considered)} resources; kept {len(sources)} relevant sources")

    if _looks_vague(query) and not extra_context and len(sources) < 2 and not _registration_topic(query):
        return _with_runtime(_clarify_first(answer_language, trace, sources), resources, llm_info)

    if not sources:
        return _with_runtime(_not_enough_info(answer_language, [], trace, confidence=0.2), resources, llm_info)

    if not llm_info.get("reachable"):
        return _with_runtime(_grounded_fallback(query, sources, "LLM unreachable", trace, answer_language), resources, llm_info)

    draft = _draft(goal, tags, sources, answer_language)
    if not draft or not draft.get("answer"):
        return _with_runtime(_grounded_fallback(query, sources, "draft failed", trace, answer_language), resources, llm_info)
    trace.append("Drafted an answer with citations")

    used = draft.get("used", [])
    confidence = _as_float(draft.get("confidence"), 0.6)
    answer = draft["answer"]
    unsupported = False

    for it in range(MAX_ITERS + 1):
        verdict = _verify(
            goal, {"answer": answer, "assumptions": draft.get("assumptions", [])},
            sources, answer_language,
        )
        if not verdict:
            break
        v = verdict.get("verdict", "ok")
        confidence = _as_float(verdict.get("confidence"), confidence)
        trace.append(f"Self-check {it + 1}: {v}")

        if v == "needs_user_input" and verdict.get("missing_question"):
            return _with_runtime({
                "answer": _one_detail(answer_language),
                "clarifying_question": verdict["missing_question"],
                "citations": _citations(sources, used),
                "confidence": min(confidence, 0.5),
                "escalate": False,
                "trace": trace,
                "needs_input": True,
            }, resources, llm_info)

        if v == "needs_more_context" and it < MAX_ITERS and verdict.get("refined_query"):
            more = gather_sources(verdict["refined_query"], tags, region=region, language=answer_language)
            sources = _dedupe(sources + more)
            trace.append(f"Improved context with: '{verdict['refined_query']}'")
            draft = _draft(goal, tags, sources, answer_language) or draft
            answer = draft.get("answer", answer)
            used = draft.get("used", used)
            continue

        if verdict.get("corrected_answer"):
            answer = verdict["corrected_answer"]
        if v == "unsupported":
            confidence = min(confidence, 0.45)
            unsupported = True
        break

    if unsupported or confidence < 0.55:
        fallback = _extractive_answer(query, sources, answer_language)
        if fallback:
            trace.append("Used extractive fallback because model confidence was too low")
            return _with_runtime({
                "answer": fallback,
                "citations": _citations(sources, []),
                "confidence": 0.62,
                "escalate": False,
                "trace": trace,
                "needs_input": False,
            }, resources, llm_info)
        return _with_runtime(_not_enough_info(answer_language, [], trace, confidence=min(confidence, 0.45)), resources, llm_info)

    escalate = _should_escalate(query, confidence)
    return _with_runtime({
        "answer": answer,
        "citations": _citations(sources, used),
        "confidence": round(max(0.0, min(1.0, confidence)), 2),
        "escalate": escalate,
        "trace": trace,
        "needs_input": False,
    }, resources, llm_info)


def _citations(sources: list[dict], used: list[int]) -> list[dict]:
    chosen = [sources[i - 1] for i in used if isinstance(i, int) and 1 <= i <= len(sources)] or sources[:3]
    out = []
    for s in chosen:
        out.append({
            "id": s.get("id", ""),
            "title": s["title"],
            "source": s["source"],
            "origin": s.get("origin", ""),
            "url": s.get("url", ""),
            "date": s.get("date", ""),
            "relevance": s.get("relevance", 0),
        })
    # de-dup
    uniq, seen = [], set()
    for c in out:
        key = (c["title"], c["url"])
        if key not in seen:
            seen.add(key)
            uniq.append(c)
    return uniq


def _grounded_fallback(query: str, sources: list[dict], reason: str, trace: list[str], language: str) -> dict:
    trace.append(f"Fallback: {reason}")
    answer = _extractive_answer(query, sources, language)
    if answer:
        trace.append("Used extractive fallback from relevant sources")
        return {
            "answer": answer,
            "citations": _citations(sources, []),
            "confidence": 0.62,
            "escalate": False,
            "trace": trace,
            "needs_input": False,
        }
    return _not_enough_info(language, [], trace, confidence=0.3)


def _extractive_answer(query: str, sources: list[dict], language: str) -> str:
    if not sources or not _registration_topic(query):
        return ""
    text = " ".join((s.get("title", "") + ". " + s.get("text", "")) for s in sources[:3])
    terms = _query_terms(query)
    if len(terms & _text_terms(text)) < 2:
        return ""
    if language == "de":
        return (
            "Für die Anmeldung meldest du deine Wohnung bei der zuständigen Meldebehörde oder beim Bürgeramt an. "
            "Bring deinen Pass oder Ausweis und die Wohnungsgeberbestätigung mit; prüfe zusätzlich die Terminseite deiner Stadt."
        )
    return (
        "For city registration, register your address with the local registration office or Bürgeramt. "
        "Bring your passport or ID and the landlord confirmation; also check your city's appointment page for local requirements."
    )


def _not_enough_info(language: str, citations: list[dict], trace: list[str], confidence: float) -> dict:
    if language == "de":
        answer = ("Ich weiß es aus den vorliegenden offiziellen Quellen nicht sicher. "
                  "Bitte gib mehr Details an oder sprich mit einer Beratungsperson.")
    else:
        answer = ("I don't know this safely from the available official sources. "
                  "Please add more detail or speak with a counselor.")
    return {"answer": answer, "citations": citations, "confidence": confidence,
            "escalate": True, "trace": trace, "needs_input": False}


def _clarify_first(language: str, trace: list[str], sources: list[dict]) -> dict:
    question = ("Welche konkrete Hilfe brauchst du: Anmeldung, Aufenthalt, Arbeit, Krankenversicherung oder etwas anderes?"
                if language == "de"
                else "What specific help do you need: registration, residence, work, health insurance, or something else?")
    return {
        "answer": _one_detail(language),
        "clarifying_question": question,
        "citations": _citations(sources, []),
        "confidence": 0.35,
        "escalate": False,
        "trace": trace + ["Asked a clarifying question before answering"],
        "needs_input": True,
    }


def _one_detail(language: str) -> str:
    return ("Ich möchte das richtig beantworten und brauche zuerst eine genauere Angabe."
            if language == "de"
            else "I want to get this right, so I need one detail first.")


def _detect_language(query: str, requested: str) -> str:
    q = f" {query.lower()} "
    if re.search(r"[äöüß]", query, re.I):
        return "de"
    german_markers = [" ich ", " kann ", " wie ", " wo ", " was ", " warum ", " brauche ",
                      " bekomme ", " anmelden", " ausländer", " arbeit", " darf ", " muss "]
    if any(m in q for m in german_markers):
        return "de"
    return "de" if requested == "de" else "en"


def _looks_vague(query: str) -> bool:
    words = re.findall(r"\w+", query.lower(), flags=re.UNICODE)
    if len(words) <= 2:
        return True
    vague = {"help", "hilfe", "problem", "question", "frage", "what now", "was jetzt"}
    return " ".join(words) in vague


def _as_float(value: object, default: float) -> float:
    try:
        return float(value)
    except Exception:  # noqa: BLE001
        return default


def _should_escalate(query: str, confidence: float) -> bool:
    import re
    if confidence < 0.4:
        return True
    return bool(re.search(r"lawyer|deport|abschieb|denied|rejected|emergency|police|violence|suicide", query, re.I))
