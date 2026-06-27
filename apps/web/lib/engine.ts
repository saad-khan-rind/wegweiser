import type { Wallet, Station, AnswerResult } from "@/lib/types";
import { STATIONS, PROFILES } from "@/data/content";

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
