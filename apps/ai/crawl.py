"""Official-source crawler - always fetches the latest content (no caching).

General/Bavaria crawl uses configured official public URLs. City/region crawl
uses Integreat's public per-region JSON API:
    https://cms.integreat-app.de/<region>/<lang>/wp-json/extensions/v3/pages

Crawled pages are written to ./corpus AND upserted into the vector store, so the
agent's RAG always has the most recent official content. Can be run as a CLI or
called from the service (startup + periodic refresh + /refresh endpoint).
"""
from __future__ import annotations
import json
import logging
import os
import re
import sys
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

from envloader import load_env

load_env()

log = logging.getLogger("crawl")
CORPUS = Path(__file__).parent / "corpus"
UA = "Mozilla/5.0 (compatible; WegweiserBot/0.1)"

GENERAL_REGIONS = {"", "general", "bavaria", "bayern", "germany", "deutschland"}
OFFICIAL_GENERAL_URLS = {
    "en": [
        "https://www.make-it-in-germany.com/en/visa-residence",
        "https://www.make-it-in-germany.com/en/living-in-germany",
        "https://www.bamf.de/EN/Themen/MigrationAufenthalt/migrationaufenthalt-node.html",
        "https://www.bamf.de/EN/Themen/Integration/integration-node.html",
        "https://www.arbeitsagentur.de/en",
        "https://www.stmi.bayern.de/mui/index.php",
    ],
    "de": [
        "https://www.make-it-in-germany.com/de/visum-aufenthalt",
        "https://www.make-it-in-germany.com/de/leben-in-deutschland",
        "https://www.bamf.de/DE/Themen/MigrationAufenthalt/migrationaufenthalt-node.html",
        "https://www.bamf.de/DE/Themen/Integration/integration-node.html",
        "https://www.arbeitsagentur.de/",
        "https://www.stmi.bayern.de/mui/index.php",
    ],
}


def slugify(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:60] or "page"


def strip_html(html: str) -> str:
    html = re.sub(r"<(script|style|noscript|svg|nav|footer|header)[^>]*>.*?</\1>", " ", html or "", flags=re.S | re.I)
    html = re.sub(r"<br\s*/?>", " ", html, flags=re.I)
    html = re.sub(r"</(p|li|h1|h2|h3|section|article)>", ". ", html, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", html)
    return re.sub(r"\s+", " ", text).strip()


def page_title(html: str, fallback: str) -> str:
    for pattern in (r"<h1[^>]*>(.*?)</h1>", r"<title[^>]*>(.*?)</title>"):
        m = re.search(pattern, html or "", flags=re.S | re.I)
        if m:
            title = strip_html(m.group(1)).strip(" .")
            if title:
                return title[:140]
    return fallback


def fetch_pages(region: str, lang: str) -> list[dict]:
    url = f"https://cms.integreat-app.de/{region}/{lang}/wp-json/extensions/v3/pages"
    # Cache-busting + no-cache headers guarantee the freshest content every run.
    req = urllib.request.Request(url, headers={
        "User-Agent": UA, "Cache-Control": "no-cache, no-store", "Pragma": "no-cache",
    })
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.load(r)


def configured_general_urls(lang: str) -> list[str]:
    raw = os.getenv("CRAWL_URLS", "").strip()
    if raw:
        return [u.strip() for u in re.split(r"[\n, ]+", raw) if u.strip().startswith("http")]
    return OFFICIAL_GENERAL_URLS.get(lang, OFFICIAL_GENERAL_URLS["en"])


def fetch_url(url: str) -> tuple[str, str]:
    req = urllib.request.Request(url, headers={
        "User-Agent": UA, "Cache-Control": "no-cache, no-store", "Pragma": "no-cache",
    })
    with urllib.request.urlopen(req, timeout=35) as r:
        html = r.read().decode("utf-8", errors="ignore")
    return page_title(html, urlparse(url).netloc), strip_html(html)


def crawl_general(lang: str = "en", upsert: bool = True) -> int:
    lang = "de" if lang == "de" else "en"
    CORPUS.mkdir(exist_ok=True)
    records, written = [], 0
    for url in configured_general_urls(lang):
        try:
            title, content = fetch_url(url)
        except Exception as e:  # noqa: BLE001
            log.warning("general crawl failed for %s: %s", url, e)
            continue
        if len(content) < 200:
            continue
        host = urlparse(url).netloc.replace("www.", "")
        sid = f"official-{slugify(host)}-{slugify(title)}"
        text = content[:7000]
        (CORPUS / f"{sid}.md").write_text(
            f"---\nid: {sid}\ntitle: {title}\norigin: official-web\nupdated_at: latest\n"
            f"url: {url}\ntags: region:general, lang:{lang}\n---\n{text}\n", encoding="utf-8")
        records.append({"id": sid, "text": f"{title}. {text}",
                        "metadata": {"title": title, "source": "official-web", "url": url, "date": "latest"}})
        written += 1
    if upsert and records:
        try:
            from vectorstore import get_store
            get_store().upsert(records)
            log.info("Upserted %s general official pages into the vector store", len(records))
        except Exception as e:  # noqa: BLE001
            log.warning("vector upsert failed: %s", e)
    log.info("Crawled %s general official pages for lang=%s", written, lang)
    return written


def crawl_region(region: str, lang: str = "en", upsert: bool = True) -> int:
    lang = "de" if lang == "de" else "en"
    if (region or "").strip().lower() in GENERAL_REGIONS:
        return crawl_general(lang, upsert)
    try:
        pages = fetch_pages(region, lang)
    except Exception as e:  # noqa: BLE001
        log.warning("crawl failed for %s/%s: %s", region, lang, e)
        return 0
    CORPUS.mkdir(exist_ok=True)
    records, written = [], 0
    base = f"https://integreat.app/{region}/{lang}"
    for p in pages:
        title = (p.get("title") or "").strip()
        content = strip_html(p.get("content", ""))
        if not title or len(content) < 80:
            continue
        modified = (p.get("modified_gmt") or "2026-01-01")[:10]
        path = p.get("path", "")
        page_url = f"{base}/{path.strip('/')}" if path else base
        sid = f"{region}-{slugify(title)}"
        (CORPUS / f"{sid}.md").write_text(
            f"---\nid: {sid}\ntitle: {title}\norigin: integreat\nupdated_at: {modified}\n"
            f"url: {page_url}\ntags: region:{region}\n---\n{content}\n", encoding="utf-8")
        records.append({"id": sid, "text": f"{title}. {content}",
                        "metadata": {"title": title, "source": "integreat", "url": page_url, "date": modified}})
        written += 1
    if upsert and records:
        try:
            from vectorstore import get_store
            get_store().upsert(records)
            log.info("Upserted %s crawled pages into the vector store", len(records))
        except Exception as e:  # noqa: BLE001
            log.warning("vector upsert failed: %s", e)
    log.info("Crawled %s pages for %s/%s", written, region, lang)
    return written


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    region = sys.argv[1] if len(sys.argv) > 1 else os.getenv("CRAWL_REGION", "bavaria")
    lang = sys.argv[2] if len(sys.argv) > 2 else os.getenv("CRAWL_LANG", "en")
    n = crawl_region(region, lang)
    print(f"Wrote/updated {n} pages")
