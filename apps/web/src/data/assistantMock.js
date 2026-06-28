/**
 * Assistant UI helpers.
 *
 * The simulated/dummy assistant responses have been removed — answers now come
 * live from the backend AI service via `src/services/apiClient.js`
 * (`requestAssistant`). What remains here are pure, presentation-only helpers
 * the UI still relies on: intent labelling, deterministic card ordering, the
 * session-level summary model, and the seed prompts/goal tiles shown on entry.
 */

const RESIDENCE = /residence|permit|aufenthalt|visa|immigration|ausländer|auslander|titel|renew/i
const ANMELDUNG = /anmeldung|register|address|melde/i
const WORK = /work|job|employment|arbeit|blue card/i

/**
 * Lightweight, local intent classification. Used only to label/organize the
 * session in the UI (the actual answer is produced by the backend), so a coarse
 * heuristic is sufficient.
 */
export function detectIntent(prompt) {
  const text = String(prompt ?? '').trim().toLowerCase()
  if (RESIDENCE.test(text)) return 'residence'
  if (ANMELDUNG.test(text)) return 'anmeldung'
  if (WORK.test(text)) return 'work'
  return 'general'
}

/**
 * Fixed category ranking for action cards. Lower rank renders first.
 * summary < documents < office < process < timeline < other < sources
 */
const CATEGORY_RANK = {
  summary: 0,
  documents: 1,
  office: 2,
  process: 3,
  timeline: 4,
  other: 5,
  sources: 6,
}

/**
 * Pure helper: returns a permutation of `cards` sorted by the fixed category
 * rank. Absent categories are naturally omitted (nothing is injected), the
 * relative order within an equal rank is preserved (stable), and no card is
 * ever dropped. Cards with an unknown/missing category sort with `other`.
 *
 * @param {Array<{ category?: string }>} cards
 * @returns {Array<object>}
 */
export function orderActionCards(cards) {
  const list = Array.isArray(cards) ? cards : []
  const rankOf = (card) => {
    const rank = CATEGORY_RANK[card?.category]
    return rank === undefined ? CATEGORY_RANK.other : rank
  }
  return list
    .map((card, index) => ({ card, index }))
    .sort((a, b) => {
      const diff = rankOf(a.card) - rankOf(b.card)
      // Preserve original relative order within equal ranks (stable sort).
      return diff !== 0 ? diff : a.index - b.index
    })
    .map((entry) => entry.card)
}

function dedupeCards(cards) {
  const seen = new Set()
  const out = []
  for (const card of Array.isArray(cards) ? cards : []) {
    const key = String(card?.id || card?.title || '').trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(card)
  }
  return out
}

/**
 * Derives a simple urgency indicator. With live backend answers we no longer
 * have a structured deadline field, so urgency is driven by the backend's
 * `escalate` signal: an escalated topic is flagged as important, otherwise no
 * deadline is shown. Localized labels keep the German UI free of English text.
 */
function summaryUrgency(escalate, language) {
  const de = language === 'de'
  if (escalate) {
    return {
      level: 'urgent',
      label: de ? 'Wichtig' : 'Important',
      detail: de
        ? 'Dieses Thema kann persönliche oder rechtliche Beratung erfordern — eine Beratungsstelle kann helfen.'
        : 'This may need personal or legal advice — consider talking to a counselor.',
      colorToken: 'text-red-600',
    }
  }
  return {
    level: 'none',
    label: de ? 'Keine Frist' : 'No deadline',
    detail: null,
    colorToken: 'text-slate-400',
  }
}

/**
 * Pure helper producing the `SummaryCardModel` rendered in the pinned summary
 * slot. Recaps the selected goal and answered questions, surfaces the single
 * most important next action (the first `actionable` card in canonical order),
 * and an urgency indicator.
 *
 * `answeredQuestions` is supplied directly (resolved upstream from the dynamic
 * clarifying-question catalog) rather than derived from a hardcoded catalog.
 *
 * @param {{
 *   goalLabel?: string|null,
 *   answeredQuestions?: Array<{ questionId?: string, question: string, answerLabel: string }>,
 *   cards?: Array<object>,
 *   escalate?: boolean,
 *   language?: string,
 *   discussionCity?: string,
 * }} [params]
 */
export function buildSummaryCard({
  goalLabel,
  answeredQuestions = [],
  cards = [],
  escalate = false,
  language = 'en',
  discussionCity = 'München',
} = {}) {
  const normalizedAnswered = (answeredQuestions ?? []).map((q) => ({
    questionId: q.questionId,
    question: q.question,
    answerLabel: q.answerLabel,
  }))

  const hasGoal = Boolean(goalLabel)
  const empty = !hasGoal && normalizedAnswered.length === 0

  const orderedCards = orderActionCards(dedupeCards(cards))
  const topActionable = orderedCards.find((card) => card?.classification === 'actionable')

  // A compact overview of the whole guide — every step in canonical order.
  const steps = orderedCards.map((card) => ({
    id: card.id,
    title: card.title,
    classification: card.classification ?? 'advisable',
  }))

  let verdict
  if (empty) {
    verdict = { text: '', fromCardId: null }
  } else if (topActionable) {
    // Just the next action; the SummaryCard renders a localized prefix label.
    verdict = { text: topActionable.title, fromCardId: topActionable.id }
  } else if (steps.length) {
    verdict = { text: steps[0].title, fromCardId: steps[0].id }
  } else {
    verdict = { text: '', fromCardId: null }
  }

  return {
    kind: 'summary',
    empty,
    goalLabel: goalLabel ?? null,
    discussionCity,
    answeredQuestions: normalizedAnswered,
    steps,
    verdict,
    urgency: summaryUrgency(escalate, language),
  }
}

export const PROMPT_SUGGESTIONS = [
  { id: 'residence', label: 'How do I get a residence permit?' },
  { id: 'anmeldung', label: 'How do I register my address?' },
  { id: 'renewal', label: 'How do I renew my visa?' },
  { id: 'work', label: 'Can I work while my permit is processing?' },
]

/**
 * A predefined, tappable goal presented on the Navigator entry view. Tiles
 * carry an explicit `intent`, so activating one maps deterministically to a
 * topic without invoking free-text classification. `seedPrompt` is the question
 * actually sent to the backend.
 *
 * @typedef {Object} GoalTileDef
 * @property {string} id
 * @property {'residence' | 'anmeldung' | 'work' | 'general'} intent
 * @property {string} icon - An `ASSISTANT_ICON_MAP` key.
 * @property {string} labelKey
 * @property {string} descriptionKey
 * @property {string} seedPrompt
 */

/** @type {GoalTileDef[]} */
export const GOAL_TILES = [
  {
    id: 'first_residence',
    intent: 'residence',
    icon: 'FileText',
    labelKey: 'goals.firstResidence.label',
    descriptionKey: 'goals.firstResidence.description',
    seedPrompt: 'How do I get my first residence permit?',
  },
  {
    id: 'register_address',
    intent: 'anmeldung',
    icon: 'Calendar',
    labelKey: 'goals.registerAddress.label',
    descriptionKey: 'goals.registerAddress.description',
    seedPrompt: 'How do I register my address (Anmeldung)?',
  },
  {
    id: 'renew_permit',
    intent: 'residence',
    icon: 'Clock',
    labelKey: 'goals.renewPermit.label',
    descriptionKey: 'goals.renewPermit.description',
    seedPrompt: 'How do I renew my residence permit?',
  },
  {
    id: 'work',
    intent: 'work',
    icon: 'Briefcase',
    labelKey: 'goals.work.label',
    descriptionKey: 'goals.work.description',
    seedPrompt: 'Can I work with my current permit?',
  },
  {
    id: 'change_status',
    intent: 'residence',
    icon: 'ListChecks',
    labelKey: 'goals.changeStatus.label',
    descriptionKey: 'goals.changeStatus.description',
    seedPrompt: 'How do I change my residence status?',
  },
  {
    id: 'something_else',
    intent: 'general',
    icon: 'Compass',
    labelKey: 'goals.somethingElse.label',
    descriptionKey: 'goals.somethingElse.description',
    seedPrompt: 'I need help with something else',
  },
]
