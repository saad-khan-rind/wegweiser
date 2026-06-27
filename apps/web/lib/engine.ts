import type { Wallet, Station, AnswerResult, ActionCard } from "@/lib/types";
import { STATIONS, PROFILES, KB } from "@/data/content";
import { deriveTags, deidentify, kAnonymityGuard } from "@/lib/privacy";

export interface JourneyNode {
  station: Station;
  done: boolean;
  current: boolean;
}

/** Build the personalized route from the wallet, dropping stations that don't apply. */
export function buildJourney(w: Wallet): JourneyNode[] {
  const profile = w.profile ? PROFILES[w.profile] : PROFILES.arriving;
  const ids = profile.stationIds.filter((id) => {
    const st = STATIONS[id];
    if (!st) return false;
    if (st.requiresFlag && !w.flags.includes(st.requiresFlag)) return false;
    return true;
  });
  // family extras: if the user has children but isn't on the family profile,
  // surface the child-related stations too.
  if (w.hasChildren && w.profile !== "family") {
    for (const extra of ["childcare", "kindergeld"]) {
      if (!ids.includes(extra)) ids.push(extra);
    }
  }
  const firstUndone = ids.find((id) => !w.completed.includes(id));
  return ids.map((id) => ({
    station: STATIONS[id],
    done: w.completed.includes(id),
    current: id === firstUndone,
  }));
}

export function journeyProgress(nodes: JourneyNode[]): number {
  if (!nodes.length) return 0;
  const done = nodes.filter((n) => n.done).length;
  return Math.round((done / nodes.length) * 100);
}

// ---- Guided interview ------------------------------------------------------

export interface InterviewQuestion {
  id: string;
  prompt: string;
  options: { label: string; apply: (w: Wallet) => Wallet }[];
}

/**
 * The guided interview asks only what improves the answer, one question at a
 * time — selective disclosure. It never collects free identity text.
 */
export function nextInterviewQuestions(w: Wallet): InterviewQuestion[] {
  const qs: InterviewQuestion[] = [];
  if (!w.profile) {
    qs.push({
      id: "profile",
      prompt: "Which best describes you right now?",
      options: Object.values(PROFILES).map((p) => ({
        label: `${p.glyph}  ${p.label}`,
        apply: (ww) => ({ ...ww, profile: p.id }),
      })),
    });
    return qs; // ask profile first, alone
  }
  if (w.childrenCount === 0 && !w.flags.includes("answered_children")) {
    qs.push({
      id: "children",
      prompt: "Are you raising children in Germany?",
      options: [
        { label: "Yes", apply: (ww) => ({ ...ww, hasChildren: true, childrenCount: 1, flags: Array.from(new Set([...ww.flags, "has_children", "answered_children"])) }) },
        { label: "No", apply: (ww) => ({ ...ww, flags: Array.from(new Set([...ww.flags, "answered_children"])) }) },
        { label: "Skip", apply: (ww) => ww },
      ],
    });
  }
  if (!w.flags.includes("answered_work")) {
    qs.push({
      id: "work",
      prompt: "Do you have permission to work yet?",
      options: [
        { label: "Yes", apply: (ww) => ({ ...ww, flags: Array.from(new Set([...ww.flags, "answered_work"])) }) },
        { label: "Not yet", apply: (ww) => ({ ...ww, flags: Array.from(new Set([...ww.flags, "no_work_permit", "answered_work"])) }) },
        { label: "Not sure", apply: (ww) => ({ ...ww, flags: Array.from(new Set([...ww.flags, "answered_work"])) }) },
      ],
    });
  }
  return qs;
}

// ---- Free-form answering (on-device fallback) ------------------------------

function scoreEntry(query: string, keywords: string[]): number {
  const q = query.toLowerCase();
  let score = 0;
  for (const k of keywords) if (q.includes(k.toLowerCase())) score += 1;
  return score;
}

/**
 * Local, deterministic answer used when the AI backend isn't reachable, so the
 * live demo never breaks. Returns action cards, not a wall of text.
 */
export function answerLocally(rawQuery: string, w: Wallet): AnswerResult {
  const clean = deidentify(rawQuery);
  const tags = kAnonymityGuard(deriveTags(w));

  let best = KB[0];
  let bestScore = -1;
  for (const e of KB) {
    const s = scoreEntry(clean, e.keywords);
    if (s > bestScore) {
      best = e;
      bestScore = s;
    }
  }

  const escalate = /lawyer|deport|denied|rejected|abschieb|suicide|hurt myself|emergency|police/i.test(rawQuery);

  if (bestScore <= 0) {
    return {
      answer:
        "I couldn't find a confident answer in the official sources for that. A human counselor can help with this one.",
      cards: [
        { kind: "escalate", title: "Talk to a counselor", body: "Free, confidential migration counseling." },
        { kind: "explain", title: "Browse my journey instead" },
      ],
      sources: [],
      confidence: 0.2,
      deidentifiedQuery: clean,
      sentTags: tags,
      escalate: true,
      origin: "device",
    };
  }

  const cards: ActionCard[] = [...best.cards];
  if (escalate && !cards.some((c) => c.kind === "escalate")) {
    cards.push({ kind: "escalate", title: "Talk to a counselor", body: "This sounds important — a person can help." });
  }

  return {
    answer: best.answer,
    cards,
    sources: best.sources,
    confidence: escalate ? Math.min(best.confidence, 0.6) : best.confidence,
    deidentifiedQuery: clean,
    sentTags: tags,
    escalate,
    origin: "device",
  };
}

/** Turn a station's "Explain" action into action cards (on-device). */
export function explainStation(st: Station): AnswerResult {
  return {
    answer: st.summary,
    cards: [
      { kind: "checklist", title: "What you'll need", body: st.requiredDocs.join(" · ") },
      ...st.actions.filter((a) => a.kind !== "explain"),
    ],
    sources: st.sources,
    confidence: st.confidence,
    deidentifiedQuery: st.title,
    sentTags: [`station:${st.id}`],
    escalate: false,
    origin: "device",
  };
}
