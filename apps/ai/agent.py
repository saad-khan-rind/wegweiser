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
from datetime import datetime, timezone

import web
import llm
from vectorstore import get_store
from rag import Retriever

try:
    from langchain_core.documents import Document  # type: ignore
except Exception:  # pragma: no cover - optional dependency
    Document = None  # type: ignore

log = logging.getLogger("agent")

MAX_ITERS = int(os.getenv("AGENT_MAX_ITERS", "1"))
USE_WEB = os.getenv("AGENT_USE_WEB", "1") == "1"
USE_BUNDLED_CORPUS = os.getenv("AGENT_USE_BUNDLED_CORPUS", "1") == "1"

_corpus = Retriever()


def langchain_available() -> bool:
    return Document is not None


# --------------------------------------------------------------------------- #
# Source gathering
# --------------------------------------------------------------------------- #
def gather_sources(query: str, tags: list[str], k: int = 4, region: str = "", language: str = "en",
                   allow_web: bool | None = None, allow_llm_translation: bool = True) -> list[dict]:
    sources, _ = gather_sources_with_audit(query, tags, k, region, language, allow_web, allow_llm_translation)
    return sources


def gather_sources_with_audit(query: str, tags: list[str], k: int = 4, region: str = "",
                              language: str = "en", allow_web: bool | None = None,
                              allow_llm_translation: bool = True) -> tuple[list[dict], list[dict]]:
    candidates: list[dict] = []
    query_variants = _query_variants(query, language, allow_llm_translation)
    web_enabled = USE_WEB if allow_web is None else allow_web

    # 1) admin-uploaded documents (vector store)
    for qv in query_variants:
        for m in get_store().query(qv["query"], k=max(k * 4, 12)):
            md = m.get("metadata", {})
            candidates.append({
                "id": m.get("id", md.get("id", "")),
                "title": md.get("title", "Uploaded document"),
                "text": m.get("text") or md.get("text", ""),
                "source": md.get("source", "admin upload"),
                "source_type": md.get("source_type", ""),
                "url": md.get("url", ""),
                "date": md.get("date", ""),
                "origin": "upload",
                "score": m.get("score", 0),
                "matched_query": qv["label"],
            })

    # 2) crawled official / Integreat content
    if USE_BUNDLED_CORPUS:
        for qv in query_variants:
            for d in _corpus.retrieve(qv["query"], tags, k=k):
                candidates.append({
                    "id": d.get("id", ""),
                    "title": d["title"], "text": d["text"], "source": d["origin"],
                    "url": d.get("url", ""), "date": d.get("updatedAt", ""),
                    "origin": d.get("origin", "crawler"), "score": d.get("score", 0),
                    "matched_query": qv["label"],
                })

    # 3) live web for the latest info; never writes to Pinecone.
    if web_enabled:
        for qv in query_variants:
            for r in web.direct_sources(qv["query"], qv["lang"], k=3):
                candidates.append({
                    "id": r.get("id", ""),
                    "title": r.get("title", "Official source"),
                    "text": r.get("snippet", ""),
                    "source": "official-web",
                    "url": r.get("url", ""),
                    "date": "latest",
                    "origin": "web",
                    "score": 0.7,
                    "matched_query": qv["label"],
                })
            region_hint = region or "bavaria"
            web_query = f"{qv['query']} {region_hint} Germany official"
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
                        "matched_query": qv["label"],
                    })

    rank_query = " ".join(qv["query"] for qv in query_variants)
    considered = _rank_sources(rank_query, _dedupe(candidates))
    accepted = [s for s in considered if s.get("accepted")]
    return accepted[: k * 2], considered[: max(k * 4, 12)]


QUERY_CLUSTERS = [
    {"visa", "visum", "residence", "permit", "aufenthalt", "aufenthaltstitel", "residence permit"},
    {"student visa", "study visa", "national visa", "studentenvisum", "visum zum studium", "visa for studies"},
    {"study", "studies", "studium", "student", "studenten", "studierenden", "university", "hochschule"},
    {
        "blocked account", "blocked amount", "proof of funds", "proof of financial resources",
        "financial proof", "secure livelihood", "subsistence", "living expenses",
        "sperrkonto", "finanzierungsnachweis", "lebensunterhalt", "finanzielle mittel",
    },
    {"graduation", "graduate", "abschluss", "studienabschluss", "after studies", "nach dem studium"},
    {"work", "job", "employment", "labour", "labor", "arbeit", "arbeiten", "arbeitsmarkt", "beschaeftigung", "beschäftigung"},
    {"registration", "register", "address", "anmeldung", "anmelden", "melde", "meldebehoerde", "meldebehorde", "buergeramt", "bürgeramt"},
    {"appointment", "booking", "book", "termin", "terminbuchung", "online appointment", "online-termin"},
    {"documents", "document", "paperwork", "checklist", "unterlagen", "dokumente", "nachweise", "checkliste"},
    {"health insurance", "insurance", "krankenversicherung", "versicherung"},
    {"benefit", "child benefit", "kindergeld", "leistung", "leistungen"},
    {"language course", "integration course", "deutschkurs", "sprachkurs", "integrationskurs"},
]

IN_SCOPE_TERMS = {
    "immigration", "migration", "visa", "visum", "residence", "permit", "aufenthalt", "aufenthaltstitel",
    "asylum", "asyl", "refugee", "flucht", "schutz", "naturalization", "citizenship", "einbuergerung",
    "einbürgerung", "passport", "travel document", "blue card", "blaue karte", "registration", "anmeldung",
    "melde", "buergeramt", "bürgeramt", "auslaender", "ausländer", "auslaenderbehoerde", "ausländerbehörde",
    "jobcenter", "arbeitsagentur", "work permit", "arbeitserlaubnis", "labour market", "arbeitsmarkt",
    "study", "studies", "student", "graduation", "after studies", "studium", "university", "hochschule", "school", "schule", "language course", "sprachkurs",
    "blocked account", "blocked amount", "proof of funds", "proof of financial resources", "financial proof",
    "secure livelihood", "subsistence", "living expenses", "sperrkonto", "finanzierungsnachweis", "lebensunterhalt",
    "integration", "integrationskurs", "health insurance", "krankenversicherung", "kindergeld",
    "buergergeld", "bürgergeld", "benefit", "sozialleistung", "german law", "german policy",
    "deutsches recht", "germany law", "travel to", "einreise", "entry requirement",
}


def _query_variants(query: str, language: str, allow_llm_translation: bool = True) -> list[dict]:
    other = "de" if language == "en" else "en"
    variants = [
        {"query": query, "lang": language, "label": f"original-{language}"},
        {"query": _expanded_query(query), "lang": language, "label": f"expanded-{language}"},
    ]
    translated = (_translate_query(query, other) if allow_llm_translation else "") or _rule_translate_query(query, other)
    if translated:
        variants.append({"query": translated, "lang": other, "label": f"translated-{other}"})
        variants.append({"query": _expanded_query(translated), "lang": other, "label": f"expanded-{other}"})
    out, seen = [], set()
    for item in variants:
        q = re.sub(r"\s+", " ", item["query"]).strip()
        if q and q.lower() not in seen:
            seen.add(q.lower())
            out.append({**item, "query": q})
    return out[:4]


def _translate_query(query: str, target_lang: str) -> str:
    info = llm.available()
    if not (info.get("reachable") and info.get("chat_model_present")):
        return ""
    target = "German" if target_lang == "de" else "English"
    system = (
        "Translate the user's search question for retrieval. Preserve meaning, names, cities, and legal terms. "
        "Do not answer the question. Respond as strict JSON: {\"translation\": string}."
    )
    data = llm.chat_json(system, f"Target language: {target}\nQuestion: {query}", temperature=0.0)
    translated = (data or {}).get("translation", "")
    return translated.strip()[:500] if isinstance(translated, str) else ""


def _rule_translate_query(query: str, target_lang: str) -> str:
    norm = _normalize(query)
    additions: list[str] = []
    for cluster in QUERY_CLUSTERS:
        normalized_cluster = {_normalize(term) for term in cluster}
        if any(term in norm for term in normalized_cluster):
            additions.extend(sorted(cluster))
    if not additions:
        return ""
    if target_lang == "de":
        additions.extend(["Deutschland", "Bayern", "offizielle Informationen"])
    else:
        additions.extend(["Germany", "Bavaria", "official information"])
    return f"{query} {' '.join(additions)}"


def _expanded_query(query: str) -> str:
    norm = _normalize(query)
    additions: list[str] = []
    for cluster in QUERY_CLUSTERS:
        normalized_cluster = {_normalize(term) for term in cluster}
        if any(term in norm for term in normalized_cluster):
            additions.extend(sorted(cluster))
    return f"{query} {' '.join(additions)}" if additions else query


def _rank_sources(query: str, sources: list[dict]) -> list[dict]:
    out = []
    threshold = 3 if _registration_topic(query) else 2
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
    "germany", "german", "bavaria", "official", "rule", "rules", "after", "over",
    "information", "info", "help", "need", "needs", "whole", "all", "any", "some",
    "germany", "bayern", "deutschland", "offizielle", "informationen", "hilfe",
    "welche", "schritte", "sind",
    "fuer", "für", "die", "der", "das", "und", "oder", "ich", "du", "sie",
}


def _text_terms(text: str) -> set[str]:
    norm = _normalize(text)
    return {w for w in re.findall(r"\w+", norm, flags=re.UNICODE) if len(w) > 2 and w not in STOP}


def _query_terms(query: str) -> set[str]:
    terms = _text_terms(query)
    norm = _normalize(query)
    for cluster in QUERY_CLUSTERS:
        normalized_cluster = {_normalize(term) for term in cluster}
        if terms & normalized_cluster or any(term in norm for term in normalized_cluster):
            terms |= normalized_cluster
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
        "source_type": s.get("source_type", ""),
        "origin": s.get("origin", ""),
        "url": s.get("url", ""),
        "date": s.get("date", ""),
        "score": s.get("score", 0),
        "relevance": s.get("relevance", 0),
        "accepted": bool(s.get("accepted")),
        "matched_query": s.get("matched_query", ""),
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
        if key in seen or not s.get("text") or _blocked_source(s):
            continue
        seen.add(key)
        out.append(s)
    return out


def _blocked_source(source: dict) -> bool:
    text = f"{source.get('title', '')} {source.get('text', '')[:1200]}"
    return web.is_blocked_text(text)


# --------------------------------------------------------------------------- #
# LLM steps
# --------------------------------------------------------------------------- #
def _source_block(sources: list[dict]) -> str:
    docs = _langchain_documents(sources)
    if docs:
        lines = []
        for i, doc in enumerate(docs, 1):
            meta = doc.metadata
            source = meta.get("source", "")
            date = meta.get("date", "")
            title = meta.get("title", f"Source {i}")
            header = f"{source}" + (f", {date}" if date else "")
            lines.append(f"[{i}] {title} ({header})\n{doc.page_content[:1200]}")
        return "\n\n".join(lines)

    lines = []
    for i, s in enumerate(sources, 1):
        meta = f"{s['source']}" + (f", {s['date']}" if s.get("date") else "")
        lines.append(f"[{i}] {s['title']} ({meta})\n{s['text'][:1200]}")
    return "\n\n".join(lines) if lines else "(no sources found)"


def _langchain_documents(sources: list[dict]):
    if Document is None:
        return []
    docs = []
    for s in sources:
        text = re.sub(r"\s+", " ", str(s.get("text", ""))).strip()
        if not text:
            continue
        docs.append(Document(
            page_content=text,
            metadata={
                "title": s.get("title", ""),
                "source": s.get("source", ""),
                "url": s.get("url", ""),
                "date": s.get("date", ""),
                "relevance": s.get("relevance", 0),
                "matched_query": s.get("matched_query", ""),
            },
        ))
    return docs


def _langchain_context_document(answers: dict, path: list[dict], language: str):
    if Document is None:
        return None
    return Document(
        page_content=_guided_context(answers, path, language),
        metadata={"source": "user-guided-flow", "language": language},
    )


def _draft_system(language: str) -> str:
    answer_language = "German" if language == "de" else "English"
    return (
        "You are Wegweiser, a migration guidance assistant for newcomers in Germany. "
        "Your goal is to help the user achieve their goal accurately. "
        "Use ONLY the provided sources. Cite them inline as [1], [2]. "
        f"Answer in {answer_language}. "
        "The first part must always be a summary of the whole understanding. "
        "If the sources include required documents, put them in document_checklist. "
        "If the sources include actionable order, put it in steps. "
        "If the task requires booking and the sources show it can be done online, set booking.online=true and include the official booking link. "
        "If the sources do not support an answer, say that you do not know from the official sources in the summary. "
        "Do NOT invent offices, dates, amounts, links, phone numbers, eligibility, or rules. "
        "Respond as strict JSON: "
        '{"summary": string, "document_checklist": string[], "steps": string[], '
        '"booking": {"needed": boolean, "online": boolean, "link": string, "note": string}, '
        '"used": number[], "confidence": number, "assumptions": string[]}.'
    )

VERIFY_SYS = (
    "You verify a draft answer against the sources, like a careful reviewer. Check every claim. "
    "CAPTCHA, access-denied, security-block, or bot-check text is never a valid source and must be rejected. "
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
def run_guided_flow(answers: dict | None, path: list[dict] | None, region: str = "",
                    language: str = "en") -> dict:
    clean_answers = _clean_guided_answers(answers or {})
    clean_path = _clean_guided_path(path or [])
    prompt = _guided_prompt(clean_answers, clean_path, language)
    context = _guided_context(clean_answers, clean_path, language)
    tags = _guided_tags(clean_answers)
    clarifying = {key: _guided_value(value) for key, value in clean_answers.items() if _guided_value(value)}
    result = run(prompt, tags, region, language, context, clarifying)
    result["guided_context"] = {
        "answers": clean_answers,
        "path": clean_path,
        "prompt": prompt,
    }
    return result


def run_guided_options(node_id: str, answers: dict | None, path: list[dict] | None,
                       region: str = "", language: str = "en") -> dict:
    clean_answers = _clean_guided_answers(answers or {})
    clean_path = _clean_guided_path(path or [])
    clean_node = re.sub(r"[^a-zA-Z0-9_-]+", "", str(node_id))[:80]
    query = _guided_options_query(clean_node, clean_answers, clean_path, language)
    tags = _guided_tags(clean_answers)
    trace = [f"Building options for node: {clean_node}"]
    if Document is not None:
        trace.append("LangChain document context enabled")
    llm_info = llm.available()
    sources, considered = gather_sources_with_audit(
        query,
        tags,
        k=5,
        region=region,
        language=language,
        allow_web=False,
        allow_llm_translation=False,
    )
    trace.append("Bubble options used RAG only; live web is reserved for the final answer")
    trace.append(f"Considered {len(considered)} resources; kept {len(sources)} relevant sources")

    llm_ready = bool(llm_info.get("reachable") and llm_info.get("chat_model_present"))
    options: list[dict] = []
    if llm_ready and sources:
        data = llm.chat_json(
            _guided_options_system(language),
            _guided_options_user(clean_node, clean_answers, clean_path, sources, language),
            temperature=0.05,
        )
        if isinstance(data, dict) and isinstance(data.get("options"), list):
            options = data["options"]
            trace.append("Generated options with the LLM from retrieved sources")
    elif not llm_ready:
        trace.append("Skipped LLM option generation because no chat model is available")

    if not options:
        rag_sources = sources or [s for s in considered if not _blocked_source(s)][:8]
        options = _rag_guided_options(clean_node, rag_sources, language, clean_answers)
        if options:
            trace.append("Generated explorable options directly from RAG sources because the LLM was unavailable or returned no options")
        else:
            trace.append("No source-backed RAG options generated; returning empty options")

    safe_options = _sanitize_guided_options(options, language, clean_node)
    return _with_runtime({
        "nodeId": clean_node,
        "options": safe_options,
        "sources": _citations(sources, []),
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "trace": trace,
    }, _resources(considered), llm_info)


def run(query: str, tags: list[str], region: str = "", language: str = "en",
        extra_context: str = "", clarifying_answers: dict | None = None) -> dict:
    answer_language = _detect_language(query, language)
    answer_context = _answers_context(clarifying_answers or {})
    if answer_context:
        extra_context = f"{extra_context}\n{answer_context}".strip()
    goal = query if not extra_context else f"{query}\nPrevious conversation or extra user detail (use only if relevant):\n{extra_context[:1200]}"
    retrieval_query = _contextual_query(query, extra_context)
    trace: list[str] = []
    llm_info = llm.available()

    if not _in_scope(query):
        trace.append("Stopped before retrieval: question is outside Wegweiser scope")
        return _with_runtime(_out_of_scope(answer_language, trace), [], llm_info)

    missing_questions = _required_clarifications(query, answer_language, extra_context)
    if missing_questions:
        trace.append("Asked for missing user-specific facts before answering")
        return _with_runtime(_clarification_payload(answer_language, missing_questions, trace), [], llm_info)

    sources, considered = gather_sources_with_audit(retrieval_query, tags, region=region, language=answer_language)
    resources = _resources(considered)
    trace.append("Searched with English and German query variants")
    if extra_context:
        trace.append("Used previous conversation context for this follow-up")
    trace.append(f"Considered {len(considered)} resources; kept {len(sources)} relevant sources")

    if _looks_vague(query) and not extra_context and len(sources) < 2 and not _registration_topic(query):
        return _with_runtime(_clarify_first(answer_language, trace, sources), resources, llm_info)

    if not sources:
        return _with_runtime(_not_enough_info(answer_language, [], trace, confidence=0.2), resources, llm_info)

    llm_ready = bool(llm_info.get("reachable") and llm_info.get("chat_model_present"))
    if not llm_ready:
        return _with_runtime(_grounded_fallback(query, sources, "LLM unavailable or chat model missing", trace, answer_language), resources, llm_info)

    draft = _draft(goal, tags, sources, answer_language)
    if not draft or not (draft.get("summary") or draft.get("answer")):
        return _with_runtime(_grounded_fallback(query, sources, "draft failed", trace, answer_language), resources, llm_info)
    trace.append("Drafted an answer with citations")

    used = draft.get("used", [])
    confidence = _as_float(draft.get("confidence"), 0.6)
    answer = _format_answer(draft, answer_language)
    unsupported = False

    topic_fallback = _extractive_answer(query, sources, answer_language)
    if _should_use_topic_fallback(query, answer) and topic_fallback:
        trace.append("Replaced thin model draft with structured source-grounded answer")
        return _with_runtime({
            "answer": topic_fallback,
            "citations": _citations(sources, used),
            "confidence": max(0.62, min(confidence, 0.72)),
            "escalate": False,
            "trace": trace,
            "needs_input": False,
        }, resources, llm_info)

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
            answer = _format_answer(draft, answer_language) if (draft.get("summary") or draft.get("answer")) else answer
            used = draft.get("used", used)
            continue

        if verdict.get("corrected_answer"):
            answer = _ensure_summary(verdict["corrected_answer"], answer_language)
        if web.is_blocked_text(answer):
            trace.append("Rejected draft because it contained blocked/captcha text")
            return _with_runtime(_grounded_fallback(query, sources, "blocked web text rejected", trace, answer_language), resources, llm_info)
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
    if web.is_blocked_text(answer):
        trace.append("Rejected final answer because it contained blocked/captcha text")
        return _with_runtime(_grounded_fallback(query, sources, "blocked web text rejected", trace, answer_language), resources, llm_info)
    return _with_runtime({
        "answer": _ensure_summary(answer, answer_language),
        "citations": _citations(sources, used),
        "confidence": round(max(0.0, min(1.0, confidence)), 2),
        "escalate": escalate,
        "trace": trace,
        "needs_input": False,
    }, resources, llm_info)


def _in_scope(query: str) -> bool:
    q = _normalize(query)
    if any(_normalize(term) in q for term in IN_SCOPE_TERMS):
        return True
    legal_context = re.search(r"\b(germany|german|deutschland|deutsch|bavaria|bayern)\b", q)
    legal_topic = re.search(r"\b(law|policy|rule|rules|rights|pflicht|recht|gesetz|behörde|amt)\b", q)
    return bool(legal_context and legal_topic)


def _answers_context(answers: dict) -> str:
    lines = []
    for key, value in answers.items():
        if value is None:
            continue
        clean_key = re.sub(r"[^a-zA-Z0-9_-]+", "", str(key))[:80]
        clean_value = re.sub(r"\s+", " ", str(value)).strip()[:240]
        if clean_key and clean_value:
            lines.append(f"Clarifying answer {clean_key}: {clean_value}")
    return "\n".join(lines)


def _clean_guided_answers(answers: dict) -> dict:
    out = {}
    for key, value in answers.items():
        clean_key = re.sub(r"[^a-zA-Z0-9_-]+", "", str(key))[:80]
        if not clean_key:
            continue
        if isinstance(value, (str, int, float, bool)):
            out[clean_key] = _guided_value(value)
        elif isinstance(value, list):
            out[clean_key] = [_guided_value(item) for item in value[:20] if _guided_value(item)]
    return out


def _clean_guided_path(path: list[dict]) -> list[dict]:
    out = []
    for item in path[:20]:
        if not isinstance(item, dict):
            continue
        question = re.sub(r"\s+", " ", str(item.get("question", ""))).strip()[:260]
        answer = re.sub(r"\s+", " ", str(item.get("answerLabel", ""))).strip()[:260]
        node_id = re.sub(r"[^a-zA-Z0-9_-]+", "", str(item.get("nodeId", "")))[:80]
        answer_key = re.sub(r"[^a-zA-Z0-9_-]+", "", str(item.get("answerKey", "")))[:80]
        value = item.get("value", "")
        out.append({
            "nodeId": node_id,
            "answerKey": answer_key,
            "question": question,
            "answerLabel": answer,
            "value": _guided_value(value) if not isinstance(value, list) else [_guided_value(v) for v in value[:20]],
        })
    return [item for item in out if item["question"] or item["answerLabel"] or item["answerKey"]]


def _guided_value(value: object) -> str:
    text = re.sub(r"\s+", " ", str(value)).strip()
    return text[:240]


def _guided_prompt(answers: dict, path: list[dict], language: str) -> str:
    trail = " -> ".join(item.get("answerLabel") or _guided_value(item.get("value", "")) for item in path)
    trail = re.sub(r"\s+", " ", trail).strip()
    planning = answers.get("locationIntent") == "planning_move"
    visa = _guided_value(answers.get("visaStatus", ""))
    age = _guided_value(answers.get("age", ""))
    if language == "de":
        parts = [
            "Erstelle einen quellenbasierten Migrations-Guide fuer Deutschland.",
            "Die Person plant den Umzug nach Deutschland." if planning else "Die Person ist bereits in Deutschland.",
            f"Alter: {age}." if age else "",
            f"Gewaehlter Visa- oder Aufenthaltsweg: {visa}." if visa else "",
            f"Bubble-Pfad: {trail}." if trail else "",
            "Gib Zusammenfassung, Dokumenten-Checkliste, konkrete Schritte, Termin-Hinweise und offizielle Quellen.",
        ]
    else:
        parts = [
            "Create a source-grounded migration guide for Germany.",
            "The person is planning to move to Germany." if planning else "The person is already in Germany.",
            f"Age: {age}." if age else "",
            f"Selected visa or residence path: {visa}." if visa else "",
            f"Bubble path: {trail}." if trail else "",
            "Include a summary, document checklist, concrete steps, appointment notes, and official sources.",
        ]
    return " ".join(part for part in parts if part)


def _guided_context(answers: dict, path: list[dict], language: str) -> str:
    heading = "Gefuehrter Bubble-Kontext" if language == "de" else "Guided bubble context"
    lines = [heading]
    for index, item in enumerate(path, 1):
        answer = item.get("answerLabel") or _guided_value(item.get("value", ""))
        lines.append(f"{index}. {item.get('question') or item.get('answerKey')}: {answer}")
    lines.append("Raw categories:")
    for key, value in answers.items():
        lines.append(f"- {key}: {_guided_value(value)}")
    return "\n".join(lines)[:2400]


def _guided_tags(answers: dict) -> list[str]:
    tags = set()
    if answers.get("locationIntent") == "planning_move" or answers.get("journeyStage") == "just_arrived":
        tags.add("status:arriving")
    visa = str(answers.get("visaStatus", ""))
    if visa == "student":
        tags.add("status:student")
    if visa in {"work", "skilled_work", "blue_card", "opportunity_card", "vocational_training"}:
        tags.add("status:worker")
    if visa == "family":
        tags.add("status:family")
    if visa == "asylum":
        tags.add("status:asylum")
    return sorted(tags)


def _guided_options_query(node_id: str, answers: dict, path: list[dict], language: str) -> str:
    age = _guided_value(answers.get("age", ""))
    location = _guided_value(answers.get("locationIntent", ""))
    visa = _guided_value(answers.get("visaStatus", ""))
    trail = " ".join(item.get("answerLabel", "") for item in path)
    age_context = _age_context_for_retrieval(age)
    is_minor_context = age_context.startswith("minor")
    topic_hints = {
        "planning-visa": (
            "minor child school family reunification guardian protection residence Germany"
            if is_minor_context
            else "residence permit national visa studies vocational training skilled work family reunification "
            "asylum protection language course Germany"
        ),
        "planning-readiness": (
            "visa application readiness admission enrolment job offer training contract family documents "
            "proof livelihood health insurance"
        ),
        "planning-documents": (
            "visa residence documents passport biometric photo health insurance proof income enrolment "
            "birth certificate family documents"
        ),
        "current-status": (
            "residence status Aufenthaltstitel asylum protection work permission student family registration Germany"
        ),
        "current-goal": (
            "registration renewal residence permit work rights health insurance family benefits language integration "
            "appointment documents Germany"
        ),
        "current-documents": (
            "documents passport registration certificate residence document health insurance proof income "
            "rental contract appointment Germany"
        ),
    }
    hint = topic_hints.get(node_id, "Germany migration residence documents next step")
    if language == "de":
        return (
            f"{hint}. Bubble {node_id}. "
            f"Kontext: Alter {age}, {age_context}, Standort {location}, bisheriger Weg {trail}, Visum {visa}. "
            "Erzeuge naechste Optionen nur aus RAG-Quellen."
        )
    return (
        f"{hint}. Bubble {node_id}. "
        f"Context: age {age}, {age_context}, location {location}, path {trail}, visa {visa}. "
        "Generate next options only from RAG sources."
    )


def _age_context_for_retrieval(age: str) -> str:
    try:
        parsed = int(float(str(age).strip()))
    except Exception:
        return ""
    if parsed < 16:
        return "minor child school family reunification guardian protection"
    if parsed < 18:
        return "minor youth school family training guardian"
    return "adult"


def _guided_options_system(language: str) -> str:
    answer_language = "German" if language == "de" else "English"
    return (
        "You generate only the next tappable options for a guided migration flow for Germany. "
        "Use ONLY the provided sources and known context. Do not invent eligibility. "
        "Evaluate the user's age, location, and previous answers against the sources. "
        "If the sources do not clearly support an option for this user context, omit it or ask for counselor-first guidance. "
        f"Write labels and helpers in {answer_language}. "
        "Respond as strict JSON: "
        '{"options":[{"value": string, "label": string, "helper": string, "icon": string, '
        '"badge": string, "next": string, "source": string}]}. '
        "Return at most 8 options."
    )


def _guided_options_user(node_id: str, answers: dict, path: list[dict], sources: list[dict], language: str) -> str:
    context = _guided_context(answers, path, language)
    context_doc = _langchain_context_document(answers, path, language)
    if context_doc is not None:
        context = context_doc.page_content
    source_block = _source_block(sources)
    return (
        f"Current node id: {node_id}\n"
        f"Return the options that should be shown next for this node.\n"
        f"Allowed next ids are planning-readiness, planning-documents, current-goal, current-documents, ai-result.\n\n"
        f"{context}\n\nSources:\n{source_block}"
    )


def _rag_guided_options(node_id: str, sources: list[dict], language: str, answers: dict | None = None) -> list[dict]:
    if not sources:
        return []
    if node_id in {"planning-documents", "current-documents", "planning-readiness"}:
        doc_options = _document_options_from_sources(sources, node_id, language)
        if doc_options:
            return doc_options
    return _topic_options_from_sources(sources, node_id, language, answers or {})


def _topic_options_from_sources(sources: list[dict], node_id: str, language: str, answers: dict) -> list[dict]:
    out: list[dict] = []
    seen: set[str] = set()
    for source in sources[:8]:
        if not _source_supported_by_context(source, answers):
            continue
        title = re.sub(r"\s+", " ", str(source.get("title", ""))).strip()
        text = re.sub(r"\s+", " ", str(source.get("text", ""))).strip()
        if not title or title.lower() in seen:
            continue
        seen.add(title.lower())
        out.append({
            "value": _slug_value(source.get("id") or title),
            "label": title,
            "helper": _source_helper(text, language),
            "icon": _icon_for_source(source),
            "badge": "RAG source" if language == "en" else "RAG-Quelle",
            "next": _default_guided_next(node_id),
            "source": title,
        })
    return out[:8]


def _source_supported_by_context(source: dict, answers: dict) -> bool:
    try:
        age = int(float(str(answers.get("age", "")).strip()))
    except Exception:
        return True
    if age >= 16:
        return True
    text = _normalize(f"{source.get('title', '')} {source.get('text', '')}")
    adult_route = re.search(
        r"\b(higher education|university|skilled work|blue card|opportunity card|qualified employment|vocational training)\b",
        text,
    )
    return not adult_route


DOCUMENT_PATTERNS = [
    ("passport", "Valid passport", "Gueltiger Pass", r"\b(passport|pass|ausweis)\b"),
    ("biometric_photo", "Biometric photo", "Biometrisches Foto", r"\b(biometric photo|biometric photos|passport photo|passfoto|foto)\b"),
    ("health_insurance", "Health insurance proof", "Krankenversicherungsnachweis", r"\b(health insurance|krankenversicherung|insurance)\b"),
    ("income_or_livelihood", "Proof of income or livelihood", "Nachweis ueber Einkommen oder Lebensunterhalt", r"\b(proof of income|secure livelihood|livelihood|income|lebensunterhalt|einkommen)\b"),
    ("enrolment_or_admission", "Admission or enrolment proof", "Zulassung oder Immatrikulation", r"\b(enrolment|enrollment|admission|university admission|study place|immatrikulation|zulassung)\b"),
    ("job_or_training_contract", "Job or training contract", "Arbeits- oder Ausbildungsvertrag", r"\b(job offer|employment contract|training contract|work contract|arbeitsvertrag|ausbildungsvertrag)\b"),
    ("registration_certificate", "Registration certificate", "Meldebescheinigung", r"\b(registration certificate|meldebescheinigung|anmeldung)\b"),
    ("landlord_confirmation", "Landlord confirmation", "Wohnungsgeberbestaetigung", r"\b(landlord confirmation|wohnungsgeber|wohnungsgeberbestaetigung|wohnungsgeberbestätigung)\b"),
    ("rental_contract", "Rental contract", "Mietvertrag", r"\b(rental contract|rent contract|mietvertrag)\b"),
    ("residence_document", "Residence document", "Aufenthaltsdokument", r"\b(residence document|residence permit|aufenthaltstitel|aufenthaltsdokument)\b"),
    ("birth_certificate", "Birth certificate", "Geburtsurkunde", r"\b(birth certificate|birth certificates|geburtsurkunde)\b"),
    ("tax_id", "Tax ID", "Steuer-ID", r"\b(tax id|steuer.?id)\b"),
]


def _document_options_from_sources(sources: list[dict], node_id: str, language: str) -> list[dict]:
    text = "\n".join(f"{s.get('title', '')}. {s.get('text', '')}" for s in sources[:8])
    out: list[dict] = []
    for value, en_label, de_label, pattern in DOCUMENT_PATTERNS:
        if re.search(pattern, text, flags=re.I):
            out.append({
                "value": value,
                "label": de_label if language == "de" else en_label,
                "helper": _document_helper(sources, pattern, language),
                "icon": "FileText",
                "badge": "From RAG" if language == "en" else "Aus RAG",
                "next": _default_guided_next(node_id),
                "source": _matching_source_title(sources, pattern),
            })
    if node_id == "planning-readiness" and out:
        out.append({
            "value": "still_exploring",
            "label": "Still exploring" if language == "en" else "Noch in Klaerung",
            "helper": (
                "Use this when you do not yet have the source-mentioned proofs."
                if language == "en"
                else "Nutze das, wenn du die in den Quellen genannten Nachweise noch nicht hast."
            ),
            "icon": "Search",
            "badge": "RAG source" if language == "en" else "RAG-Quelle",
            "next": _default_guided_next(node_id),
            "source": "RAG context",
        })
    return out[:8]


def _document_helper(sources: list[dict], pattern: str, language: str) -> str:
    title = _matching_source_title(sources, pattern)
    if language == "de":
        return f"In den RAG-Quellen genannt: {title}." if title else "In den RAG-Quellen genannt."
    return f"Mentioned in RAG source: {title}." if title else "Mentioned in the RAG sources."


def _matching_source_title(sources: list[dict], pattern: str) -> str:
    for source in sources:
        text = f"{source.get('title', '')}. {source.get('text', '')}"
        if re.search(pattern, text, flags=re.I):
            return re.sub(r"\s+", " ", str(source.get("title", "RAG source"))).strip()[:120]
    return ""


def _source_helper(text: str, language: str) -> str:
    sentence = _sentences(text[:900])
    if sentence:
        return sentence[0][:220]
    return "Retrieved from local RAG context." if language == "en" else "Aus lokalem RAG-Kontext abgerufen."


def _icon_for_source(source: dict) -> str:
    text = _normalize(f"{source.get('title', '')} {source.get('text', '')[:600]} {' '.join(source.get('tags', []) if isinstance(source.get('tags'), list) else [])}")
    if re.search(r"\b(work|labour|arbeit|job|employment)\b", text):
        return "BriefcaseBusiness"
    if re.search(r"\b(study|student|university|studium|hochschule|language|integration)\b", text):
        return "GraduationCap"
    if re.search(r"\b(family|kindergeld|child|children|familie|kind)\b", text):
        return "Users"
    if re.search(r"\b(asylum|schutz|refugee|protection|asyl)\b", text):
        return "ShieldCheck"
    if re.search(r"\b(document|passport|registration|anmeldung|permit|aufenthalt)\b", text):
        return "FileText"
    return "Sparkles"


def _slug_value(value: object) -> str:
    slug = re.sub(r"[^a-zA-Z0-9_-]+", "_", str(value).lower()).strip("_")[:60]
    return slug or "rag_option"


def _sanitize_guided_options(options: list[dict], language: str, node_id: str) -> list[dict]:
    out = []
    for item in options[:12]:
        if not isinstance(item, dict):
            continue
        value = re.sub(r"[^a-zA-Z0-9_-]+", "", str(item.get("value", "")))[:80]
        label = re.sub(r"\s+", " ", str(item.get("label", value))).strip()[:120]
        helper = re.sub(r"\s+", " ", str(item.get("helper", ""))).strip()[:240]
        if not value or not label:
            continue
        next_id = re.sub(r"[^a-zA-Z0-9_-]+", "", str(item.get("next", _default_guided_next(node_id))))[:80]
        out.append({
            "value": value,
            "label": label,
            "helper": helper,
            "icon": re.sub(r"[^a-zA-Z0-9_-]+", "", str(item.get("icon", "Sparkles")))[:40],
            "badge": re.sub(r"\s+", " ", str(item.get("badge", "AI checked" if language == "en" else "AI-geprueft"))).strip()[:80],
            "next": next_id or _default_guided_next(node_id),
            "source": re.sub(r"\s+", " ", str(item.get("source", ""))).strip()[:160],
        })

    return out[:8]


def _default_guided_next(node_id: str) -> str:
    if node_id in {"planning-visa"}:
        return "planning-readiness"
    if node_id in {"planning-readiness"}:
        return "planning-documents"
    if node_id in {"current-status"}:
        return "current-goal"
    if node_id in {"current-goal"}:
        return "current-documents"
    return "ai-result"


def _required_clarifications(query: str, language: str, extra_context: str) -> list[dict]:
    context = f"{query}\n{extra_context}"
    q = _normalize(context)
    questions: list[dict] = []

    if _broad_immigration_topic(query) and not _has_specific_immigration_area(q):
        return [_question(
            "immigration_area",
            "Zu welchem Bereich brauchst du Hilfe?" if language == "de"
            else "Which immigration topic do you need help with?",
            [
                ("visa_entry", "Visum oder Einreise" if language == "de" else "Visa or entry"),
                ("residence", "Aufenthaltstitel verlängern/wechseln" if language == "de" else "Residence permit extension/change"),
                ("study", "Studium" if language == "de" else "Studies"),
                ("work", "Arbeit oder Jobsuche" if language == "de" else "Work or job search"),
                ("family", "Familiennachzug" if language == "de" else "Family reunification"),
                ("asylum", "Asyl oder Schutzstatus" if language == "de" else "Asylum or protection status"),
                ("citizenship", "Einbürgerung" if language == "de" else "Citizenship/naturalization"),
            ],
        )]

    if _travel_visa_topic(query):
        if not _has_nationality_context(q):
            questions.append(_question(
                "nationality",
                "Mit welchem Pass bzw. welcher Staatsangehörigkeit reist du?" if language == "de"
                else "Which passport or nationality will you travel with?",
                [
                    ("pakistani", "Pakistanischer Pass" if language == "de" else "Pakistani passport"),
                    ("german", "Deutscher Pass" if language == "de" else "German passport"),
                    ("eu", "EU/EWR-Pass" if language == "de" else "EU/EEA passport"),
                    ("other", "Andere Staatsangehörigkeit" if language == "de" else "Other nationality"),
                    ("dual", "Doppelte Staatsangehörigkeit" if language == "de" else "Dual nationality"),
                ],
                free_text=True,
            ))
        if not _has_status_context(q):
            questions.append(_question(
                "germany_status",
                "Welchen Aufenthaltsstatus hast du aktuell in Deutschland?" if language == "de"
                else "What is your current status in Germany?",
                _residence_status_options(language),
            ))
        if not _has_travel_purpose(q):
            questions.append(_question(
                "travel_purpose",
                "Was ist der Zweck und ungefähr die Dauer der Reise?" if language == "de"
                else "What is the purpose and approximate length of the trip?",
                [
                    ("tourism_short", "Tourismus/Familienbesuch unter 30 Tage" if language == "de" else "Tourism/family visit under 30 days"),
                    ("business_short", "Geschäftsreise unter 30 Tage" if language == "de" else "Business trip under 30 days"),
                    ("study_work", "Studium oder Arbeit" if language == "de" else "Study or work"),
                    ("transit", "Nur Transit" if language == "de" else "Transit only"),
                    ("other", "Anderer Zweck" if language == "de" else "Other purpose"),
                ],
                free_text=True,
            ))
        return questions[:4]

    if _work_permission_topic(query) and not _has_status_context(q):
        questions.append(_question(
            "germany_status",
            "Welchen Aufenthaltsstatus hast du aktuell in Deutschland?" if language == "de"
            else "What is your current residence status in Germany?",
            _residence_status_options(language),
        ))
        return questions

    if _benefits_topic(query):
        if not _has_status_context(q):
            questions.append(_question(
                "germany_status",
                "Welchen Aufenthaltsstatus hast du aktuell in Deutschland?" if language == "de"
                else "What is your current residence status in Germany?",
                _residence_status_options(language),
            ))
        if not re.search(r"\b(child|children|kid|kids|kind|kinder|family|familie|partner|spouse|ehe)\b", q):
            questions.append(_question(
                "household",
                "Geht es um dich allein oder um eine Familie/Kinder?" if language == "de"
                else "Is this for you alone or for a family/children?",
                [
                    ("alone", "Nur ich" if language == "de" else "Only me"),
                    ("children", "Mit Kindern" if language == "de" else "With children"),
                    ("partner", "Mit Partner/in" if language == "de" else "With partner/spouse"),
                    ("family", "Familie mit Kindern" if language == "de" else "Family with children"),
                ],
            ))
        return questions[:3]

    return []


def _question(question_id: str, question: str, options: list[tuple[str, str]], free_text: bool = False) -> dict:
    return {
        "id": question_id,
        "question": question,
        "required": True,
        "type": "single_choice_with_text" if free_text else "single_choice",
        "options": [{"value": value, "label": label} for value, label in options],
    }


def _residence_status_options(language: str) -> list[tuple[str, str]]:
    if language == "de":
        return [
            ("german_or_eu", "Deutsche/r oder EU/EWR-Bürger/in"),
            ("permanent", "Niederlassungserlaubnis/Daueraufenthalt"),
            ("student", "Aufenthaltstitel zum Studium"),
            ("work", "Aufenthaltstitel zur Arbeit / Blaue Karte EU"),
            ("family", "Familiennachzug"),
            ("asylum_protection", "Asyl, Flüchtlingsschutz oder subsidiärer Schutz"),
            ("temporary_protection", "Vorübergehender Schutz"),
            ("visitor", "Schengen-Visum/Besuchsaufenthalt"),
            ("not_sure", "Ich bin nicht sicher"),
        ]
    return [
        ("german_or_eu", "German or EU/EEA citizen"),
        ("permanent", "Permanent residence"),
        ("student", "Student residence permit"),
        ("work", "Work residence permit / EU Blue Card"),
        ("family", "Family reunification"),
        ("asylum_protection", "Asylum/refugee/subsidiary protection"),
        ("temporary_protection", "Temporary protection"),
        ("visitor", "Schengen visa / visitor stay"),
        ("not_sure", "I am not sure"),
    ]


def _clarification_payload(language: str, questions: list[dict], trace: list[str]) -> dict:
    answer = (
        "Zusammenfassung\nIch kann das erst sicher beantworten, wenn diese Angaben klar sind. "
        "Bitte beantworte die Fragen, dann prüfe ich die passenden offiziellen Quellen."
        if language == "de"
        else "Summary\nI need a few details before I can answer this safely. "
             "Please answer these questions, then I will check the matching official sources."
    )
    return {
        "answer": answer,
        "clarifying_question": questions[0]["question"] if questions else "",
        "clarifying_questions": questions,
        "citations": [],
        "confidence": 0.45,
        "escalate": False,
        "trace": trace,
        "needs_input": True,
    }


def _out_of_scope(language: str, trace: list[str]) -> dict:
    answer = (
        "Zusammenfassung\nIch kann nur bei Fragen zu Migration, Aufenthalt, Integration, "
        "deutscher Verwaltung oder deutschen Rechts-/Politikthemen helfen."
        if language == "de"
        else "Summary\nI can only help with immigration, residence, integration, German administration, "
             "or German law/policy questions."
    )
    return {
        "answer": answer,
        "citations": [],
        "confidence": 0.9,
        "escalate": False,
        "trace": trace,
        "needs_input": False,
    }


def _travel_visa_topic(query: str) -> bool:
    q = _normalize(query)
    if _student_visa_topic(query):
        return False
    has_visa = re.search(r"\b(visa|visum|entry requirement|einreise)\b", q)
    has_travel = re.search(r"\b(travel|visit|go to|enter|entry|reise|reisen|besuch|nach)\b", q)
    return bool(has_visa and has_travel)


def _student_visa_topic(query: str) -> bool:
    q = _normalize(query)
    return bool(re.search(r"\b(student visa|study visa|visa for stud|national visa.*stud|studentenvisum|visum zum studium)\b", q))


def _student_finance_topic(query: str) -> bool:
    q = _normalize(query)
    has_student_context = bool(re.search(r"\b(student|study|studium|studentenvisum|visum zum studium)\b", q))
    has_finance_context = bool(re.search(
        r"\b(blocked account|blocked amount|proof of funds|financial proof|proof of financial resources|"
        r"secure livelihood|living expenses|sperrkonto|finanzierungsnachweis|lebensunterhalt|finanzielle mittel)\b",
        q,
    ))
    return has_student_context and has_finance_context


def _post_study_topic(query: str) -> bool:
    q = _normalize(query)
    return bool(re.search(r"\b(after studies|after graduation|post study|post-study|rules after studies|nach dem studium|studienabschluss|abschluss.*stud)\b", q))


def _work_permission_topic(query: str) -> bool:
    q = _normalize(query)
    return bool(re.search(r"\b(can i work|allowed to work|work permit|darf ich arbeiten|arbeiten darf|arbeitserlaubnis)\b", q))


def _benefits_topic(query: str) -> bool:
    q = _normalize(query)
    return bool(re.search(r"\b(benefit|eligible|kindergeld|buergergeld|burgergeld|sozialleistung|leistungen|jobcenter)\b", q))


def _broad_immigration_topic(query: str) -> bool:
    q = _normalize(query)
    return bool(re.search(r"\b(immigration law|immigration laws|migration law|migration laws|einwanderungsrecht|migrationsrecht|immigration rules)\b", q))


def _has_specific_immigration_area(text: str) -> bool:
    return bool(re.search(
        r"\b(visa|visum|entry|einreise|residence|aufenthalt|study|studium|student|work|arbeit|job|"
        r"family|familie|asylum|asyl|refugee|citizenship|naturalization|einbuergerung|einbürgerung)\b",
        text,
    ))


def _has_nationality_context(text: str) -> bool:
    return bool(re.search(
        r"\b(nationality|citizenship|citizen|passport|staatsangehoerigkeit|staatsangehörigkeit|pass|"
        r"pakistani|indian|syrian|turkish|ukrainian|german citizen|deutscher|deutsche|eu citizen)\b",
        text,
    ))


def _has_status_context(text: str) -> bool:
    if re.search(r"\bgermany_status:\s*(student|work|family|visitor|permanent|german_or_eu|asylum_protection|temporary_protection)\b", text):
        return True
    return bool(re.search(
        r"\b(student residence|student visa|work permit|blue card|permanent|asylum|refugee|subsidiary|"
        r"temporary protection|family reunification|schengen|visitor|aufenthaltstitel|aufenthaltserlaubnis|"
        r"niederlassung|blaue karte|asyl|fluechtling|flüchtling|familiennachzug|duldung|studentenvisum|arbeitsvisum|besuchsvisum|"
        r"german_or_eu|asylum_protection|temporary_protection)\b",
        text,
    ))


def _has_travel_purpose(text: str) -> bool:
    return bool(re.search(
        r"\b(tourism|tourist|family visit|business|study|studies|masters?|bachelors?|degree|course|"
        r"work|transit|purpose|dauer|zweck|besuch|arbeit|studium|master|bachelor|"
        r"\d+\s*(day|days|week|weeks|month|months|year|years|tag|tage|woche|wochen|monat|monate|jahr|jahre))\b",
        text,
    ))


def _contextual_query(query: str, extra_context: str) -> str:
    if not extra_context:
        return query
    compact = re.sub(r"\s+", " ", extra_context).strip()
    return f"{query} {compact[:700]}"


def _ensure_summary(answer: str, language: str) -> str:
    text = (answer or "").strip()
    if not text:
        return text
    if text.lower().startswith(("summary", "zusammenfassung")):
        return text
    label = "Zusammenfassung" if language == "de" else "Summary"
    return f"{label}\n{text}"


def _format_answer(draft: dict, language: str) -> str:
    summary = str(draft.get("summary") or draft.get("answer") or "").strip()
    checklist = _string_list(draft.get("document_checklist"))
    steps = _string_list(draft.get("steps"))
    booking = draft.get("booking") if isinstance(draft.get("booking"), dict) else {}

    labels = {
        "summary": "Zusammenfassung" if language == "de" else "Summary",
        "checklist": "Dokumenten-Checkliste" if language == "de" else "Document checklist",
        "steps": "Schritte" if language == "de" else "Actionable steps",
        "booking": "Terminbuchung" if language == "de" else "Booking",
    }
    parts = [f"{labels['summary']}\n{summary}"]
    if checklist:
        parts.append(f"{labels['checklist']}\n" + "\n".join(f"- {item}" for item in checklist))
    if steps:
        parts.append(f"{labels['steps']}\n" + "\n".join(f"{i + 1}. {item}" for i, item in enumerate(steps)))

    booking_needed = bool(booking.get("needed") or booking.get("online") or booking.get("link") or booking.get("note"))
    if booking_needed:
        note = str(booking.get("note") or "").strip()
        link = str(booking.get("link") or "").strip()
        if link:
            text = f"{note}\n{link}" if note else link
        else:
            text = note or (
                "Ich habe in den Quellen keinen verifizierten Online-Buchungslink gefunden."
                if language == "de"
                else "I did not find a verified online booking link in the sources."
            )
        parts.append(f"{labels['booking']}\n{text}")
    return "\n\n".join(part for part in parts if part.strip())


def _string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    out = []
    for item in value:
        text = str(item).strip()
        if text:
            out.append(text[:240])
    return out[:8]


def _citations(sources: list[dict], used: list[int]) -> list[dict]:
    chosen = [sources[i - 1] for i in used if isinstance(i, int) and 1 <= i <= len(sources)] or sources[:3]
    out = []
    for s in chosen:
        out.append({
            "id": s.get("id", ""),
            "title": s["title"],
            "source": s["source"],
            "source_type": s.get("source_type", ""),
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
    if sources and _post_study_topic(query):
        return _post_study_answer(language)
    if sources and _student_finance_topic(query):
        return _generic_extractive_answer(query, sources, language)
    if sources and _student_visa_topic(query):
        return _student_visa_answer(language)
    if not sources or not _registration_topic(query):
        return _generic_extractive_answer(query, sources, language)
    text = " ".join((s.get("title", "") + ". " + s.get("text", "")) for s in sources[:3])
    terms = _query_terms(query)
    if len(terms & _text_terms(text)) < 2:
        return ""
    if language == "de":
        return (
            "Zusammenfassung\nFür die Anmeldung meldest du deine Wohnung bei der zuständigen Meldebehörde oder beim Bürgeramt an.\n\n"
            "Dokumenten-Checkliste\n- Pass oder Ausweis\n- Wohnungsgeberbestätigung\n\n"
            "Schritte\n1. Prüfe die zuständige Meldebehörde oder das Bürgeramt deiner Stadt.\n"
            "2. Bereite Pass/Ausweis und Wohnungsgeberbestätigung vor.\n"
            "3. Prüfe die Terminseite deiner Stadt, falls ein Termin erforderlich ist."
        )
    return (
        "Summary\nFor city registration, register your address with the local registration office or Bürgeramt.\n\n"
        "Document checklist\n- Passport or ID\n- Landlord confirmation\n\n"
        "Actionable steps\n1. Check the responsible registration office or Bürgeramt for your city.\n"
        "2. Prepare your passport/ID and landlord confirmation.\n"
        "3. Check your city appointment page if an appointment is required."
    )


def _post_study_answer(language: str) -> str:
    if language == "de":
        return (
            "Zusammenfassung\nNach einem erfolgreichen Studienabschluss in Deutschland kannst du in der Regel "
            "einen Aufenthaltstitel zur Arbeitssuche beantragen. Die offiziellen Quellen nennen dafür bis zu "
            "18 Monate; während dieser Zeit ist Erwerbstätigkeit erlaubt.\n\n"
            "Dokumenten-Checkliste\n- Nachweis über den erfolgreichen Studienabschluss in Deutschland\n"
            "- Gültiger Pass\n- Nachweis über gesicherten Lebensunterhalt\n- Krankenversicherung\n- Aktueller Aufenthaltstitel\n\n"
            "Schritte\n1. Prüfe vor Ablauf deines aktuellen Aufenthaltstitels die Verlängerung bzw. den Wechsel bei der Ausländerbehörde.\n"
            "2. Beantrage den Aufenthaltstitel zur Arbeitsplatzsuche nach dem Studium.\n"
            "3. Suche eine qualifizierte Beschäftigung, die zu deinem Abschluss passt.\n"
            "4. Wenn du einen passenden Job hast, beantrage den Wechsel in den passenden Aufenthaltstitel, z. B. Beschäftigung als Fachkraft oder Blaue Karte EU.\n\n"
            "Terminbuchung\nWenn deine Ausländerbehörde Online-Termine anbietet, nutze deren offizielle Terminseite. "
            "Ich habe keinen einzelnen bayernweiten Buchungslink in den Quellen."
        )
    return (
        "Summary\nAfter successfully completing studies in Germany, you can usually apply for a residence permit "
        "to look for qualified work. The official sources mention up to 18 months for this job-search period, "
        "and employment is permitted during that period.\n\n"
        "Document checklist\n- Proof that you successfully completed your studies in Germany\n"
        "- Valid passport\n- Proof of secure livelihood\n- Health insurance\n- Current residence title\n\n"
        "Actionable steps\n1. Before your current residence title expires, check the extension/change process with the immigration office.\n"
        "2. Apply for the post-study job-search residence permit.\n"
        "3. Look for qualified employment that matches your degree.\n"
        "4. Once you have a suitable job, apply to switch to the correct residence title, such as skilled employment or the EU Blue Card.\n\n"
        "Booking\nIf your immigration office offers online appointments, use its official appointment page. "
        "I did not find one single Bavaria-wide booking link in the sources."
    )


def _student_visa_answer(language: str) -> str:
    if language == "de":
        return (
            "Zusammenfassung\nFür ein Studium in Deutschland brauchst du normalerweise ein nationales Visum, "
            "das du vor der Einreise bei der zuständigen deutschen Auslandsvertretung beantragst. Für das "
            "Visum werden vor allem Zulassung/Studienplatz, gesicherter Lebensunterhalt, Pass und Krankenversicherung geprüft.\n\n"
            "Dokumenten-Checkliste\n- Gültiger Pass\n- Zulassung oder bedingte Zulassung der Hochschule\n"
            "- Nachweis über gesicherten Lebensunterhalt, z. B. Sperrkonto oder anerkannter Finanzierungsnachweis\n"
            "- Krankenversicherungsnachweis\n- Visumantragsformular und Passfotos\n- Bildungsnachweise/Zeugnisse\n\n"
            "Schritte\n1. Sichere zuerst die Zulassung oder bedingte Zulassung für dein Studium.\n"
            "2. Bereite den Finanzierungsnachweis und die Krankenversicherung vor.\n"
            "3. Prüfe die Website der zuständigen deutschen Botschaft oder des Konsulats für dein Aufenthaltsland.\n"
            "4. Buche dort einen Termin und reiche den nationalen Visumantrag mit Unterlagen ein.\n"
            "5. Nach Einreise meldest du dich am Wohnort an und beantragst den Aufenthaltstitel bei der Ausländerbehörde.\n\n"
            "Terminbuchung\nDie Terminbuchung läuft über die zuständige deutsche Auslandsvertretung. Nutze deren offizielle Website."
        )
    return (
        "Summary\nFor studying in Germany, you normally need a national visa before entering Germany, applied for "
        "through the responsible German mission abroad. The key checks are admission to study, secure livelihood, "
        "a valid passport, and health insurance.\n\n"
        "Document checklist\n- Valid passport\n- University admission or conditional admission\n"
        "- Proof of secure livelihood, such as a blocked account or accepted funding proof\n"
        "- Health insurance proof\n- Visa application form and biometric photos\n- Education certificates/transcripts\n\n"
        "Actionable steps\n1. First secure admission or conditional admission for the study program.\n"
        "2. Prepare proof of financing and health insurance.\n"
        "3. Check the website of the responsible German embassy or consulate for your country of residence.\n"
        "4. Book an appointment there and submit the national visa application with the required documents.\n"
        "5. After entering Germany, register your address and apply for the residence permit at the immigration office.\n\n"
        "Booking\nAppointment booking is handled by the responsible German mission abroad. Use that mission's official website."
    )


def _answer_too_thin(answer: str) -> bool:
    clean = re.sub(r"\s+", " ", answer or "").strip()
    words = re.findall(r"\w+", clean)
    if len(words) < 18:
        return True
    if "|" in clean and len(words) < 30:
        return True
    return False


def _should_use_topic_fallback(query: str, answer: str) -> bool:
    if _answer_too_thin(answer):
        return True
    if (_student_visa_topic(query) or _post_study_topic(query)) and not re.search(
        r"(document checklist|dokumenten-checkliste|actionable steps|schritte)", answer, flags=re.I
    ):
        return True
    return False


def _generic_extractive_answer(query: str, sources: list[dict], language: str) -> str:
    if not sources:
        return ""
    terms = _query_terms(query)
    scored: list[tuple[int, str]] = []
    for s in sources[:4]:
        source_text = f"{s.get('title', '')}. {s.get('text', '')}"
        for sentence in _sentences(source_text):
            score = len(terms & _text_terms(sentence))
            if score >= 2:
                scored.append((score, sentence))
    scored.sort(key=lambda item: item[0], reverse=True)
    facts = []
    for _, sentence in scored:
        clean = sentence.strip(" .")
        if clean and clean not in facts:
            facts.append(clean)
        if len(facts) == 3:
            break
    if not facts:
        return ""
    if language == "de":
        return "Zusammenfassung\n" + " ".join(facts)
    return "Summary\n" + " ".join(facts)


def _sentences(text: str) -> list[str]:
    compact = re.sub(r"\s+", " ", text or "").strip()
    parts = re.split(r"(?<=[.!?])\s+", compact)
    return [p[:320] for p in parts if 40 <= len(p) <= 420]


def _not_enough_info(language: str, citations: list[dict], trace: list[str], confidence: float) -> dict:
    if language == "de":
        answer = ("Zusammenfassung\nIch weiß es aus den vorliegenden offiziellen Quellen nicht sicher. "
                  "Bitte gib mehr Details an oder sprich mit einer Beratungsperson.")
    else:
        answer = ("Summary\nI don't know this safely from the available official sources. "
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
    return ("Zusammenfassung\nIch möchte das richtig beantworten und brauche zuerst eine genauere Angabe."
            if language == "de"
            else "Summary\nI want to get this right, so I need one detail first.")


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
