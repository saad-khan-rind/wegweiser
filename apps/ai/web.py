"""Best-effort live web retrieval, so answers can reflect the latest information
and cite a URL. Degrades gracefully: if no search backend is reachable, returns
an empty list and the agent relies on the vector store + crawled content.

Optional dependency: `ddgs` (DuckDuckGo). No API key required.
"""
from __future__ import annotations
import logging
import os
import re
import urllib.request
from urllib.parse import urlparse

from envloader import load_env

load_env()

log = logging.getLogger("web")

UA = "Mozilla/5.0 (compatible; WegweiserBot/0.1)"
OFFICIAL_HOSTS = (
    ".bund.de",
    ".bayern.de",
    "bayern.de",
    "bamf.de",
    "make-it-in-germany.com",
    "arbeitsagentur.de",
    "bundesagentur.de",
    "germany4ukraine.de",
    "integreat.app",
    "cms.integreat-app.de",
    "gesetze-im-internet.de",
    "bayernportal.de",
    "stadt.muenchen.de",
    "augsburg.de",
    "verwaltung.bund.de",
)

BLOCKED_PATTERNS = (
    r"\bcaptcha\b",
    r"\bradware\b",
    r"\baccess denied\b",
    r"\brequest unsuccessful\b",
    r"\bincident id\b",
    r"\bblocked due to security\b",
    r"\bsolve this captcha\b",
    r"\bunblock your request\b",
    r"\bverify you are human\b",
    r"\bcloudflare\b",
)

DIRECT_TOPICS = {
    "registration": [
        {
            "id": "official-bmg-17",
            "title": "Bundesmeldegesetz § 17 Anmeldung, Abmeldung",
            "url": "https://www.gesetze-im-internet.de/bmg/__17.html",
            "snippet": (
                "Wer eine Wohnung bezieht, hat sich innerhalb von zwei Wochen nach dem Einzug "
                "bei der Meldebehörde anzumelden. Wer aus einer Wohnung auszieht und keine neue "
                "Wohnung im Inland bezieht, hat sich abzumelden."
            ),
        },
        {
            "id": "official-bmg-19",
            "title": "Bundesmeldegesetz § 19 Mitwirkung des Wohnungsgebers",
            "url": "https://www.gesetze-im-internet.de/bmg/__19.html",
            "snippet": (
                "Der Wohnungsgeber muss bei der Anmeldung mitwirken und der meldepflichtigen "
                "Person den Einzug schriftlich oder elektronisch bestätigen."
            ),
        },
    ],
}


def search(query: str, k: int = 3) -> list[dict]:
    """Return [{title, url, snippet}]. Best effort."""
    results = _ddg(query, max(k * 4, k))
    if os.getenv("AGENT_OFFICIAL_WEB_ONLY", "1") == "1":
        results = [r for r in results if is_official_url(r.get("url", ""))]
    results = [r for r in results if not is_blocked_text(f"{r.get('title', '')} {r.get('snippet', '')}")]
    return results[:k]


def direct_sources(query: str, lang: str = "en", k: int = 3) -> list[dict]:
    """Small set of official direct lookups for high-frequency tasks.

    These are never written to the vector DB. They only provide stable official
    context when web search returns irrelevant pages.
    """
    topic = _topic(query)
    if not topic:
        return []
    out = []
    for item in DIRECT_TOPICS.get(topic, []):
        text = fetch(item["url"], 1600)
        out.append({**item, "snippet": text or item["snippet"]})
    return out[:k]


def _topic(query: str) -> str:
    q = (query or "").lower().replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
    if re.search(r"\b(registration|register|address|anmeldung|anmelden|melde|wohnsitz)\b", q):
        return "registration"
    return ""


def is_official_url(url: str) -> bool:
    host = urlparse(url).netloc.lower().replace("www.", "")
    return any(host == h or host.endswith(h) for h in OFFICIAL_HOSTS)


def is_blocked_text(text: str) -> bool:
    compact = re.sub(r"\s+", " ", text or "").lower()
    return any(re.search(pattern, compact, flags=re.I) for pattern in BLOCKED_PATTERNS)


def _ddg(query: str, k: int) -> list[dict]:
    try:
        from ddgs import DDGS  # type: ignore
    except Exception:
        try:
            from duckduckgo_search import DDGS  # type: ignore
        except Exception:
            log.info("No web-search backend installed; skipping web step")
            return []
    out: list[dict] = []
    try:
        with DDGS() as ddgs:
            for r in ddgs.text(query, region="de-de", max_results=k):
                out.append({
                    "title": r.get("title", ""),
                    "url": r.get("href") or r.get("url", ""),
                    "snippet": r.get("body", ""),
                })
    except Exception as e:  # noqa: BLE001
        log.warning("web search failed: %s", e)
    return out


def fetch(url: str, max_chars: int = 2500) -> str:
    """Fetch a page and return cleaned text (best effort, always fresh)."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Cache-Control": "no-cache"})
        with urllib.request.urlopen(req, timeout=15) as r:
            html = r.read().decode("utf-8", errors="ignore")
        text = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", html, flags=re.S | re.I)
        text = re.sub(r"<[^>]+>", " ", text)
        text = re.sub(r"\s+", " ", text).strip()
        if is_blocked_text(text[:1200]):
            log.info("Skipping blocked/captcha page: %s", url)
            return ""
        return text[:max_chars]
    except Exception as e:  # noqa: BLE001
        log.warning("fetch failed for %s: %s", url, e)
        return ""
