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
    "daad.de",
    "study-in-germany.de",
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
    "student_visa": [
        {
            "id": "official-aufenthg-16b",
            "title": "Residence Act section 16b - Studies",
            "url": "https://www.gesetze-im-internet.de/englisch_aufenthg/englisch_aufenthg.html#p0274",
            "snippet": (
                "A residence title for study purposes can be granted for full-time study at a state or "
                "state-recognised higher education institution, including preparatory measures. Admission "
                "to the course and secure livelihood are key points checked by the authorities."
            ),
        },
        {
            "id": "official-foreign-office-national-visa",
            "title": "Federal Foreign Office - National visa",
            "url": "https://www.auswaertiges-amt.de/en/visa-service/visa-navigator",
            "snippet": (
                "For stays in Germany longer than 90 days, applicants usually need a national visa before "
                "entering Germany. The application is made through the responsible German mission abroad."
            ),
        },
    ],
    "student_finance": [
        {
            "id": "official-study-in-germany-proof-financing",
            "title": "Study in Germany - Proof of financing",
            "url": "https://www.study-in-germany.de/en/plan-your-studies/requirements/proof-of-financing/",
            "snippet": (
                "International students normally need to prove that they have enough money to cover "
                "living expenses in Germany. A blocked account is one accepted way to show this proof; "
                "the current required amount should be checked on the official page."
            ),
        },
        {
            "id": "official-make-it-studies",
            "title": "Make it in Germany - Studying in Germany",
            "url": "https://www.make-it-in-germany.com/en/study-vocational-training/studies-in-germany",
            "snippet": (
                "Official federal information for international students explains study requirements, "
                "including admission, financing, health insurance, and residence steps."
            ),
        },
    ],
    "post_study": [
        {
            "id": "official-aufenthg-20",
            "title": "Residence Act section 20 - Job seeking after studies",
            "url": "https://www.gesetze-im-internet.de/englisch_aufenthg/englisch_aufenthg.html#p0418",
            "snippet": (
                "After successfully completing studies in Germany, a residence permit can be issued for "
                "up to 18 months to look for employment for which the qualification qualifies the graduate. "
                "Employment is permitted during this job-search residence permit."
            ),
        },
        {
            "id": "official-make-it-post-study",
            "title": "Make it in Germany - Prospects after graduation",
            "url": "https://www.make-it-in-germany.com/en/study-vocational-training/studies-in-germany/prospects-after",
            "snippet": (
                "International graduates can look for a qualified job in Germany after graduation and then "
                "switch to a suitable residence title such as qualified employment or the EU Blue Card."
            ),
        },
    ],
    "residence_permit": [
        {
            "id": "official-bamf-residence-permit",
            "title": "BAMF - Residence permits",
            "url": "https://www.bamf.de/EN/Themen/MigrationAufenthalt/ZuwandererDrittstaaten/zuwandererdrittstaaten-node.html",
            "snippet": (
                "A residence permit (Aufenthaltstitel) sets how long you may stay in Germany and whether you "
                "may work or study. It must be applied for and renewed at the local foreigners authority "
                "(Auslaenderbehoerde), usually before the current permit expires."
            ),
        },
        {
            "id": "official-make-it-residence",
            "title": "Make it in Germany - Visa & residence",
            "url": "https://www.make-it-in-germany.com/en/visa-residence",
            "snippet": (
                "Official federal information on visas and residence permits explains the routes for work, "
                "study, training, and family, the documents required, and the responsible authorities."
            ),
        },
    ],
    "family_reunification": [
        {
            "id": "official-aa-family-reunification",
            "title": "Federal Foreign Office - Family reunification",
            "url": "https://www.auswaertiges-amt.de/en/visa-service/buergerservice/faq/-/606852",
            "snippet": (
                "Family members joining a relative in Germany usually need a national visa applied for at the "
                "responsible German mission abroad. Typical requirements include a valid passport, proof of "
                "the family relationship (e.g. marriage or birth certificate), secure livelihood, and often "
                "basic German language skills for spouses."
            ),
        },
        {
            "id": "official-bamf-family",
            "title": "BAMF - Family asylum and reunification",
            "url": "https://www.bamf.de/EN/Themen/AsylFluechtlingsschutz/asylfluechtlingsschutz-node.html",
            "snippet": (
                "Family reunification lets close family members join a person who lives lawfully in Germany "
                "once the legal requirements are met."
            ),
        },
    ],
    "skilled_work": [
        {
            "id": "official-make-it-skilled-work",
            "title": "Make it in Germany - Working in Germany",
            "url": "https://www.make-it-in-germany.com/en/working-in-germany",
            "snippet": (
                "Skilled workers from non-EU countries can work in Germany with a recognised qualification and "
                "a concrete job offer. Routes include the EU Blue Card for higher earners with a degree and "
                "the residence permit for qualified employment; a recognised qualification is central."
            ),
        },
        {
            "id": "official-aufenthg-18b-blue-card",
            "title": "Residence Act - EU Blue Card",
            "url": "https://www.gesetze-im-internet.de/englisch_aufenthg/englisch_aufenthg.html",
            "snippet": (
                "The EU Blue Card is a residence title for highly qualified employment that meets a salary "
                "threshold; it can lead to permanent residence after a shorter period when conditions are met."
            ),
        },
    ],
    "health_insurance": [
        {
            "id": "official-make-it-health-insurance",
            "title": "Make it in Germany - Health insurance",
            "url": "https://www.make-it-in-germany.com/en/living-in-germany/insurance/health-insurance",
            "snippet": (
                "Health insurance is mandatory in Germany. Most residents are in statutory health insurance "
                "(gesetzliche Krankenversicherung); some can choose private insurance. Proof of health "
                "insurance is required for many residence and registration steps."
            ),
        },
    ],
    "integration_course": [
        {
            "id": "official-bamf-integration-course",
            "title": "BAMF - Integration courses",
            "url": "https://www.bamf.de/EN/Themen/Integration/ZugewanderteTeilnehmende/Integrationskurse/integrationskurse-node.html",
            "snippet": (
                "An integration course combines a German language course with an orientation course on living "
                "in Germany. Eligibility and whether attendance is required depend on your residence status; "
                "the foreigners authority or BAMF can issue an entitlement or obligation."
            ),
        },
    ],
    "citizenship": [
        {
            "id": "official-bmi-citizenship",
            "title": "Federal Ministry of the Interior - Naturalisation",
            "url": "https://www.bmi.bund.de/EN/topics/constitution/citizenship/citizenship-node.html",
            "snippet": (
                "Naturalisation in Germany generally requires several years of lawful residence, a secure "
                "livelihood, sufficient German language skills, a passed naturalisation test, and a "
                "commitment to the constitution. Requirements and residence periods are set by law."
            ),
        },
    ],
    "asylum": [
        {
            "id": "official-bamf-asylum",
            "title": "BAMF - The asylum procedure",
            "url": "https://www.bamf.de/EN/Themen/AsylFluechtlingsschutz/AblaufAsylverfahren/ablaufasylverfahren-node.html",
            "snippet": (
                "People seeking protection first report as asylum seekers, receive an arrival certificate, and "
                "then lodge a formal application at a BAMF branch. A personal interview follows, after which "
                "BAMF decides on the protection status."
            ),
        },
    ],
    "child_benefit": [
        {
            "id": "official-arbeitsagentur-kindergeld",
            "title": "Familienkasse - Kindergeld (child benefit)",
            "url": "https://www.arbeitsagentur.de/en/financial-support-family-benefits",
            "snippet": (
                "Kindergeld (child benefit) supports families with children living in Germany. It is applied "
                "for at the Familienkasse; eligibility depends on residence and the child living in the "
                "household. The amount is set nationally and should be checked on the official page."
            ),
        },
    ],
    "bank_account": [
        {
            "id": "official-basic-account",
            "title": "Basic payment account in Germany",
            "url": "https://www.bafin.de/EN/Verbraucher/Bank/Produkte/Basiskonto/basiskonto_node_en.html",
            "snippet": (
                "Everyone legally resident in the EU, including people without a fixed address or with "
                "tolerated status, has the right to a basic payment account (Basiskonto). Opening an account "
                "usually requires an ID document and often a registration certificate (Meldebescheinigung)."
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
    if re.search(r"\b(registration|register|address|anmeldung|anmelden|melde|wohnsitz|buergeramt)\b", q):
        return "registration"
    if re.search(r"\b(after studies|after graduation|post study|post-study|nach dem studium|studienabschluss|graduation)\b", q):
        return "post_study"
    if re.search(r"\b(blocked account|blocked amount|proof of funds|financial proof|proof of financial resources|sperrkonto|finanzierungsnachweis|lebensunterhalt)\b", q):
        return "student_finance"
    if re.search(r"\b(student visa|study visa|visa for stud|national visa.*stud|studium.*visum|studentenvisum|studieren)\b", q):
        return "student_visa"
    if re.search(r"\b(family reunification|familiennachzug|bring.*(wife|husband|spouse|family|child|children)|reunite|ehegattennachzug)\b", q):
        return "family_reunification"
    if re.search(r"\b(blue card|blaue karte|skilled work|fachkraft|qualified employment|job offer|arbeitsvertrag|work in germany|arbeiten in deutschland)\b", q):
        return "skilled_work"
    if re.search(r"\b(health insurance|krankenversicherung|gkv|tk|aok|private insurance|versichert)\b", q):
        return "health_insurance"
    if re.search(r"\b(integration course|integrationskurs|language course|sprachkurs|deutschkurs|orientation course)\b", q):
        return "integration_course"
    if re.search(r"\b(citizenship|naturalization|naturalisation|einbuergerung|german passport|become german|staatsangehoerigkeit)\b", q):
        return "citizenship"
    if re.search(r"\b(asylum|asyl|refugee|fluechtling|protection status|subsidiary protection|schutzstatus)\b", q):
        return "asylum"
    if re.search(r"\b(kindergeld|child benefit|family benefit|familienkasse|elterngeld)\b", q):
        return "child_benefit"
    if re.search(r"\b(bank account|basiskonto|open.*account|konto eroeffnen|girokonto)\b", q):
        return "bank_account"
    if re.search(r"\b(residence permit|aufenthaltstitel|aufenthaltserlaubnis|renew.*permit|extend.*permit|verlaengern)\b", q):
        return "residence_permit"
    return ""


def is_official_url(url: str) -> bool:
    host = urlparse(url).netloc.lower().replace("www.", "")
    return any(host == h or host.endswith(h) for h in OFFICIAL_HOSTS)


def is_useful_text(text: str, min_len: int = 280) -> bool:
    """A page is useful if it has enough real content and is not a bot/captcha wall."""
    compact = re.sub(r"\s+", " ", text or "").strip()
    if len(compact) < min_len:
        return False
    return not is_blocked_text(compact[:1500])


def best_official_context(query: str, lang: str = "en", max_results: int = 3) -> list[dict]:
    """Return a SMALL set of grounded official sources, stopping at the first good one.

    Strategy (kept deliberately simple, per product goal):
      1. If the query matches a curated official topic, fetch the FIRST curated
         link. If that page yields good content, return it immediately and stop.
      2. Otherwise search official hosts only and return the FIRST result that
         fetches into usable content. Stop as soon as one good source is found.
    A couple of extra context items are appended only when the first source is
    thin, so the model still has something to ground on.
    """
    out: list[dict] = []

    # 1) curated official topic — try the first link and stop early if it's good.
    for item in DIRECT_TOPICS.get(_topic(query), []):
        page = fetch(item["url"], 1800)
        text = page if is_useful_text(page) else item["snippet"]
        record = {
            "id": item["id"], "title": item["title"], "url": item["url"],
            "snippet": text, "text": text, "source": "official-web",
        }
        out.append(record)
        if is_useful_text(page):
            return out[:1]  # first curated link was good — stop here.
        if len(out) >= max_results:
            break
    if out:
        return out[:max_results]

    # 2) official web search — keep the first result that fetches good content.
    region_hint = "Bayern" if lang == "de" else "Bavaria"
    for r in _ddg(f"{query} {region_hint} Germany official", max(max_results * 4, 8)):
        url = r.get("url", "")
        if not is_official_url(url):
            continue
        if is_blocked_text(f"{r.get('title', '')} {r.get('snippet', '')}"):
            continue
        page = fetch(url, 1800)
        text = page if is_useful_text(page) else r.get("snippet", "")
        if not text:
            continue
        record = {
            "id": "", "title": r.get("title", "Official source"), "url": url,
            "snippet": text, "text": text, "source": "official-web",
        }
        out.append(record)
        if is_useful_text(page):
            return out[:1]  # first good official page — stop.
        if len(out) >= max_results:
            break
    return out[:max_results]



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
