"""Optional: crawl Integreat region pages into the local corpus.

Integreat exposes a public JSON API per region, e.g.:
    https://cms.integreat-app.de/<region>/<lang>/wp-json/extensions/v3/pages

This script pulls page titles + content and writes them as markdown files with
front matter into ./corpus, so the retriever can index real, current content.
Run:  python crawl.py augsburg de
"""
import sys
import re
import json
import urllib.request
from pathlib import Path

CORPUS = Path(__file__).parent / "corpus"


def slugify(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:60] or "page"


def strip_html(html: str) -> str:
    text = re.sub(r"<[^>]+>", " ", html or "")
    return re.sub(r"\s+", " ", text).strip()


def main(region: str, lang: str = "de") -> None:
    url = f"https://cms.integreat-app.de/{region}/{lang}/wp-json/extensions/v3/pages"
    print(f"Fetching {url}")
    with urllib.request.urlopen(url, timeout=30) as r:
        pages = json.load(r)
    CORPUS.mkdir(exist_ok=True)
    written = 0
    for p in pages:
        title = p.get("title", "").strip()
        content = strip_html(p.get("content", ""))
        if not title or len(content) < 80:
            continue
        modified = (p.get("modified_gmt") or "2026-01-01")[:10]
        fname = CORPUS / f"{region}-{slugify(title)}.md"
        fm = (f"---\nid: {slugify(title)}\ntitle: {title}\norigin: integreat\n"
              f"updated_at: {modified}\ntags: region:{region}\n---\n{content}\n")
        fname.write_text(fm, encoding="utf-8")
        written += 1
    print(f"Wrote {written} pages to {CORPUS}")


if __name__ == "__main__":
    region = sys.argv[1] if len(sys.argv) > 1 else "augsburg"
    lang = sys.argv[2] if len(sys.argv) > 2 else "de"
    main(region, lang)
