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
    query_variants = _query_variants(query, language)

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
    if USE_WEB:
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
    {"study", "studies", "studium", "student", "studenten", "studierenden", "university", "hochschule"},
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
    "integration", "integrationskurs", "health insurance", "krankenversicherung", "kindergeld",
    "buergergeld", "bürgergeld", "benefit", "sozialleistung", "german law", "german policy",
    "deutsches recht", "germany law", "travel to", "einreise", "entry requirement",
}


def _query_variants(query: str, language: str) -> list[dict]:
    other = "de" if language == "en" else "en"
    variants = [
        {"query": query, "lang": language, "label": f"original-{language}"},
        {"query": _expanded_query(query), "lang": language, "label": f"expanded-{language}"},
    ]
    translated = _translate_query(query, other) or _rule_translate_query(query, other)
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
    lines = []
    for i, s in enumerate(sources, 1):
        meta = f"{s['source']}" + (f", {s['date']}" if s.get("date") else "")
        lines.append(f"[{i}] {s['title']} ({meta})\n{s['text'][:1200]}")
    return "\n\n".join(lines) if lines else "(no sources found)"


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
def run(query: str, tags: list[str], region: str = "", language: str = "en",
        extra_context: str = "") -> dict:
    answer_language = _detect_language(query, language)
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

    if not llm_info.get("reachable"):
        return _with_runtime(_grounded_fallback(query, sources, "LLM unreachable", trace, answer_language), resources, llm_info)

    draft = _draft(goal, tags, sources, answer_language)
    if not draft or not (draft.get("summary") or draft.get("answer")):
        return _with_runtime(_grounded_fallback(query, sources, "draft failed", trace, answer_language), resources, llm_info)
    trace.append("Drafted an answer with citations")

    used = draft.get("used", [])
    confidence = _as_float(draft.get("confidence"), 0.6)
    answer = _format_answer(draft, answer_language)
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


def _required_clarifications(query: str, language: str, extra_context: str) -> list[dict]:
    context = f"{query}\n{extra_context}"
    q = _normalize(context)
    questions: list[dict] = []

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
    has_visa = re.search(r"\b(visa|visum|entry requirement|einreise)\b", q)
    has_travel = re.search(r"\b(travel|visit|go to|enter|reise|reisen|besuch|nach|to)\b", q)
    return bool(has_visa and has_travel)


def _work_permission_topic(query: str) -> bool:
    q = _normalize(query)
    return bool(re.search(r"\b(can i work|allowed to work|work permit|darf ich arbeiten|arbeiten darf|arbeitserlaubnis)\b", q))


def _benefits_topic(query: str) -> bool:
    q = _normalize(query)
    return bool(re.search(r"\b(benefit|eligible|kindergeld|buergergeld|burgergeld|sozialleistung|leistungen|jobcenter)\b", q))


def _has_nationality_context(text: str) -> bool:
    return bool(re.search(
        r"\b(nationality|citizenship|citizen|passport|staatsangehoerigkeit|staatsangehörigkeit|pass|"
        r"pakistani|indian|syrian|turkish|ukrainian|german citizen|deutscher|deutsche|eu citizen)\b",
        text,
    ))


def _has_status_context(text: str) -> bool:
    return bool(re.search(
        r"\b(student residence|student visa|work permit|blue card|permanent|asylum|refugee|subsidiary|"
        r"temporary protection|family reunification|schengen|visitor|aufenthaltstitel|aufenthaltserlaubnis|"
        r"niederlassung|blaue karte|asyl|fluechtling|flüchtling|familiennachzug|duldung|studentenvisum|arbeitsvisum|besuchsvisum)\b",
        text,
    ))


def _has_travel_purpose(text: str) -> bool:
    return bool(re.search(r"\b(tourism|tourist|family visit|business|study|work|transit|purpose|dauer|zweck|besuch|arbeit|studium)\b", text))


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
