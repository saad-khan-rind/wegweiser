"""Wegweiser agent: goal-based, source-grounded RAG with LangChain context.

Design goals (kept deliberately simple):
  * Goal-first. We answer the user's actual goal using retrieved sources and
    synthesize across them — we do not refuse just because one detail is missing.
  * RAG-first, web-if-weak. Local sources (admin uploads + bundled official
    corpus) are tried first. Only when they are weak do we touch the live web,
    and then we STOP at the first official link that yields usable content.
  * Never contradict ourselves. Citations are attached only to a real grounded
    answer. If we genuinely cannot answer, we say so and show no citations.
  * Context-aware. Previous-turn context is carried into the answer so follow-up
    questions keep their thread.
  * LangChain is used for chunking and document context assembly (guarded, so
    the service still runs if LangChain is not installed).
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

# --- LangChain context layer (optional, but used when present) -------------- #
try:
    from langchain_core.documents import Document  # type: ignore
except Exception:  # pragma: no cover - optional dependency
    Document = None  # type: ignore

try:
    from langchain_text_splitters import RecursiveCharacterTextSplitter  # type: ignore
    _SPLITTER = RecursiveCharacterTextSplitter(
        chunk_size=900, chunk_overlap=150, separators=["\n\n", "\n", ". ", " ", ""]
    )
except Exception:  # pragma: no cover - optional dependency
    RecursiveCharacterTextSplitter = None  # type: ignore
    _SPLITTER = None

log = logging.getLogger("agent")

MAX_ITERS = int(os.getenv("AGENT_MAX_ITERS", "1"))
USE_WEB = os.getenv("AGENT_USE_WEB", "1") == "1"
USE_BUNDLED_CORPUS = os.getenv("AGENT_USE_BUNDLED_CORPUS", "1") == "1"

# Acceptance / strength thresholds. Generous on purpose so good sources are not
# thrown away (the old code dropped relevant docs and then said "I don't know").
ACCEPT_LEXICAL = 2          # >= this many shared meaningful terms => relevant
ACCEPT_SEMANTIC = 0.55      # OR a strong vector score (semantic match)
STRONG_LEXICAL = 4          # local RAG is "strong enough" => skip the web
STRONG_SEMANTIC = 0.70

_corpus = Retriever()


def langchain_available() -> bool:
    return Document is not None


# --------------------------------------------------------------------------- #
# Public entry points
# --------------------------------------------------------------------------- #
def run(query: str, tags: list[str], region: str = "", language: str = "en",
        extra_context: str = "", clarifying_answers: dict | None = None) -> dict:
    answer_language = _detect_language(query, language)
    answer_context = _answers_context(clarifying_answers or {})
    if answer_context:
        extra_context = f"{extra_context}\n{answer_context}".strip()

    trace: list[str] = []
    llm_info = llm.available()
    is_followup = bool(extra_context.strip())

    if not _in_scope(query, is_followup):
        trace.append("Stopped before retrieval: question is outside Wegweiser scope")
        return _with_runtime(_out_of_scope(answer_language, trace), [], llm_info)

    # Ask for strictly-required user facts up front (goal-based clarification).
    missing = _required_clarifications(query, answer_language, extra_context)
    if missing:
        trace.append("Asked for missing user-specific facts before answering")
        return _with_runtime(_clarification_payload(answer_language, missing, trace), [], llm_info)

    # The goal carries the conversation so follow-ups keep their thread; the
    # retrieval query stays dominated by the *current* question.
    goal = query if not extra_context else (
        f"{query}\n\nConversation so far (use only what is relevant to the current question):\n{extra_context[:1400]}"
    )
    retrieval_query = _retrieval_query(query, extra_context)

    sources, considered = gather_sources_with_audit(
        retrieval_query, tags, region=region, language=answer_language
    )
    resources = _resources(considered)
    trace.append("Searched local RAG (admin uploads + official corpus) with EN/DE query variants")
    if is_followup:
        trace.append("Carried previous conversation context into this follow-up")
    if langchain_available():
        trace.append("Assembled grounded context with LangChain documents")
    trace.append(f"Considered {len(considered)} sources; kept {len(sources)} relevant")

    # Vague one-liners with nothing to ground on -> ask one focusing question.
    if _looks_vague(query) and not is_followup and len(sources) < 2 and not _registration_topic(query):
        return _with_runtime(_clarify_first(answer_language, trace), resources, llm_info)

    if not sources:
        trace.append("No relevant sources found in RAG or official web")
        return _with_runtime(_could_not_find(answer_language, trace, confidence=0.25), resources, llm_info)

    llm_ready = bool(llm_info.get("reachable") and llm_info.get("chat_model_present"))
    if not llm_ready:
        trace.append("LLM unavailable; using source-grounded extractive answer")
        return _with_runtime(_grounded_fallback(query, sources, trace, answer_language), resources, llm_info)

    # ---- Compose a grounded answer ----------------------------------------- #
    draft = _compose(goal, tags, sources, answer_language)
    answer, confidence, used, answerable, clarifying = _read_draft(draft, answer_language)

    # The model hedged ("I don't know") even though we DO have relevant sources:
    # retry once with a stricter instruction, then synthesize from the sources.
    if (not answerable or _looks_like_refusal(answer)) and sources:
        trace.append("Draft hedged despite relevant sources; retrying with stricter grounding")
        draft2 = _compose(goal, tags, sources, answer_language, strict=True)
        a2, c2, u2, ok2, q2 = _read_draft(draft2, answer_language)
        if ok2 and not _looks_like_refusal(a2):
            answer, confidence, used, answerable, clarifying = a2, c2, u2, ok2, q2
        else:
            extractive = _extractive_answer(query, sources, answer_language)
            if extractive:
                trace.append("Used source-grounded extractive synthesis")
                return _with_runtime({
                    "answer": extractive,
                    "citations": _citations(sources, used),
                    "confidence": 0.62,
                    "escalate": _should_escalate(query, 0.62),
                    "trace": trace,
                    "needs_input": False,
                }, resources, llm_info)

    if not answer or _looks_like_refusal(answer):
        # Genuinely could not answer from the sources -> no citations, no contradiction.
        trace.append("Sources did not support an answer to this question")
        return _with_runtime(_could_not_find(answer_language, trace, confidence=0.3), resources, llm_info)

    trace.append("Drafted a grounded answer with citations")

    # A user-specific fact is strictly required -> ask instead of assuming.
    if clarifying and confidence < 0.6:
        return _with_runtime({
            "answer": _one_detail(answer_language),
            "clarifying_question": clarifying,
            "citations": _citations(sources, used),
            "confidence": min(confidence, 0.5),
            "escalate": False,
            "trace": trace,
            "needs_input": True,
        }, resources, llm_info)

    # ---- Light self-check (best-effort; never produces "I don't know") ----- #
    answer, confidence, used = _self_check(
        goal, answer, confidence, used, sources, tags, region, answer_language, trace
    )

    if web.is_blocked_text(answer):
        trace.append("Rejected answer text that contained blocked/captcha content")
        return _with_runtime(_grounded_fallback(query, sources, trace, answer_language), resources, llm_info)

    return _with_runtime({
        "answer": _ensure_summary(answer, answer_language),
        "citations": _citations(sources, used),
        "confidence": round(max(0.0, min(1.0, confidence)), 2),
        "escalate": _should_escalate(query, confidence),
        "trace": trace,
        "needs_input": False,
    }, resources, llm_info)


def run_guided_flow(answers: dict | None, path: list[dict] | None, region: str = "",
                    language: str = "en") -> dict:
    clean_answers = _clean_guided_answers(answers or {})
    clean_path = _clean_guided_path(path or [])
    prompt = _guided_prompt(clean_answers, clean_path, language)
    context = _guided_context(clean_answers, clean_path, language)
    tags = _guided_tags(clean_answers)
    clarifying = {key: _guided_value(value) for key, value in clean_answers.items() if _guided_value(value)}
    result = run(prompt, tags, region, language, context, clarifying)
    result["guided_context"] = {"answers": clean_answers, "path": clean_path, "prompt": prompt}
    return result


def run_guided_options(node_id: str, answers: dict | None, path: list[dict] | None,
                       region: str = "", language: str = "en") -> dict:
    clean_answers = _clean_guided_answers(answers or {})
    clean_path = _clean_guided_path(path or [])
    clean_node = re.sub(r"[^a-zA-Z0-9_-]+", "", str(node_id))[:80]
    query = _guided_options_query(clean_node, clean_answers, clean_path, language)
    tags = _guided_tags(clean_answers)
    trace = [f"Building options for node: {clean_node}"]
    llm_info = llm.available()

    # Bubble options use RAG only; live web is reserved for the final answer.
    sources, considered = gather_sources_with_audit(
        query, tags, k=6, region=region, language=language,
        allow_web=False, allow_llm_translation=False,
    )
    trace.append(f"Considered {len(considered)} resources; kept {len(sources)} relevant sources")

    options: list[dict] = []
    llm_ready = bool(llm_info.get("reachable") and llm_info.get("chat_model_present"))
    if llm_ready and sources:
        data = llm.chat_json(
            _guided_options_system(language),
            _guided_options_user(clean_node, clean_answers, clean_path, sources, language),
            temperature=0.05,
        )
        if isinstance(data, dict) and isinstance(data.get("options"), list):
            options = data["options"]
            trace.append("Generated options from retrieved sources with the LLM")

    # ALWAYS merge in deterministic, logical options so the bubble never dead-ends.
    logical = _logical_node_options(clean_node, clean_answers, sources, language)
    options = _merge_options(options, logical)
    if not options:
        # Last-resort generic navigation so the flow can always proceed.
        options = _fallback_node_options(clean_node, language)
        trace.append("Used generic navigation options as a final safety net")
    else:
        trace.append(f"Returning {len(options)} logical options (LLM + RAG + structured)")

    safe = _sanitize_guided_options(options, language, clean_node)
    return _with_runtime({
        "nodeId": clean_node,
        "options": safe,
        "sources": _citations(sources, []),
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "trace": trace,
    }, _resources(considered), llm_info)


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
    variants = _query_variants(query, language, allow_llm_translation)
    web_enabled = (USE_WEB if allow_web is None else allow_web)

    # 1) admin-uploaded documents (vector store)
    for qv in variants:
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
                "score": _as_float(m.get("score", 0), 0.0),
                "matched_query": qv["label"],
            })

    # 2) crawled official / Integreat corpus
    if USE_BUNDLED_CORPUS:
        for qv in variants:
            for d in _corpus.retrieve(qv["query"], tags, k=max(k, 5)):
                candidates.append({
                    "id": d.get("id", ""),
                    "title": d["title"], "text": d["text"], "source": d["origin"],
                    "url": d.get("url", ""), "date": d.get("updatedAt", ""),
                    "origin": d.get("origin", "crawler"), "score": _as_float(d.get("score", 0), 0.0),
                    "matched_query": qv["label"],
                })

    local = _rank_sources(query, _dedupe(candidates))
    local_accepted = [s for s in local if s.get("accepted")]

    # 3) Live web ONLY when local RAG is weak. Stop at the first good official link.
    if web_enabled and not _strong_enough(local_accepted):
        web_items = web.best_official_context(query, "de" if language == "de" else "en", max_results=3)
        for r in web_items:
            candidates.append({
                "id": r.get("id", ""),
                "title": r.get("title", "Official source"),
                "text": r.get("text") or r.get("snippet", ""),
                "source": r.get("source", "official-web"),
                "source_type": "",
                "url": r.get("url", ""),
                "date": "latest",
                "origin": "web",
                "score": 0.66,
                "matched_query": "web",
            })

    considered = _rank_sources(query, _dedupe(candidates))
    accepted = [s for s in considered if s.get("accepted")]
    return accepted[: max(k * 2, 6)], considered[: max(k * 4, 12)]


def _strong_enough(accepted: list[dict]) -> bool:
    """Local RAG is strong enough to answer without touching the web."""
    if len(accepted) >= 2:
        return True
    if accepted:
        top = accepted[0]
        if top.get("relevance", 0) >= STRONG_LEXICAL or top.get("score", 0) >= STRONG_SEMANTIC:
            return True
    return False


# --------------------------------------------------------------------------- #
# Query expansion
# --------------------------------------------------------------------------- #
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
    {"skilled worker", "blue card", "blaue karte", "fachkraft", "qualified employment", "opportunity card", "chancenkarte"},
    {"registration", "register", "address", "anmeldung", "anmelden", "melde", "meldebehoerde", "meldebehorde", "buergeramt", "bürgeramt"},
    {"appointment", "booking", "book", "termin", "terminbuchung", "online appointment", "online-termin"},
    {"documents", "document", "paperwork", "checklist", "unterlagen", "dokumente", "nachweise", "checkliste"},
    {"health insurance", "insurance", "krankenversicherung", "versicherung", "gesetzliche", "private"},
    {"benefit", "child benefit", "kindergeld", "elterngeld", "buergergeld", "bürgergeld", "leistung", "leistungen", "jobcenter"},
    {"language course", "integration course", "deutschkurs", "sprachkurs", "integrationskurs", "orientation course"},
    {"family", "familie", "reunification", "familiennachzug", "spouse", "ehegatten", "wife", "husband", "partner", "child", "kinder", "marriage", "heirat"},
    {"asylum", "asyl", "refugee", "fluechtling", "flüchtling", "protection", "schutz", "subsidiary", "subsidiaer"},
    {"citizenship", "naturalization", "naturalisation", "einbuergerung", "einbürgerung", "staatsangehoerigkeit", "german passport"},
    {"bank account", "basiskonto", "girokonto", "konto"},
    {"tenancy", "rent", "miete", "mietvertrag", "mietrecht", "landlord", "vermieter", "wohnung", "kuendigung", "kündigung"},
    {"driving licence", "driving license", "fuehrerschein", "führerschein", "umschreibung"},
    {"tax", "steuer", "steuer-id", "steueridentifikationsnummer", "finanzamt", "lohnsteuer"},
]

# Broad in-scope signal: immigration + general German law / administration / civic.
IN_SCOPE_RE = re.compile(
    r"\b("
    r"visa|visum|residence|permit|aufenthalt|aufenthaltstitel|asyl|asylum|refugee|flucht|schutz|"
    r"naturaliz|naturalis|citizenship|einbuerger|einbürger|passport|blue card|blaue karte|"
    r"registration|register|anmeld|melde|buergeramt|bürgeramt|auslaender|ausländer|"
    r"jobcenter|arbeitsagentur|work permit|arbeitserlaub|labour|labor market|arbeitsmarkt|"
    r"study|studies|student|graduation|studium|university|hochschule|school|schule|"
    r"language course|sprachkurs|integration|integrationskurs|"
    r"blocked account|proof of funds|sperrkonto|finanzierungsnachweis|lebensunterhalt|"
    r"health insurance|krankenversicherung|kindergeld|elterngeld|buergergeld|bürgergeld|benefit|sozialleistung|"
    r"family|familie|reunific|familiennachzug|spouse|ehegatt|marriage|heirat|"
    r"bank account|basiskonto|girokonto|"
    r"tenan|rent|miete|mietrecht|mietvertrag|landlord|vermieter|wohnung|"
    r"driving licence|driving license|fuehrerschein|führerschein|"
    r"tax|steuer|finanzamt|"
    r"law|policy|legal|recht|gesetz|verordnung|pflicht|rights|behoerde|behörde|amt|"
    r"germany|german|deutschland|deutsch|bavaria|bayern|munich|münchen|augsburg"
    r")\b",
    re.I,
)

# Obvious non-civic requests we should politely decline.
OUT_OF_SCOPE_RE = re.compile(
    r"\b(write (me )?(a )?(poem|song|story|essay|joke)|recipe|cook|bake|"
    r"weather|football score|sports score|stock price|bitcoin|crypto price|"
    r"write (me )?code|debug|python script|javascript|html|sql query|"
    r"horoscope|lottery|dating|girlfriend|boyfriend)\b",
    re.I,
)


def _in_scope(query: str, is_followup: bool = False) -> bool:
    q = _normalize(query)
    if is_followup:
        return True  # follow-ups inherit the scope of the thread
    if OUT_OF_SCOPE_RE.search(q):
        return False
    if IN_SCOPE_RE.search(q):
        return True
    # Permissive default: if it reads like a question, try to ground it; if no
    # source supports it, we return a graceful "couldn't find" rather than guess.
    return bool(re.search(r"\b(how|what|where|when|who|which|can i|do i|wie|was|wo|wann|welche|kann ich|darf ich|muss ich)\b", q))


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
        qv = re.sub(r"\s+", " ", item["query"]).strip()
        if qv and qv.lower() not in seen:
            seen.add(qv.lower())
            out.append({**item, "query": qv})
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
        normalized = {_normalize(t) for t in cluster}
        if any(t in norm for t in normalized):
            additions.extend(sorted(cluster))
    if not additions:
        return ""
    additions.extend(["Deutschland", "Bayern"] if target_lang == "de" else ["Germany", "Bavaria"])
    return f"{query} {' '.join(additions)}"


def _expanded_query(query: str) -> str:
    norm = _normalize(query)
    additions: list[str] = []
    for cluster in QUERY_CLUSTERS:
        normalized = {_normalize(t) for t in cluster}
        if any(t in norm for t in normalized):
            additions.extend(sorted(cluster))
    return f"{query} {' '.join(additions)}" if additions else query


def _retrieval_query(query: str, extra_context: str) -> str:
    """Keep the CURRENT question dominant, but always fold in the original goal
    (and the most recent follow-up) so follow-ups retrieve on the right topic."""
    if not extra_context:
        return query
    hints: list[str] = []
    goal = re.search(r"original goal\s*[:.]?\s*(.+)", extra_context, flags=re.I)
    if goal:
        hints.append(re.sub(r"\s+", " ", goal.group(1)).strip()[:160])
    followups = re.findall(r"^\s*\d+\.\s*(.+)$", extra_context, flags=re.M)
    if followups:
        hints.append(re.sub(r"\s+", " ", followups[-1]).strip()[:160])
    extra = " ".join(h for h in hints if h and _normalize(h) not in _normalize(query))
    return f"{query} {extra}".strip()


# --------------------------------------------------------------------------- #
# Ranking
# --------------------------------------------------------------------------- #
def _rank_sources(query: str, sources: list[dict]) -> list[dict]:
    out = []
    for s in sources:
        lexical = _relevance_score(query, s)
        semantic = _as_float(s.get("score", 0), 0.0)
        item = dict(s)
        item["relevance"] = lexical
        item["accepted"] = (lexical >= ACCEPT_LEXICAL) or (semantic >= ACCEPT_SEMANTIC)
        out.append(item)
    out.sort(key=lambda s: (1 if s.get("accepted") else 0, s.get("relevance", 0), s.get("score", 0)), reverse=True)
    return out


def _relevance_score(query: str, source: dict) -> int:
    q_terms = _query_terms(query)
    title_terms = _text_terms(source.get("title", ""))
    body_terms = _text_terms(source.get("text", "")[:2500])
    score = len(q_terms & body_terms) + (2 * len(q_terms & title_terms))
    if _registration_topic(query) and ({"anmeldung", "register", "registration", "wohnsitz", "melde"} & (title_terms | body_terms)):
        score += 2
    return score


STOP = {
    "the", "a", "an", "to", "of", "in", "on", "for", "and", "or", "is", "are",
    "i", "my", "me", "do", "how", "what", "can", "where", "when", "with", "you",
    "your", "it", "as", "be", "at", "this", "that", "steps", "step", "city",
    "germany", "german", "bavaria", "official", "rule", "rules", "after", "over",
    "information", "info", "help", "need", "needs", "whole", "all", "any", "some",
    "bayern", "deutschland", "offizielle", "informationen", "hilfe",
    "welche", "schritte", "sind", "fuer", "für", "die", "der", "das", "und",
    "oder", "ich", "du", "sie", "wie", "wo", "was",
}


def _text_terms(text: str) -> set[str]:
    norm = _normalize(text)
    return {w for w in re.findall(r"\w+", norm, flags=re.UNICODE) if len(w) > 2 and w not in STOP}


def _query_terms(query: str) -> set[str]:
    terms = _text_terms(query)
    norm = _normalize(query)
    for cluster in QUERY_CLUSTERS:
        normalized = {_normalize(t) for t in cluster}
        if terms & normalized or any(t in norm for t in normalized):
            terms |= normalized
    if _registration_topic(query):
        terms |= {"registration", "register", "address", "anmeldung", "anmelden", "melde",
                  "meldebehoerde", "buergeramt", "wohnung", "wohnsitz", "wohnungsgeber"}
    return terms


def _registration_topic(query: str) -> bool:
    q = _normalize(query)
    return bool(re.search(r"\b(registration|register|address|anmeldung|anmelden|melde|wohnsitz|buergeramt)\b", q))


def _normalize(text: str) -> str:
    return (text or "").lower().replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")


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
    return web.is_blocked_text(f"{source.get('title', '')} {source.get('text', '')[:1200]}")


# --------------------------------------------------------------------------- #
# LangChain context assembly
# --------------------------------------------------------------------------- #
def _langchain_documents(sources: list[dict]):
    if Document is None:
        return []
    docs = []
    for s in sources:
        text = re.sub(r"\s+", " ", str(s.get("text", ""))).strip()
        if not text:
            continue
        docs.append(Document(page_content=text, metadata={
            "title": s.get("title", ""), "source": s.get("source", ""),
            "url": s.get("url", ""), "date": s.get("date", ""),
        }))
    return docs


def _source_block(sources: list[dict]) -> str:
    """Build the numbered, chunked context block the model grounds on.

    Uses LangChain Documents + a recursive splitter when available so long
    official pages are trimmed to their most relevant portion instead of being
    truncated mid-sentence.
    """
    docs = _langchain_documents(sources)
    lines = []
    for i, s in enumerate(sources, 1):
        text = re.sub(r"\s+", " ", str(s.get("text", ""))).strip()
        if _SPLITTER is not None and len(text) > 1100:
            chunks = _SPLITTER.split_text(text)
            text = chunks[0] if chunks else text
        meta = f"{s.get('source', '')}" + (f", {s.get('date')}" if s.get("date") else "")
        lines.append(f"[{i}] {s.get('title', f'Source {i}')} ({meta})\n{text[:1200]}")
    return "\n\n".join(lines) if lines else "(no sources found)"


# --------------------------------------------------------------------------- #
# LLM compose + light self-check
# --------------------------------------------------------------------------- #
def _compose_system(language: str, strict: bool = False) -> str:
    answer_language = "German" if language == "de" else "English"
    base = (
        "You are Wegweiser, a migration and German-law guidance assistant for newcomers in Germany. "
        "Answer the user's GOAL using the provided sources, and synthesize across them. "
        "Cite sources inline as [1], [2]. "
        f"Write the answer in {answer_language}, in clear, plain language. "
        "The answer MUST begin with a short summary of your understanding. "
        "If the sources list required documents, put them in document_checklist. "
        "If the sources imply an order of actions, put them in steps. "
        "If a task needs booking and the sources show it can be done online, set booking.online=true and include the official link. "
        "Be genuinely helpful: answer what the sources DO support. Do NOT refuse just because a single detail "
        "(an exact fee, a specific office, a date) is missing — answer the rest and note what to verify officially. "
        "Set answerable=false ONLY if the sources do not address the question at all. "
        "If answering correctly REQUIRES a user-specific fact that is missing, put one short question in clarifying_question. "
        "Never invent offices, dates, amounts, links, phone numbers, eligibility, or laws not in the sources. "
        "Respond as strict JSON: "
        '{"summary": string, "document_checklist": string[], "steps": string[], '
        '"booking": {"needed": boolean, "online": boolean, "link": string, "note": string}, '
        '"used": number[], "confidence": number, "answerable": boolean, "clarifying_question": string}.'
    )
    if strict:
        base += (
            " IMPORTANT: The sources below DO contain information relevant to this question. "
            "Extract and present the relevant facts. Do not say you don't know."
        )
    return base


def _compose(goal: str, tags: list[str], sources: list[dict], language: str, strict: bool = False) -> dict | None:
    user = (
        f"User goal: {goal}\n"
        f"Answer language: {language}\n"
        f"Known context tags: {', '.join(tags) or 'none'}\n\n"
        f"Sources:\n{_source_block(sources)}"
    )
    return llm.chat_json(_compose_system(language, strict), user, temperature=0.1)


def _read_draft(draft: dict | None, language: str) -> tuple[str, float, list[int], bool, str]:
    if not isinstance(draft, dict):
        return "", 0.5, [], False, ""
    answerable = bool(draft.get("answerable", True))
    confidence = _as_float(draft.get("confidence"), 0.6)
    used = [i for i in draft.get("used", []) if isinstance(i, int)]
    clarifying = str(draft.get("clarifying_question") or "").strip()
    answer = _format_answer(draft, language)
    return answer, confidence, used, answerable, clarifying


_SELF_CHECK_SYS = (
    "You review a draft answer against its sources. You may ONLY do two things: "
    "(1) if answering correctly strictly REQUIRES a user-specific fact that is missing, return verdict "
    "'needs_user_input' with one short 'missing_question'; (2) if the sources are thin and a better search "
    "could help, return 'needs_more_context' with a 'refined_query'. Otherwise return 'ok'. "
    "Never claim the answer is wrong when the sources support it. "
    "Respond as strict JSON: {\"verdict\":\"ok|needs_user_input|needs_more_context\","
    "\"missing_question\":string,\"refined_query\":string,\"confidence\":number}."
)


def _self_check(goal: str, answer: str, confidence: float, used: list[int], sources: list[dict],
                tags: list[str], region: str, language: str, trace: list[str]):
    """Best-effort enrichment. Can refine context once but never downgrades a
    grounded answer to a refusal."""
    if MAX_ITERS < 1:
        return answer, confidence, used
    verdict = llm.chat_json(
        _SELF_CHECK_SYS,
        f"User goal: {goal}\n\nDraft answer:\n{answer}\n\nAnswer language: {language}\nSources:\n{_source_block(sources)}",
        temperature=0.0,
    )
    if not isinstance(verdict, dict):
        return answer, confidence, used
    v = verdict.get("verdict", "ok")
    confidence = _as_float(verdict.get("confidence"), confidence)
    trace.append(f"Self-check: {v}")
    if v == "needs_more_context" and verdict.get("refined_query"):
        more = gather_sources(str(verdict["refined_query"]), tags, region=region, language=language)
        merged = _dedupe(sources + more)
        if len(merged) > len(sources):
            draft = _compose(goal, tags, merged, language)
            a2, c2, u2, ok2, _ = _read_draft(draft, language)
            if ok2 and a2 and not _looks_like_refusal(a2):
                trace.append(f"Improved context with: '{verdict['refined_query']}'")
                return a2, c2, u2
    return answer, confidence, used


# --------------------------------------------------------------------------- #
# Answer formatting + citations
# --------------------------------------------------------------------------- #
def _format_answer(draft: dict, language: str) -> str:
    summary = str(draft.get("summary") or draft.get("answer") or "").strip()
    if not summary:
        return ""
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
        parts.append(f"{labels['checklist']}\n" + "\n".join(f"- {i}" for i in checklist))
    if steps:
        parts.append(f"{labels['steps']}\n" + "\n".join(f"{n + 1}. {s}" for n, s in enumerate(steps)))

    if any(booking.get(key) for key in ("needed", "online", "link", "note")):
        note = str(booking.get("note") or "").strip()
        link = str(booking.get("link") or "").strip()
        text = (f"{note}\n{link}" if note and link else (link or note)) or (
            "Ich habe in den Quellen keinen verifizierten Online-Buchungslink gefunden."
            if language == "de" else "I did not find a verified online booking link in the sources."
        )
        parts.append(f"{labels['booking']}\n{text}")
    return "\n\n".join(p for p in parts if p.strip())


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
    out, seen = [], set()
    for s in chosen:
        key = (s.get("title", ""), s.get("url", ""))
        if key in seen:
            continue
        seen.add(key)
        out.append({
            "id": s.get("id", ""), "title": s.get("title", ""), "source": s.get("source", ""),
            "source_type": s.get("source_type", ""), "origin": s.get("origin", ""),
            "url": s.get("url", ""), "date": s.get("date", ""), "relevance": s.get("relevance", 0),
        })
    return out


def _resources(sources: list[dict]) -> list[dict]:
    return [{
        "id": s.get("id", ""), "title": s.get("title", ""), "source": s.get("source", ""),
        "source_type": s.get("source_type", ""), "origin": s.get("origin", ""),
        "url": s.get("url", ""), "date": s.get("date", ""), "score": s.get("score", 0),
        "relevance": s.get("relevance", 0), "accepted": bool(s.get("accepted")),
        "matched_query": s.get("matched_query", ""), "excerpt": (s.get("text", "") or "")[:260],
    } for s in sources]


def _with_runtime(payload: dict, resources: list[dict], llm_info: dict) -> dict:
    payload["resources_considered"] = resources
    payload["provider"] = llm_info.get("provider", "unknown")
    payload["model"] = llm_info.get("chat_model", "")
    return payload


# --------------------------------------------------------------------------- #
# Fallbacks + canned responses
# --------------------------------------------------------------------------- #
def _looks_like_refusal(text: str) -> bool:
    t = _normalize(text)
    return bool(re.search(
        r"(i (do not|don'?t) know|i can'?t (help|answer)|not (in|covered by) the (official )?sources|"
        r"no (relevant )?(official )?sources|couldn'?t find|could not find|"
        r"weiss es nicht|weiß es nicht|kann ich nicht beantworten|nicht in den (offiziellen )?quellen|"
        r"keine (relevanten )?(offiziellen )?quellen)\b", t))


def _grounded_fallback(query: str, sources: list[dict], trace: list[str], language: str) -> dict:
    answer = _extractive_answer(query, sources, language)
    if answer:
        trace.append("Used source-grounded extractive fallback")
        return {"answer": answer, "citations": _citations(sources, []), "confidence": 0.62,
                "escalate": _should_escalate(query, 0.62), "trace": trace, "needs_input": False}
    return _could_not_find(language, trace, confidence=0.3)


def _extractive_answer(query: str, sources: list[dict], language: str) -> str:
    # Curated high-quality answers for the most common journeys (used only when
    # the LLM is unavailable or hedged). These never fabricate office-specific data.
    if sources and _post_study_topic(query):
        return _post_study_answer(language)
    if sources and _student_visa_topic(query):
        return _student_visa_answer(language)
    if sources and _registration_topic(query):
        reg = _registration_answer(query, sources, language)
        if reg:
            return reg
    return _generic_extractive_answer(query, sources, language)


def _generic_extractive_answer(query: str, sources: list[dict], language: str) -> str:
    if not sources:
        return ""
    terms = _query_terms(query)
    scored: list[tuple[int, str]] = []
    for s in sources[:4]:
        for sentence in _sentences(f"{s.get('title', '')}. {s.get('text', '')}"):
            score = len(terms & _text_terms(sentence))
            if score >= 2:
                scored.append((score, sentence))
    scored.sort(key=lambda x: x[0], reverse=True)
    facts: list[str] = []
    for _, sentence in scored:
        clean = sentence.strip(" .")
        if clean and clean not in facts:
            facts.append(clean)
        if len(facts) == 3:
            break
    if not facts:
        # We have relevant (accepted) sources but no high-overlap sentence — surface
        # the lead of the best source rather than falsely claiming we don't know.
        lead = _sentences(f"{sources[0].get('title', '')}. {sources[0].get('text', '')}")
        if lead:
            facts = lead[:2]
    if not facts:
        return ""
    head = "Zusammenfassung" if language == "de" else "Summary"
    return f"{head}\n" + ". ".join(facts) + "."


def _registration_answer(query: str, sources: list[dict], language: str) -> str:
    text = " ".join((s.get("title", "") + ". " + s.get("text", "")) for s in sources[:3])
    if len(_query_terms(query) & _text_terms(text)) < 2:
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
            "Dokumenten-Checkliste\n- Nachweis über den erfolgreichen Studienabschluss\n- Gültiger Pass\n"
            "- Nachweis über gesicherten Lebensunterhalt\n- Krankenversicherung\n- Aktueller Aufenthaltstitel\n\n"
            "Schritte\n1. Prüfe vor Ablauf deines Aufenthaltstitels die Verlängerung bei der Ausländerbehörde.\n"
            "2. Beantrage den Aufenthaltstitel zur Arbeitsplatzsuche nach dem Studium.\n"
            "3. Suche eine qualifizierte Beschäftigung, die zu deinem Abschluss passt.\n"
            "4. Wechsle danach in den passenden Aufenthaltstitel, z. B. Fachkraft oder Blaue Karte EU."
        )
    return (
        "Summary\nAfter successfully completing studies in Germany, you can usually apply for a residence permit "
        "to look for qualified work. Official sources mention up to 18 months for this job search, and employment "
        "is permitted during that period.\n\n"
        "Document checklist\n- Proof you completed your studies\n- Valid passport\n- Proof of secure livelihood\n"
        "- Health insurance\n- Current residence title\n\n"
        "Actionable steps\n1. Before your residence title expires, check the extension with the immigration office.\n"
        "2. Apply for the post-study job-search residence permit.\n"
        "3. Look for qualified employment matching your degree.\n"
        "4. Switch to the right residence title, such as skilled employment or the EU Blue Card."
    )


def _student_visa_answer(language: str) -> str:
    if language == "de":
        return (
            "Zusammenfassung\nFür ein Studium in Deutschland brauchst du normalerweise ein nationales Visum, "
            "das du vor der Einreise bei der zuständigen deutschen Auslandsvertretung beantragst. Geprüft werden "
            "vor allem Zulassung, gesicherter Lebensunterhalt, Pass und Krankenversicherung.\n\n"
            "Dokumenten-Checkliste\n- Gültiger Pass\n- Zulassung oder bedingte Zulassung\n"
            "- Finanzierungsnachweis (z. B. Sperrkonto)\n- Krankenversicherung\n- Visumantrag und Passfotos\n\n"
            "Schritte\n1. Sichere zuerst die Zulassung.\n2. Bereite Finanzierungsnachweis und Krankenversicherung vor.\n"
            "3. Prüfe die Website der zuständigen Botschaft/Konsulats.\n4. Buche dort einen Termin und reiche den Antrag ein.\n"
            "5. Melde dich nach der Einreise an und beantrage den Aufenthaltstitel bei der Ausländerbehörde."
        )
    return (
        "Summary\nTo study in Germany you normally need a national visa before entering, applied for through the "
        "responsible German mission abroad. The key checks are admission, secure livelihood, a valid passport, and "
        "health insurance.\n\n"
        "Document checklist\n- Valid passport\n- University admission or conditional admission\n"
        "- Proof of financing (e.g. a blocked account)\n- Health insurance\n- Visa application form and photos\n\n"
        "Actionable steps\n1. First secure admission.\n2. Prepare proof of financing and health insurance.\n"
        "3. Check the responsible German embassy/consulate website.\n4. Book an appointment and submit the application.\n"
        "5. After arriving, register your address and apply for the residence permit at the immigration office."
    )


def _could_not_find(language: str, trace: list[str], confidence: float) -> dict:
    if language == "de":
        answer = ("Zusammenfassung\nDazu finde ich in den vorliegenden offiziellen Quellen keine sichere Antwort. "
                  "Bitte gib mehr Details an oder sprich mit einer Beratungsperson.")
    else:
        answer = ("Summary\nI couldn't find a confident answer to this in the available official sources. "
                  "Please add more detail or speak with a counselor.")
    # No citations here, so the answer never contradicts a shown source.
    return {"answer": answer, "citations": [], "confidence": confidence,
            "escalate": True, "trace": trace, "needs_input": False}


def _out_of_scope(language: str, trace: list[str]) -> dict:
    answer = (
        "Zusammenfassung\nIch kann nur bei Fragen zu Migration, Aufenthalt, Integration, deutscher Verwaltung "
        "oder deutschen Rechts-/Politikthemen helfen."
        if language == "de"
        else "Summary\nI can only help with immigration, residence, integration, German administration, or "
             "German law/policy questions."
    )
    return {"answer": answer, "citations": [], "confidence": 0.9, "escalate": False,
            "trace": trace, "needs_input": False}


def _clarify_first(language: str, trace: list[str]) -> dict:
    question = ("Welche konkrete Hilfe brauchst du: Anmeldung, Aufenthalt, Arbeit, Krankenversicherung oder etwas anderes?"
                if language == "de"
                else "What specific help do you need: registration, residence, work, health insurance, or something else?")
    return {"answer": _one_detail(language), "clarifying_question": question, "citations": [],
            "confidence": 0.35, "escalate": False,
            "trace": trace + ["Asked a focusing question before answering"], "needs_input": True}


def _one_detail(language: str) -> str:
    return ("Zusammenfassung\nIch möchte das richtig beantworten und brauche zuerst eine genauere Angabe."
            if language == "de"
            else "Summary\nI want to get this right, so I need one detail first.")


def _ensure_summary(answer: str, language: str) -> str:
    text = (answer or "").strip()
    if not text or text.lower().startswith(("summary", "zusammenfassung")):
        return text
    label = "Zusammenfassung" if language == "de" else "Summary"
    return f"{label}\n{text}"


# --------------------------------------------------------------------------- #
# Goal-based clarifications (asked up front, deterministically)
# --------------------------------------------------------------------------- #
def _required_clarifications(query: str, language: str, extra_context: str) -> list[dict]:
    q = _normalize(f"{query}\n{extra_context}")
    questions: list[dict] = []

    if _broad_immigration_topic(query) and not _has_specific_immigration_area(q):
        return [_question(
            "immigration_area",
            "Zu welchem Bereich brauchst du Hilfe?" if language == "de" else "Which immigration topic do you need help with?",
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
                    ("eu", "EU/EWR-Pass" if language == "de" else "EU/EEA passport"),
                    ("german", "Deutscher Pass" if language == "de" else "German passport"),
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
        return questions[:3]

    if _work_permission_topic(query) and not _has_status_context(q):
        questions.append(_question(
            "germany_status",
            "Welchen Aufenthaltsstatus hast du aktuell in Deutschland?" if language == "de"
            else "What is your current residence status in Germany?",
            _residence_status_options(language),
        ))
        return questions
    return []


def _question(qid: str, question: str, options: list[tuple[str, str]], free_text: bool = False) -> dict:
    return {
        "id": qid, "question": question, "required": True,
        "type": "single_choice_with_text" if free_text else "single_choice",
        "options": [{"value": v, "label": l} for v, l in options],
    }


def _residence_status_options(language: str) -> list[tuple[str, str]]:
    if language == "de":
        return [
            ("german_or_eu", "Deutsche/r oder EU/EWR-Bürger/in"), ("permanent", "Niederlassungserlaubnis"),
            ("student", "Aufenthaltstitel zum Studium"), ("work", "Aufenthaltstitel zur Arbeit / Blaue Karte"),
            ("family", "Familiennachzug"), ("asylum_protection", "Asyl/Flüchtlings-/subsidiärer Schutz"),
            ("visitor", "Schengen-Visum/Besuch"), ("not_sure", "Ich bin nicht sicher"),
        ]
    return [
        ("german_or_eu", "German or EU/EEA citizen"), ("permanent", "Permanent residence"),
        ("student", "Student residence permit"), ("work", "Work permit / EU Blue Card"),
        ("family", "Family reunification"), ("asylum_protection", "Asylum/refugee/subsidiary protection"),
        ("visitor", "Schengen visa / visitor stay"), ("not_sure", "I am not sure"),
    ]


def _clarification_payload(language: str, questions: list[dict], trace: list[str]) -> dict:
    answer = (
        "Zusammenfassung\nIch kann das erst sicher beantworten, wenn diese Angaben klar sind. "
        "Bitte beantworte die Fragen, dann prüfe ich die passenden offiziellen Quellen."
        if language == "de"
        else "Summary\nI need a few details before I can answer this safely. "
             "Please answer these questions, then I will check the matching official sources."
    )
    return {"answer": answer, "clarifying_question": questions[0]["question"] if questions else "",
            "clarifying_questions": questions, "citations": [], "confidence": 0.45,
            "escalate": False, "trace": trace, "needs_input": True}


def _broad_immigration_topic(query: str) -> bool:
    return bool(re.search(r"\b(immigration law|migration law|einwanderungsrecht|migrationsrecht|immigration rules|move to germany|nach deutschland (ziehen|kommen|auswandern))\b", _normalize(query)))


def _has_specific_immigration_area(text: str) -> bool:
    return bool(re.search(r"\b(visa|visum|entry|einreise|residence|aufenthalt|study|studium|student|work|arbeit|job|family|familie|asylum|asyl|refugee|citizenship|naturaliz|einbuerger)\b", text))


def _travel_visa_topic(query: str) -> bool:
    q = _normalize(query)
    if _student_visa_topic(query):
        return False
    return bool(re.search(r"\b(visa|visum|entry requirement|einreise)\b", q) and re.search(r"\b(travel|visit|go to|enter|entry|reise|reisen|besuch)\b", q))


def _student_visa_topic(query: str) -> bool:
    return bool(re.search(r"\b(student visa|study visa|visa for stud|national visa.*stud|studentenvisum|visum zum studium)\b", _normalize(query)))


def _post_study_topic(query: str) -> bool:
    return bool(re.search(r"\b(after studies|after graduation|post study|post-study|nach dem studium|studienabschluss|abschluss.*stud)\b", _normalize(query)))


def _work_permission_topic(query: str) -> bool:
    return bool(re.search(r"\b(can i work|allowed to work|work permit|darf ich arbeiten|arbeiten darf|arbeitserlaubnis)\b", _normalize(query)))


def _has_nationality_context(text: str) -> bool:
    return bool(re.search(r"\b(nationality|citizenship|citizen|passport|staatsangehoerigkeit|pass|pakistani|indian|syrian|turkish|ukrainian|deutscher|deutsche|eu citizen|german_or_eu)\b", text))


def _has_status_context(text: str) -> bool:
    return bool(re.search(r"\b(student|work permit|blue card|permanent|asylum|refugee|subsidiary|family|schengen|visitor|aufenthaltstitel|niederlassung|blaue karte|asyl|familiennachzug|german_or_eu|asylum_protection|not_sure)\b", text))


# --------------------------------------------------------------------------- #
# Guided flow helpers
# --------------------------------------------------------------------------- #
def _clean_guided_answers(answers: dict) -> dict:
    out = {}
    for key, value in answers.items():
        clean_key = re.sub(r"[^a-zA-Z0-9_-]+", "", str(key))[:80]
        if not clean_key:
            continue
        if isinstance(value, (str, int, float, bool)):
            out[clean_key] = _guided_value(value)
        elif isinstance(value, list):
            out[clean_key] = [_guided_value(v) for v in value[:20] if _guided_value(v)]
    return out


def _clean_guided_path(path: list[dict]) -> list[dict]:
    out = []
    for item in path[:20]:
        if not isinstance(item, dict):
            continue
        out.append({
            "nodeId": re.sub(r"[^a-zA-Z0-9_-]+", "", str(item.get("nodeId", "")))[:80],
            "answerKey": re.sub(r"[^a-zA-Z0-9_-]+", "", str(item.get("answerKey", "")))[:80],
            "question": re.sub(r"\s+", " ", str(item.get("question", ""))).strip()[:260],
            "answerLabel": re.sub(r"\s+", " ", str(item.get("answerLabel", ""))).strip()[:260],
            "value": ([_guided_value(v) for v in item.get("value", [])[:20]]
                      if isinstance(item.get("value"), list) else _guided_value(item.get("value", ""))),
        })
    return [i for i in out if i["question"] or i["answerLabel"] or i["answerKey"]]


def _guided_value(value: object) -> str:
    return re.sub(r"\s+", " ", str(value)).strip()[:240]


def _guided_prompt(answers: dict, path: list[dict], language: str) -> str:
    trail = re.sub(r"\s+", " ", " -> ".join(
        item.get("answerLabel") or _guided_value(item.get("value", "")) for item in path)).strip()
    planning = answers.get("locationIntent") in {"planning_move", "planning"}
    visa = _guided_value(answers.get("visaStatus", ""))
    age = _guided_value(answers.get("age", ""))
    if language == "de":
        parts = [
            "Erstelle einen quellenbasierten Migrations-Guide für Deutschland.",
            "Die Person plant den Umzug nach Deutschland." if planning else "Die Person ist bereits in Deutschland.",
            f"Alter: {age}." if age else "", f"Gewählter Weg: {visa}." if visa else "",
            f"Bubble-Pfad: {trail}." if trail else "",
            "Gib Zusammenfassung, Dokumenten-Checkliste, konkrete Schritte, Termin-Hinweise und offizielle Quellen.",
        ]
    else:
        parts = [
            "Create a source-grounded migration guide for Germany.",
            "The person is planning to move to Germany." if planning else "The person is already in Germany.",
            f"Age: {age}." if age else "", f"Selected route: {visa}." if visa else "",
            f"Bubble path: {trail}." if trail else "",
            "Include a summary, document checklist, concrete steps, appointment notes, and official sources.",
        ]
    return " ".join(p for p in parts if p)


def _guided_context(answers: dict, path: list[dict], language: str) -> str:
    heading = "Geführter Bubble-Kontext" if language == "de" else "Guided bubble context"
    lines = [heading]
    for i, item in enumerate(path, 1):
        ans = item.get("answerLabel") or _guided_value(item.get("value", ""))
        lines.append(f"{i}. {item.get('question') or item.get('answerKey')}: {ans}")
    lines.append("Raw categories:")
    for key, value in answers.items():
        lines.append(f"- {key}: {_guided_value(value)}")
    return "\n".join(lines)[:2400]


def _guided_tags(answers: dict) -> list[str]:
    tags = set()
    if answers.get("locationIntent") in {"planning_move", "planning"} or answers.get("journeyStage") == "just_arrived":
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
    is_minor = _age_context(age).startswith("minor")
    hints = {
        "planning-visa": ("minor child school family reunification guardian protection residence Germany" if is_minor
                          else "residence permit national visa studies vocational training skilled work family reunification asylum protection language course Germany"),
        "planning-readiness": "visa application readiness admission enrolment job offer training contract family documents proof livelihood health insurance",
        "planning-documents": "visa residence documents passport biometric photo health insurance proof income enrolment birth certificate family documents",
        "current-status": "residence status Aufenthaltstitel asylum protection work permission student family registration Germany",
        "current-goal": "registration renewal residence permit work rights health insurance family benefits language integration appointment documents Germany",
        "current-documents": "documents passport registration certificate residence document health insurance proof income rental contract appointment Germany",
    }
    hint = hints.get(node_id, "Germany migration residence documents next step")
    if language == "de":
        return f"{hint}. Kontext: Alter {age}, Standort {location}, Weg {trail}, Visum {visa}."
    return f"{hint}. Context: age {age}, location {location}, path {trail}, visa {visa}."


def _age_context(age: str) -> str:
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
        "You generate the next tappable options for a guided migration flow for Germany. "
        "Prefer options grounded in the provided sources and the user's context (age, location, prior answers). "
        "Do not invent eligibility or legal claims. "
        f"Write labels and helpers in {answer_language}. "
        "Respond as strict JSON: "
        '{"options":[{"value": string, "label": string, "helper": string, "icon": string, '
        '"badge": string, "next": string, "source": string}]}. Return at most 8 options.'
    )


def _guided_options_user(node_id: str, answers: dict, path: list[dict], sources: list[dict], language: str) -> str:
    return (
        f"Current node id: {node_id}\n"
        f"Return the options to show next for this node.\n"
        f"Allowed next ids: planning-readiness, planning-documents, current-goal, current-documents, ai-result.\n\n"
        f"{_guided_context(answers, path, language)}\n\nSources:\n{_source_block(sources)}"
    )


# ---- Deterministic, logical option sets so bubbles never dead-end ---------- #
def _opt(value, label_en, label_de, helper_en, helper_de, icon, next_id, language, badge_en="Guided", badge_de="Geführt", source=""):
    return {
        "value": value, "label": label_de if language == "de" else label_en,
        "helper": helper_de if language == "de" else helper_en, "icon": icon,
        "badge": badge_de if language == "de" else badge_en, "next": next_id, "source": source,
    }


def _default_guided_next(node_id: str) -> str:
    return {
        "planning-visa": "planning-readiness", "planning-readiness": "planning-documents",
        "current-status": "current-goal", "current-goal": "current-documents",
    }.get(node_id, "ai-result")


def _logical_node_options(node_id: str, answers: dict, sources: list[dict], language: str) -> list[dict]:
    nxt = _default_guided_next(node_id)
    age = _age_context(_guided_value(answers.get("age", "")))
    minor = age.startswith("minor")

    if node_id in {"current-status"}:
        return [
            _opt("student", "Student permit", "Aufenthalt zum Studium", "You study or will study in Germany.", "Du studierst in Deutschland.", "GraduationCap", nxt, language),
            _opt("work", "Work permit / Blue Card", "Arbeit / Blaue Karte", "You work or have a job offer.", "Du arbeitest oder hast ein Jobangebot.", "BriefcaseBusiness", nxt, language),
            _opt("family", "Family reunification", "Familiennachzug", "You joined or want to join family.", "Du bist/willst bei Familie sein.", "Users", nxt, language),
            _opt("asylum", "Asylum / protection", "Asyl / Schutz", "You applied for or hold protection.", "Du hast Schutz beantragt/erhalten.", "ShieldCheck", nxt, language),
            _opt("permanent", "Permanent residence", "Niederlassung", "You hold long-term residence.", "Du hast einen Daueraufenthalt.", "BadgeCheck", nxt, language),
            _opt("not_sure", "I'm not sure", "Nicht sicher", "Get help identifying your status.", "Hilfe bei der Einordnung.", "Search", nxt, language),
        ]

    if node_id in {"planning-visa"}:
        if minor:
            return [
                _opt("family", "Join family", "Familiennachzug", "Move to a parent or guardian in Germany.", "Zu Eltern/Vormund nach Deutschland.", "Users", nxt, language),
                _opt("school", "School / education", "Schule / Bildung", "School-age education route.", "Schulische Bildung.", "GraduationCap", nxt, language),
                _opt("asylum", "Protection", "Schutz", "Protection for minors.", "Schutz für Minderjährige.", "ShieldCheck", nxt, language),
                _opt("not_sure", "Not sure yet", "Noch unklar", "Explore options with a counselor.", "Optionen mit Beratung klären.", "Search", nxt, language),
            ]
        return [
            _opt("study", "Studies", "Studium", "Study at a German institution.", "Studium an einer Hochschule.", "GraduationCap", nxt, language),
            _opt("skilled_work", "Skilled work / Blue Card", "Fachkraft / Blaue Karte", "Qualified employment route.", "Qualifizierte Beschäftigung.", "BriefcaseBusiness", nxt, language),
            _opt("vocational_training", "Vocational training", "Ausbildung", "Recognised training in Germany.", "Anerkannte Ausbildung.", "BadgeCheck", nxt, language),
            _opt("opportunity_card", "Opportunity Card", "Chancenkarte", "Points-based job search.", "Punktebasierte Jobsuche.", "Search", nxt, language),
            _opt("family", "Family reunification", "Familiennachzug", "Join family in Germany.", "Zu Familie nach Deutschland.", "Users", nxt, language),
            _opt("asylum", "Asylum / protection", "Asyl / Schutz", "Seek protection in Germany.", "Schutz in Deutschland suchen.", "ShieldCheck", nxt, language),
        ]

    if node_id in {"current-goal"}:
        return [
            _opt("registration", "Register address", "Anmeldung", "Register where you live.", "Wohnsitz anmelden.", "FileText", nxt, language),
            _opt("renew_permit", "Renew/extend permit", "Titel verlängern", "Keep your residence valid.", "Aufenthalt verlängern.", "BadgeCheck", nxt, language),
            _opt("work_rights", "Work rights", "Arbeitsrechte", "What you may work.", "Was du arbeiten darfst.", "BriefcaseBusiness", nxt, language),
            _opt("health_insurance", "Health insurance", "Krankenversicherung", "Get or change insurance.", "Versicherung klären.", "ShieldCheck", nxt, language),
            _opt("family_benefits", "Family & benefits", "Familie & Leistungen", "Kindergeld and family topics.", "Kindergeld und Familie.", "Users", nxt, language),
            _opt("language_integration", "Language & integration", "Sprache & Integration", "Courses and integration.", "Kurse und Integration.", "GraduationCap", nxt, language),
        ]

    if node_id in {"planning-readiness"}:
        return [
            _opt("admission_or_offer", "Admission / job offer", "Zulassung / Jobangebot", "You have a study place or job offer.", "Du hast Studienplatz oder Jobangebot.", "BadgeCheck", nxt, language),
            _opt("documents_ready", "Documents ready", "Unterlagen bereit", "Passport and proofs collected.", "Pass und Nachweise vorhanden.", "FileText", nxt, language),
            _opt("financing_ready", "Financing secured", "Finanzierung gesichert", "Blocked account or funding ready.", "Sperrkonto/Finanzierung vorhanden.", "BriefcaseBusiness", nxt, language),
            _opt("still_exploring", "Still exploring", "Noch in Klärung", "You are still gathering things.", "Du sammelst noch.", "Search", nxt, language),
        ]

    if node_id in {"current-documents", "planning-documents"}:
        # Prefer documents actually mentioned in retrieved sources, then defaults.
        doc_opts = _document_options_from_sources(sources, node_id, language)
        if doc_opts:
            return doc_opts
        return [
            _opt("passport", "Valid passport", "Gültiger Pass", "Travel document / ID.", "Reisedokument / Ausweis.", "FileText", nxt, language, "Document", "Dokument"),
            _opt("biometric_photo", "Biometric photo", "Biometrisches Foto", "Passport-style photo.", "Passfoto.", "FileText", nxt, language, "Document", "Dokument"),
            _opt("health_insurance", "Health insurance proof", "Krankenversicherungsnachweis", "Proof of insurance.", "Versicherungsnachweis.", "FileText", nxt, language, "Document", "Dokument"),
            _opt("registration_certificate", "Registration certificate", "Meldebescheinigung", "Proof of registered address.", "Nachweis der Anmeldung.", "FileText", nxt, language, "Document", "Dokument"),
            _opt("income_or_livelihood", "Proof of income/livelihood", "Einkommens-/Lebensunterhaltsnachweis", "Financial proof.", "Finanznachweis.", "FileText", nxt, language, "Document", "Dokument"),
            _opt("none_yet", "None of these yet", "Noch keins davon", "You can proceed and gather later.", "Du kannst später ergänzen.", "Search", nxt, language),
        ]

    # Enrich with any RAG-derived topic options where we have sources.
    return _topic_options_from_sources(sources, node_id, language)


DOCUMENT_PATTERNS = [
    ("passport", "Valid passport", "Gültiger Pass", r"\b(passport|pass|ausweis)\b"),
    ("biometric_photo", "Biometric photo", "Biometrisches Foto", r"\b(biometric photo|passport photo|passfoto|foto)\b"),
    ("health_insurance", "Health insurance proof", "Krankenversicherungsnachweis", r"\b(health insurance|krankenversicherung|insurance)\b"),
    ("income_or_livelihood", "Proof of income or livelihood", "Einkommens-/Lebensunterhaltsnachweis", r"\b(proof of income|secure livelihood|livelihood|income|lebensunterhalt|einkommen)\b"),
    ("enrolment_or_admission", "Admission or enrolment proof", "Zulassung oder Immatrikulation", r"\b(enrolment|enrollment|admission|immatrikulation|zulassung)\b"),
    ("job_or_training_contract", "Job or training contract", "Arbeits-/Ausbildungsvertrag", r"\b(job offer|employment contract|training contract|arbeitsvertrag|ausbildungsvertrag)\b"),
    ("registration_certificate", "Registration certificate", "Meldebescheinigung", r"\b(registration certificate|meldebescheinigung|anmeldung)\b"),
    ("rental_contract", "Rental contract", "Mietvertrag", r"\b(rental contract|mietvertrag)\b"),
    ("residence_document", "Residence document", "Aufenthaltsdokument", r"\b(residence document|residence permit|aufenthaltstitel)\b"),
    ("birth_certificate", "Birth certificate", "Geburtsurkunde", r"\b(birth certificate|geburtsurkunde)\b"),
    ("marriage_certificate", "Marriage certificate", "Heiratsurkunde", r"\b(marriage certificate|heiratsurkunde|marriage)\b"),
]


def _document_options_from_sources(sources: list[dict], node_id: str, language: str) -> list[dict]:
    text = "\n".join(f"{s.get('title', '')}. {s.get('text', '')}" for s in sources[:8])
    nxt = _default_guided_next(node_id)
    out = []
    for value, en, de, pattern in DOCUMENT_PATTERNS:
        if re.search(pattern, text, flags=re.I):
            out.append({
                "value": value, "label": de if language == "de" else en,
                "helper": (f"In den RAG-Quellen genannt." if language == "de" else "Mentioned in the retrieved sources."),
                "icon": "FileText", "badge": "From RAG" if language == "en" else "Aus RAG",
                "next": nxt, "source": _matching_source_title(sources, pattern),
            })
    return out[:8]


def _matching_source_title(sources: list[dict], pattern: str) -> str:
    for s in sources:
        if re.search(pattern, f"{s.get('title', '')}. {s.get('text', '')}", flags=re.I):
            return re.sub(r"\s+", " ", str(s.get("title", "")))[:120]
    return ""


def _topic_options_from_sources(sources: list[dict], node_id: str, language: str) -> list[dict]:
    out, seen = [], set()
    nxt = _default_guided_next(node_id)
    for s in sources[:8]:
        title = re.sub(r"\s+", " ", str(s.get("title", ""))).strip()
        if not title or title.lower() in seen:
            continue
        seen.add(title.lower())
        sentence = _sentences(str(s.get("text", ""))[:900])
        out.append({
            "value": _slug_value(s.get("id") or title), "label": title[:120],
            "helper": (sentence[0][:200] if sentence else ("Aus RAG-Kontext." if language == "de" else "From retrieved context.")),
            "icon": _icon_for_source(s), "badge": "RAG source" if language == "en" else "RAG-Quelle",
            "next": nxt, "source": title[:120],
        })
    return out[:8]


def _fallback_node_options(node_id: str, language: str) -> list[dict]:
    nxt = _default_guided_next(node_id)
    return [
        _opt("continue", "Continue", "Weiter", "Move to the next step.", "Zum nächsten Schritt.", "ArrowRight", nxt, language),
        _opt("not_sure", "I'm not sure", "Nicht sicher", "Get guided help.", "Geführte Hilfe.", "Search", nxt, language),
    ]


def _merge_options(primary: list[dict], extra: list[dict]) -> list[dict]:
    out, seen = [], set()
    for item in list(primary or []) + list(extra or []):
        if not isinstance(item, dict):
            continue
        value = re.sub(r"[^a-zA-Z0-9_-]+", "", str(item.get("value", "")))[:80]
        if not value or value in seen:
            continue
        seen.add(value)
        out.append(item)
    return out[:8]


def _icon_for_source(source: dict) -> str:
    text = _normalize(f"{source.get('title', '')} {source.get('text', '')[:600]}")
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
    return re.sub(r"[^a-zA-Z0-9_-]+", "_", str(value).lower()).strip("_")[:60] or "rag_option"


def _sanitize_guided_options(options: list[dict], language: str, node_id: str) -> list[dict]:
    out = []
    for item in options[:12]:
        if not isinstance(item, dict):
            continue
        value = re.sub(r"[^a-zA-Z0-9_-]+", "", str(item.get("value", "")))[:80]
        label = re.sub(r"\s+", " ", str(item.get("label", value))).strip()[:120]
        if not value or not label:
            continue
        out.append({
            "value": value, "label": label,
            "helper": re.sub(r"\s+", " ", str(item.get("helper", ""))).strip()[:240],
            "icon": re.sub(r"[^a-zA-Z0-9_-]+", "", str(item.get("icon", "Sparkles")))[:40],
            "badge": re.sub(r"\s+", " ", str(item.get("badge", "Guided" if language == "en" else "Geführt"))).strip()[:80],
            "next": re.sub(r"[^a-zA-Z0-9_-]+", "", str(item.get("next", _default_guided_next(node_id))))[:80] or _default_guided_next(node_id),
            "source": re.sub(r"\s+", " ", str(item.get("source", ""))).strip()[:160],
        })
    return out[:8]


# --------------------------------------------------------------------------- #
# Small utilities
# --------------------------------------------------------------------------- #
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


def _sentences(text: str) -> list[str]:
    compact = re.sub(r"\s+", " ", text or "").strip()
    parts = re.split(r"(?<=[.!?])\s+", compact)
    return [p[:320] for p in parts if 40 <= len(p) <= 420]


def _detect_language(query: str, requested: str) -> str:
    q = f" {query.lower()} "
    if re.search(r"[äöüß]", query, re.I):
        return "de"
    markers = [" ich ", " kann ", " wie ", " wo ", " was ", " warum ", " brauche ",
               " bekomme ", " anmelden", " ausländer", " arbeit", " darf ", " muss "]
    if any(m in q for m in markers):
        return "de"
    return "de" if requested == "de" else "en"


def _looks_vague(query: str) -> bool:
    words = re.findall(r"\w+", query.lower(), flags=re.UNICODE)
    if len(words) <= 2:
        return True
    return " ".join(words) in {"help", "hilfe", "problem", "question", "frage", "what now", "was jetzt"}


def _as_float(value: object, default: float) -> float:
    try:
        return float(value)
    except Exception:  # noqa: BLE001
        return default


def _should_escalate(query: str, confidence: float) -> bool:
    if confidence < 0.4:
        return True
    return bool(re.search(r"lawyer|deport|abschieb|denied|rejected|emergency|police|violence|suicide", query, re.I))
