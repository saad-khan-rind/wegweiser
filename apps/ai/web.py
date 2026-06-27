"""Best-effort live web retrieval, so answers can reflect the latest information
and cite a URL. Degrades gracefully: if no search backend is reachable, returns
an empty list and the agent relies on the vector store + crawled content.

Optional dependency: `ddgs` (DuckDuckGo). No API key required.
"""
from __future__ import annotations
import logging
import re
import urllib.request

log = logging.getLogger("web")

UA = "Mozilla/5.0 (compatible; WegweiserBot/0.1)"


def search(query: str, k: int = 3) -> list[dict]:
    """Return [{title, url, snippet}]. Best effort."""
    results = _ddg(query, k)
    return results[:k]


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
        return text[:max_chars]
    except Exception as e:  # noqa: BLE001
        log.warning("fetch failed for %s: %s", url, e)
        return ""
