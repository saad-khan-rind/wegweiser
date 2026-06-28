/**
 * Real backend client for the Wegweiser API (NestJS) + AI service.
 *
 * The base URL is resolved at RUNTIME from /config.js (written by the container
 * entrypoint from $API_URL), falling back to a Vite build-time env var and then
 * to same-origin. This mirrors the original deployment contract so the image
 * can be pointed at any API without a rebuild.
 */

function runtimeConfig() {
  if (typeof window !== 'undefined' && window.__WEGWEISER_CONFIG__) {
    return window.__WEGWEISER_CONFIG__
  }
  return null
}

export function apiBase() {
  const cfg = runtimeConfig()
  if (cfg?.apiUrl) return String(cfg.apiUrl).replace(/\/$/, '')
  const envUrl = import.meta?.env?.VITE_API_URL
  if (envUrl) return String(envUrl).replace(/\/$/, '')
  return ''
}

export function apiConfigured() {
  return Boolean(apiBase())
}

function timeoutMs() {
  const cfg = runtimeConfig()
  if (cfg?.timeoutMs) return Number(cfg.timeoutMs)
  return 200000
}

function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

// --- localized micro-strings (assistant answers already come back in the
// user's language; these are only the connective UI lines) -----------------
const STRINGS = {
  en: {
    introCompleted: "Here's what I found in the official sources:",
    introNeedsInfo: 'Before I can give you tailored steps, I need a few details:',
    summary: 'Summary',
    documents: 'Documents to prepare',
    steps: 'Steps to follow',
    booking: 'Booking & appointment',
    sources: 'Official sources',
    escalateTitle: 'Talk to a counselor',
    escalateBody:
      'This topic can involve legal, medical, or otherwise sensitive matters. A counselor can help you for free and confidentially.',
    sourcesBody: 'These official sources were used to build this answer.',
    unavailable:
      "I can't reach the assistant service right now, so I can't give a verified answer from the official sources. Please try again in a moment.",
  },
  de: {
    introCompleted: 'Das habe ich in den offiziellen Quellen gefunden:',
    introNeedsInfo: 'Bevor ich dir passende Schritte geben kann, brauche ich ein paar Angaben:',
    summary: 'Zusammenfassung',
    documents: 'Benötigte Dokumente',
    steps: 'Schritte',
    booking: 'Termin & Buchung',
    sources: 'Offizielle Quellen',
    escalateTitle: 'Mit einer Beratung sprechen',
    escalateBody:
      'Dieses Thema kann rechtliche, medizinische oder anderweitig sensible Aspekte haben. Eine Beratungsstelle hilft dir kostenlos und vertraulich.',
    sourcesBody: 'Diese offiziellen Quellen wurden für diese Antwort verwendet.',
    unavailable:
      'Ich kann den Assistenzdienst gerade nicht erreichen und daher keine geprüfte Antwort aus den offiziellen Quellen geben. Bitte versuche es gleich noch einmal.',
  },
}

function lang(code) {
  return code === 'de' ? 'de' : 'en'
}

// --- answer parsing --------------------------------------------------------
const HEADER_MAP = [
  { key: 'summary', phrases: ['summary', 'zusammenfassung', 'überblick', 'ueberblick', 'overview', 'kurzfassung'] },
  {
    key: 'documents',
    phrases: [
      'document checklist', 'dokumenten-checkliste', 'dokumentencheckliste', 'benötigte dokumente',
      'benoetigte dokumente', 'required documents', 'dokumente', 'unterlagen', 'checklist', 'checkliste',
    ],
  },
  {
    key: 'steps',
    phrases: [
      'actionable steps', 'action steps', 'next steps', 'steps', 'nächste schritte', 'naechste schritte',
      'schritte', 'vorgehen', 'ablauf',
    ],
  },
  {
    key: 'booking',
    phrases: [
      'booking', 'appointment', 'appointments', 'termin', 'termine', 'terminbuchung', 'buchung',
      'book an appointment',
    ],
  },
  { key: 'sources', phrases: ['sources', 'quellen'] },
]

function matchHeader(line) {
  const cleaned = line
    .replace(/^[#*\->\s]+/, '')
    .replace(/\*+/g, '')
    .replace(/[:：]\s*$/, '')
    .trim()
    .toLowerCase()
  if (!cleaned || cleaned.length > 40) return null
  for (const entry of HEADER_MAP) {
    for (const phrase of entry.phrases) {
      if (cleaned === phrase || cleaned.startsWith(`${phrase} `)) return entry.key
    }
  }
  return null
}

function isListItem(line) {
  return /^\s*([-*•]|\d+[.)])\s+/.test(line)
}

function stripMarker(line) {
  return line.replace(/^\s*([-*•]|\d+[.)])\s+/, '').trim()
}

function parseSections(answer) {
  const text = String(answer || '').replace(/\r/g, '')
  const lines = text.split('\n')
  const sections = []
  let current = { key: 'summary', lines: [] }
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')
    const headerKey = matchHeader(line)
    if (headerKey) {
      if (current.lines.some((l) => l.trim())) sections.push(current)
      current = { key: headerKey, lines: [] }
    } else {
      current.lines.push(line)
    }
  }
  if (current.lines.some((l) => l.trim())) sections.push(current)
  return sections
}

function sectionParagraph(section) {
  return section.lines
    .filter((l) => l.trim() && !isListItem(l))
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function repeatedSentenceKey(sentence) {
  const text = String(sentence ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
  if (
    text.startsWith('typical documents include') ||
    text.startsWith('typische dokumente') ||
    text.startsWith('typische unterlagen')
  ) {
    return 'typical-documents'
  }
  return text
}

function compactRepeatedSummary(text) {
  const sentences = String(text ?? '').match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? []
  const seen = new Set()
  const kept = []

  for (const sentence of sentences) {
    const clean = sentence.replace(/\s+/g, ' ').trim()
    if (!clean) continue

    const key = repeatedSentenceKey(clean)
    if (seen.has(key)) continue

    seen.add(key)
    kept.push(clean)
  }

  return kept.join(' ').trim()
}

function sectionList(section) {
  return section.lines.filter(isListItem).map(stripMarker).filter(Boolean)
}

function sourceHref(s) {
  const base = apiBase()
  const url = s.url || s.href || ''
  if (url.startsWith('http')) return url
  if (url.startsWith('/api/')) return `${base}${url}`
  if (s.id) return `${base}/api/source/${encodeURIComponent(s.id)}`
  return undefined
}

function buildCardsFromAnswer(data, code) {
  const s = STRINGS[lang(code)]
  const sections = parseSections(data.answer)
  const cards = []

  const summarySection = sections.find((x) => x.key === 'summary')
  const summaryBody = summarySection ? compactRepeatedSummary(sectionParagraph(summarySection)) : ''
  if (summaryBody) {
    cards.push({
      id: 'overview',
      title: s.summary,
      description: summaryBody.length > 120 ? `${summaryBody.slice(0, 117)}…` : summaryBody,
      icon: 'Sparkles',
      status: 'recommended',
      category: 'summary',
      classification: 'advisable',
      content: { body: summaryBody },
    })
  }

  const docSection = sections.find((x) => x.key === 'documents')
  if (docSection) {
    const items = sectionList(docSection)
    const body = sectionParagraph(docSection)
    cards.push({
      id: 'documents',
      title: s.documents,
      description: body || `${items.length} item(s) to bring.`,
      icon: 'FileText',
      status: 'ready',
      category: 'documents',
      classification: 'actionable',
      content: {
        ...(body ? { body } : {}),
        ...(items.length ? { items: items.map((text) => ({ text, status: 'info' })) } : {}),
      },
    })
  }

  const stepSection = sections.find((x) => x.key === 'steps')
  if (stepSection) {
    const steps = sectionList(stepSection)
    const body = sectionParagraph(stepSection)
    cards.push({
      id: 'process',
      title: s.steps,
      description: body || `${steps.length} step(s).`,
      icon: 'ListChecks',
      status: 'ready',
      category: 'process',
      classification: 'actionable',
      content: {
        ...(body ? { body } : {}),
        ...(steps.length ? { steps } : {}),
      },
    })
  }

  const bookingSection = sections.find((x) => x.key === 'booking')
  if (bookingSection) {
    const steps = sectionList(bookingSection)
    const body = sectionParagraph(bookingSection)
    cards.push({
      id: 'appointment',
      title: s.booking,
      description: body || s.booking,
      icon: 'Calendar',
      status: 'recommended',
      category: 'office',
      classification: 'actionable',
      content: {
        ...(body ? { body } : {}),
        ...(steps.length ? { steps } : {}),
      },
    })
  }

  // Structured citations from the backend become a single sources card.
  const sources = Array.isArray(data.sources) ? data.sources : []
  const sourceLinks = sources
    .map((src) => ({ label: src.title || src.origin || 'Source', url: sourceHref(src) }))
    .filter((x) => x.label)
  if (sourceLinks.length) {
    cards.push({
      id: 'sources',
      title: s.sources,
      description: s.sourcesBody,
      icon: 'ExternalLink',
      status: 'ready',
      category: 'sources',
      classification: 'advisable',
      content: { body: s.sourcesBody, sources: sourceLinks },
    })
  }

  // No structured sections at all → keep the raw answer as a single card so
  // nothing is ever dropped.
  if (!cards.length && String(data.answer || '').trim()) {
    cards.push({
      id: 'overview',
      title: s.summary,
      description: '',
      icon: 'Sparkles',
      status: 'recommended',
      category: 'summary',
      classification: 'advisable',
      content: { body: String(data.answer).trim() },
    })
  }

  if (data.escalate) {
    cards.push({
      id: 'escalate',
      title: s.escalateTitle,
      description: s.escalateBody,
      icon: 'AlertCircle',
      status: 'recommended',
      category: 'other',
      classification: 'advisable',
      content: { body: s.escalateBody },
    })
  }

  return cards
}

function mapClarifyingQuestions(list) {
  if (!Array.isArray(list)) return []
  return list
    .map((q) => {
      const options = Array.isArray(q.options)
        ? q.options
            .map((o) => ({ value: String(o.value ?? ''), label: String(o.label ?? o.value ?? '') }))
            .filter((o) => o.value)
        : []
      return {
        id: String(q.id ?? ''),
        // GuidedStepPanel renders a <select> for 'select', a radio group otherwise.
        type: options.length > 4 ? 'select' : 'radio',
        question: String(q.question ?? ''),
        required: q.required !== false,
        options,
      }
    })
    .filter((q) => q.id && q.question && q.options.length)
}

function mergeQuestionDefs(prior, next) {
  const byId = new Map()
  for (const q of prior ?? []) byId.set(q.id, q)
  for (const q of next ?? []) byId.set(q.id, q)
  return Array.from(byId.values())
}

function resolveAnsweredQuestions(defs, answers) {
  return (defs ?? [])
    .filter((q) => answers && answers[q.id] != null)
    .map((q) => {
      const value = answers[q.id]
      const option = q.options?.find((o) => o.value === value)
      return {
        questionId: q.id,
        question: q.question,
        answerValue: value,
        answerLabel: option?.label ?? value,
      }
    })
}

function compactFollowUps(followUpPrompts = []) {
  return followUpPrompts
    .map((f) => (typeof f === 'string' ? f : f?.text))
    .filter(Boolean)
    .slice(-8)
}

function buildAssistantExtraContext({ intent, originalPrompt, answers, followUpPrompts, questionDefs, priorAnswer }) {
  const answeredQuestions = resolveAnsweredQuestions(questionDefs, answers)
  const followUps = compactFollowUps(followUpPrompts)
  const lines = [
    'Assistant session context:',
    `- intent: ${intent || 'general'}`,
  ]

  if (originalPrompt) {
    lines.push(`- original goal: ${originalPrompt}`)
  }

  if (answeredQuestions.length) {
    lines.push('Answered clarifying questions:')
    for (const item of answeredQuestions) {
      lines.push(`- ${item.question}: ${item.answerLabel}`)
    }
  }

  if (followUps.length) {
    lines.push('Previous follow-up prompts:')
    followUps.forEach((text, index) => {
      lines.push(`${index + 1}. ${text}`)
    })
  }

  // Carry the gist of the previous answer so a follow-up like "what documents?"
  // keeps its thread instead of starting cold.
  if (priorAnswer) {
    const compact = String(priorAnswer).replace(/\s+/g, ' ').trim().slice(0, 700)
    if (compact) {
      lines.push('Previous assistant answer (for context, do not repeat verbatim):')
      lines.push(compact)
    }
  }

  return lines.join('\n').slice(0, 2600)
}

/**
 * Calls POST /api/chat and maps the response into the shape the assistant UI
 * already understands ({ meta, status, intro, contextSummary, guidedQuestions,
 * cards, walletBundle }). Returns { response, questionDefs } so the caller can
 * persist the (dynamic) clarifying-question catalog across follow-ups.
 */
export async function requestAssistant({
  prompt,
  intent = 'general',
  answers = {},
  followUpPrompts = [],
  language = 'en',
  region = '',
  questionDefs = [],
  originalPrompt = '',
  priorAnswer = '',
}) {
  const code = lang(language)
  const s = STRINGS[code]
  const meta = { requestId: uuid(), generatedAt: new Date().toISOString(), intent, version: '1.0' }
  const base = apiBase()
  const extraContext = buildAssistantExtraContext({ intent, originalPrompt, answers, followUpPrompts, questionDefs, priorAnswer })

  let data = null
  if (base) {
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), timeoutMs())
      const res = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: prompt,
          tags: [],
          region,
          language: code,
          extraContext,
          clarifyingAnswers: answers,
        }),
        signal: ctrl.signal,
      })
      clearTimeout(timer)
      if (res.ok) data = await res.json()
    } catch {
      data = null
    }
  }

  // Service unreachable / not configured → graceful, still-functional fallback.
  if (!data) {
    const followUps = compactFollowUps(followUpPrompts)
    const contextSummary = {
      userPrompt: prompt,
      intent,
      answeredQuestions: resolveAnsweredQuestions(questionDefs, answers),
      followUpPrompts: followUps,
    }
    const cards = [
      {
        id: 'escalate',
        title: s.escalateTitle,
        description: s.unavailable,
        icon: 'AlertCircle',
        status: 'recommended',
        category: 'other',
        classification: 'advisable',
        content: { body: s.unavailable },
      },
    ]
    return {
      response: {
        meta,
        status: 'completed',
        intro: s.unavailable,
        contextSummary,
        guidedQuestions: null,
        cards,
        walletBundle: { bundleId: uuid(), title: prompt.slice(0, 100), generatedAt: meta.generatedAt, contextSummary, cards },
        escalate: true,
      },
      questionDefs,
    }
  }

  const newDefs = mapClarifyingQuestions(data.clarifyingQuestions)
  const mergedDefs = mergeQuestionDefs(questionDefs, newDefs)
  const followUps = compactFollowUps(followUpPrompts)
  const contextSummary = {
    userPrompt: prompt,
    intent,
    answeredQuestions: resolveAnsweredQuestions(mergedDefs, answers),
    followUpPrompts: followUps,
  }

  // Backend still needs clarifying input → drive the guided step panel.
  if (data.needsInput && newDefs.length) {
    return {
      response: {
        meta,
        status: 'needs_more_info',
        intro: data.clarifyingQuestion || s.introNeedsInfo,
        contextSummary,
        guidedQuestions: newDefs,
        cards: [],
        walletBundle: null,
        escalate: Boolean(data.escalate),
      },
      questionDefs: mergedDefs,
    }
  }

  const cards = buildCardsFromAnswer(data, code)
  const summarySection = parseSections(data.answer).find((x) => x.key === 'summary')
  const answerSummary = summarySection ? sectionParagraph(summarySection) : String(data.answer || '').trim()
  return {
    response: {
      meta,
      status: 'completed',
      intro: s.introCompleted,
      contextSummary,
      guidedQuestions: null,
      cards,
      answerSummary,
      walletBundle: {
        bundleId: uuid(),
        title: prompt.slice(0, 100),
        generatedAt: meta.generatedAt,
        contextSummary,
        cards,
      },
      escalate: Boolean(data.escalate),
      confidence: typeof data.confidence === 'number' ? data.confidence : undefined,
    },
    questionDefs: mergedDefs,
  }
}

export async function requestGuidedFlowAdvice({
  answers = {},
  path = [],
  language = 'en',
  region = '',
}) {
  const code = lang(language)
  const s = STRINGS[code]
  const meta = {
    requestId: uuid(),
    generatedAt: new Date().toISOString(),
    intent: 'guided-flow',
    version: '1.0',
  }
  const base = apiBase()
  if (!base) return null

  let data = null
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs())
    const res = await fetch(`${base}/api/guided-flow/recommendation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        answers,
        path,
        region,
        language: code,
      }),
      signal: ctrl.signal,
    })
    clearTimeout(timer)
    if (res.ok) data = await res.json()
  } catch {
    data = null
  }

  if (!data) return null

  const answeredQuestions = (Array.isArray(data.contextPath) ? data.contextPath : path)
    .map((item) => ({
      questionId: String(item.answerKey ?? item.nodeId ?? ''),
      question: String(item.question ?? ''),
      answerValue: Array.isArray(item.value) ? item.value.join(', ') : String(item.value ?? ''),
      answerLabel: String(item.answerLabel ?? item.label ?? item.value ?? ''),
    }))
    .filter((item) => item.questionId || item.question || item.answerLabel)

  const contextSummary = {
    userPrompt: data.prompt || answeredQuestions.map((item) => item.answerLabel).join(' -> '),
    intent: 'guided-flow',
    answeredQuestions,
    followUpPrompts: [],
  }

  const cards = buildCardsFromAnswer(data, code)
  return {
    meta,
    status: 'completed',
    intro: s.introCompleted,
    contextSummary,
    guidedQuestions: null,
    cards,
    walletBundle: {
      bundleId: uuid(),
      title: contextSummary.userPrompt?.slice(0, 100) || 'Guided flow',
      generatedAt: meta.generatedAt,
      contextSummary,
      cards,
    },
    escalate: Boolean(data.escalate),
    confidence: typeof data.confidence === 'number' ? data.confidence : undefined,
    sources: data.sources ?? [],
  }
}

export async function requestGuidedFlowOptions({
  nodeId,
  answers = {},
  path = [],
  language = 'en',
  region = '',
}) {
  const base = apiBase()
  if (!base || !nodeId) return null

  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs())
    const res = await fetch(`${base}/api/guided-flow/options`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodeId,
        answers,
        path,
        region,
        language: lang(language),
      }),
      signal: ctrl.signal,
    })
    clearTimeout(timer)
    if (!res.ok) return null
    const data = await res.json()
    const options = Array.isArray(data.options)
      ? data.options
          .map((option) => ({
            value: String(option.value ?? ''),
            label: String(option.label ?? option.value ?? ''),
            helper: String(option.helper ?? option.description ?? ''),
            icon: option.icon ? String(option.icon) : undefined,
            badge: option.badge ? String(option.badge) : undefined,
            next: option.next ? String(option.next) : undefined,
            set: option.set && typeof option.set === 'object' ? option.set : undefined,
            source: option.source ? String(option.source) : undefined,
          }))
          .filter((option) => option.value && option.label)
      : []
    return {
      options,
      generatedAt: data.generatedAt || new Date().toISOString(),
      provider: data.provider || 'guided-options',
      sources: Array.isArray(data.sources) ? data.sources : [],
      trace: Array.isArray(data.trace) ? data.trace : [],
    }
  } catch {
    return null
  }
}

// =========================================================================
// Admin + auth API
// =========================================================================

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function jsonOrThrow(res, fallbackMsg) {
  if (res.ok) return res.json()
  let detail = ''
  try {
    const body = await res.json()
    detail = body?.message || body?.error || ''
  } catch {
    /* ignore */
  }
  throw new Error(detail || `${fallbackMsg} (${res.status})`)
}

export async function adminLogin(email, password) {
  const base = apiBase()
  if (!base) throw new Error('API URL is not configured')
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  return jsonOrThrow(res, 'Login failed')
}

export async function adminVerify(token) {
  const base = apiBase()
  if (!base) throw new Error('API URL is not configured')
  const res = await fetch(`${base}/api/auth/me`, { headers: { ...authHeaders(token) } })
  return jsonOrThrow(res, 'Token check failed')
}

export async function getHealth() {
  const base = apiBase()
  if (!base) throw new Error('API URL is not configured')
  const res = await fetch(`${base}/api/health`)
  return jsonOrThrow(res, 'Health check failed')
}

export async function listDocuments(token) {
  const base = apiBase()
  const res = await fetch(`${base}/api/admin/documents`, { headers: { ...authHeaders(token) } })
  return jsonOrThrow(res, 'List failed')
}

export async function clearDocuments(token) {
  const base = apiBase()
  const res = await fetch(`${base}/api/admin/documents`, {
    method: 'DELETE',
    headers: { ...authHeaders(token) },
  })
  return jsonOrThrow(res, 'Clear failed')
}

export async function ingestText(meta, token) {
  const base = apiBase()
  const res = await fetch(`${base}/api/admin/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify(meta),
  })
  return jsonOrThrow(res, 'Ingest failed')
}

export async function ingestFile(file, meta, token) {
  const base = apiBase()
  const form = new FormData()
  form.append('file', file)
  form.append('title', meta.title || file.name)
  form.append('source', meta.source || 'admin upload')
  form.append('url', meta.url || '')
  form.append('date', meta.date || '')
  const res = await fetch(`${base}/api/admin/ingest-file`, {
    method: 'POST',
    headers: { ...authHeaders(token) },
    body: form,
  })
  return jsonOrThrow(res, 'Upload failed')
}

export async function refreshCrawl(region, language, token, url = '') {
  const base = apiBase()
  const res = await fetch(`${base}/api/admin/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({ region, lang: language, url }),
  })
  return jsonOrThrow(res, 'Refresh failed')
}
