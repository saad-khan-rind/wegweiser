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
    return fetch_pages_url(url)


def fetch_pages_url(url: str) -> list[dict]:
    # Cache-busting + no-cache headers guarantee the freshest content every run.
    req = urllib.request.Request(url, headers={
        "User-Agent": UA, "Cache-Control": "no-cache, no-store", "Pragma": "no-cache",
    })
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.load(r)


def parse_integreat_api_url(url: str) -> tuple[str, str]:
    parsed = urlparse(url)
    parts = [p for p in parsed.path.split("/") if p]
    try:
        marker = parts.index("wp-json")
    except ValueError:
        marker = -1
    if marker < 2 or len(parts) < marker + 4 or parts[marker + 1:marker + 4] != ["extensions", "v3", "pages"]:
        raise ValueError("URL must look like https://cms.integreat-app.de/<region>/<lang>/wp-json/extensions/v3/pages/")
    return parts[marker - 2], parts[marker - 1]


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
    if (region or "").startswith("http"):
        return crawl_integreat_api_url(region, upsert=upsert)["pages"]
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


def crawl_integreat_api_url(api_url: str, upsert: bool = True) -> dict:
    region, lang = parse_integreat_api_url(api_url)
    pages = fetch_pages_url(api_url)
    records = structured_integreat_records(pages, region, lang, api_url)
    CORPUS.mkdir(exist_ok=True)
    for r in records:
        md = r["metadata"]
        corpus_id = r["id"]
        (CORPUS / f"{corpus_id}.md").write_text(
            f"---\nid: {corpus_id}\ntitle: {md['title']}\norigin: integreat-api\n"
            f"updated_at: {md.get('date', '')}\nurl: {md.get('url', '')}\n"
            f"tags: region:{region}, lang:{lang}, source:integreat-api\n---\n{r['text']}\n",
            encoding="utf-8",
        )
    if upsert and records:
        try:
            from vectorstore import get_store
            get_store().upsert(records)
            log.info("Upserted %s structured Integreat API pages into the vector store", len(records))
        except Exception as e:  # noqa: BLE001
            log.warning("vector upsert failed: %s", e)
            raise
    log.info("Imported %s structured Integreat API pages for %s/%s", len(records), region, lang)
    return {"ok": True, "pages": len(records), "region": region, "lang": lang, "url": api_url}


def structured_integreat_records(pages: list[dict], region: str, lang: str, api_url: str) -> list[dict]:
    by_id = {int(p.get("id", 0)): p for p in pages if p.get("id")}
    records: list[dict] = []
    for p in pages:
        title = (p.get("title") or "").strip()
        page_id = str(p.get("id") or slugify(title))
        if not title:
            continue
        content = strip_html(p.get("content", ""))
        excerpt = strip_html(p.get("excerpt", ""))
        parent = p.get("parent") or {}
        parent_id = int(parent.get("id") or 0)
        parent_title = (by_id.get(parent_id) or {}).get("title", "") if parent_id else ""
        path = p.get("path") or ""
        admin_url = p.get("url") or ""
        public_url = _public_integreat_url(region, lang, path)
        modified = (p.get("modified_gmt") or p.get("last_updated") or "")[:10]
        languages = sorted((p.get("available_languages") or {}).keys())
        sid = f"integreat-{region}-{lang}-{page_id}"
        text = "\n".join([
            f"title: {title}",
            f"region: {region}",
            f"language: {lang}",
            f"path: {path}",
            f"parent: {parent_title or parent_id or 'root'}",
            f"order: {p.get('order', '')}",
            f"modified: {modified}",
            f"available_languages: {', '.join(languages)}",
            f"public_url: {public_url}",
            f"admin_url: {admin_url}",
            f"excerpt: {excerpt}",
            f"content: {content}",
        ]).strip()
        records.append({
            "id": sid,
            "text": text[:12000],
            "metadata": {
                "id": sid,
                "title": title,
                "source": "integreat-api",
                "source_type": "integreat_api",
                "integreat_id": page_id,
                "region": region,
                "lang": lang,
                "path": path,
                "parent_id": parent_id,
                "parent_title": str(parent_title),
                "order": int(p.get("order") or 0),
                "url": public_url or admin_url,
                "admin_url": admin_url,
                "api_url": api_url,
                "date": modified,
                "available_languages": ",".join(languages),
                "has_content": bool(content),
            },
        })
    return records


def _public_integreat_url(region: str, lang: str, path: str) -> str:
    clean = (path or "").strip("/")
    if not clean:
        return f"https://integreat.app/{region}/{lang}"
    return f"https://integreat.app/{clean}"


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    region = sys.argv[1] if len(sys.argv) > 1 else os.getenv("CRAWL_REGION", "bavaria")
    lang = sys.argv[2] if len(sys.argv) > 2 else os.getenv("CRAWL_LANG", "en")
    n = crawl_region(region, lang)
    print(f"Wrote/updated {n} pages")
