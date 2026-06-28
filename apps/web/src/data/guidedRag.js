import { GUIDED_FLOW_RESULT_ID } from './guidedFlow'

const STOP = new Set([
  'the', 'and', 'for', 'with', 'you', 'your', 'are', 'can', 'how', 'what',
  'when', 'where', 'from', 'into', 'this', 'that', 'will', 'visa',
])

const DOCS = [
  {
    id: 'anmeldung',
    title: 'Registering your address (Anmeldung)',
    origin: 'municipality',
    tags: ['topic:registration'],
    updatedAt: '2026-06-12',
    text: 'Within 14 days of moving into a home in Germany you must register your address at the local Buergeramt. You need your passport or ID, a landlord confirmation and usually your rental contract. After registering you receive a registration certificate.',
  },
  {
    id: 'residence',
    title: 'Residence permits overview',
    origin: 'bamf',
    tags: ['topic:residence'],
    updatedAt: '2026-06-20',
    text: 'A residence permit determines how long you may stay in Germany and whether you may work or study. Typical documents include a valid passport, a biometric photo, proof of health insurance and proof of income or enrolment.',
  },
  {
    id: 'studies',
    title: 'Residence for studies',
    origin: 'federal',
    tags: ['topic:residence', 'topic:study', 'status:student'],
    updatedAt: '2026-06-15',
    text: 'People who want to study at a recognised higher education institution usually need admission or conditional admission, proof that their livelihood is secured, and health insurance.',
  },
  {
    id: 'skilled_work',
    title: 'Skilled work and EU Blue Card routes',
    origin: 'federal',
    tags: ['topic:work', 'topic:residence', 'status:worker'],
    updatedAt: '2026-06-18',
    text: 'Residence routes for skilled work depend on the job, recognised qualifications, salary, and whether the employment is qualified. Typical documents include an employment contract or concrete job offer.',
  },
  {
    id: 'vocational_training',
    title: 'Vocational training residence route',
    origin: 'federal',
    tags: ['topic:work', 'topic:training', 'topic:residence'],
    updatedAt: '2026-06-14',
    text: 'People planning recognised vocational training in Germany may need a national visa or residence permit for training. The application normally depends on a training contract, secure livelihood and health insurance.',
  },
  {
    id: 'family_reunification',
    title: 'Family reunification',
    origin: 'bamf',
    tags: ['topic:family', 'topic:residence'],
    updatedAt: '2026-06-12',
    text: 'Family reunification allows close family members to join relatives in Germany when the legal requirements are met. Typical documents include a valid passport, marriage certificate or birth certificate and proof of the family member residence status in Germany.',
  },
  {
    id: 'opportunity_card',
    title: 'Opportunity Card for job search',
    origin: 'federal',
    tags: ['topic:work', 'topic:job_search', 'topic:residence'],
    updatedAt: '2026-06-16',
    text: 'The Opportunity Card can support a job search in Germany when the person meets the legal criteria. The route depends on qualification, points or recognised credentials, livelihood, and health insurance.',
  },
  {
    id: 'asylum',
    title: 'The asylum procedure',
    origin: 'bamf',
    tags: ['topic:asylum', 'status:asylum'],
    updatedAt: '2026-06-22',
    text: 'People seeking protection first report as asylum seekers and then lodge a formal application at a BAMF branch. You receive an arrival certificate and later an invitation to a personal interview.',
  },
  {
    id: 'work',
    title: 'Access to the labour market by residence status',
    origin: 'federal',
    tags: ['topic:work'],
    updatedAt: '2026-06-18',
    text: 'Whether you are allowed to work in Germany depends on your residence status and how long you have been in the country. Permission to work is recorded in your residence document.',
  },
  {
    id: 'integration',
    title: 'Integration and language courses',
    origin: 'bamf',
    tags: ['topic:language'],
    updatedAt: '2026-06-05',
    text: 'An integration course combines German language lessons with an orientation course about life in Germany. Completing a course can help with later steps such as finding work and permanent residence.',
  },
]

const DOCUMENT_PATTERNS = [
  ['passport', 'Valid passport', 'FileText', /\b(passport|pass|id)\b/i],
  ['biometric_photo', 'Biometric photo', 'FileText', /\b(biometric photo|photo)\b/i],
  ['health_insurance', 'Health insurance proof', 'FileText', /\b(health insurance|insurance)\b/i],
  ['income_or_livelihood', 'Proof of income or livelihood', 'FileText', /\b(income|livelihood|financing)\b/i],
  ['admission_or_enrolment', 'Admission or enrolment proof', 'GraduationCap', /\b(admission|enrolment|higher education)\b/i],
  ['job_or_training_contract', 'Job or training contract', 'BriefcaseBusiness', /\b(job offer|employment contract|training contract)\b/i],
  ['registration_certificate', 'Registration certificate', 'FileText', /\b(registration certificate|anmeldung)\b/i],
  ['family_certificate', 'Family relationship certificate', 'Users', /\b(marriage certificate|birth certificate)\b/i],
]

function defaultNext(nodeId) {
  if (nodeId === 'planning-visa') return 'planning-readiness'
  if (nodeId === 'planning-readiness') return 'planning-documents'
  if (nodeId === 'current-status') return 'current-goal'
  if (nodeId === 'current-goal') return 'current-documents'
  return GUIDED_FLOW_RESULT_ID
}

function words(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP.has(word))
}

function valueText(value) {
  if (Array.isArray(value)) return value.map(valueText).filter(Boolean).join(' ')
  if (value === null || value === undefined) return ''
  return String(value).replace(/[_-]+/g, ' ').trim()
}

function agePhrase(age) {
  const parsed = Number(age)
  if (!Number.isFinite(parsed)) return ''
  if (parsed < 16) return 'minor child school family reunification guardian protection'
  if (parsed < 18) return 'minor youth family school training guardian'
  return 'adult'
}

function guidedQuery(nodeId, answers, path) {
  const ageContext = agePhrase(answers.age)
  const isMinorContext = ageContext.startsWith('minor')
  const planningVisa = isMinorContext
    ? 'minor child family reunification school protection guardian residence Germany'
    : 'residence permit national visa studies vocational training skilled work family reunification asylum protection language course Germany'
  const hints = {
    'planning-visa': planningVisa,
    'planning-readiness': 'visa application readiness admission enrolment job offer training contract family documents proof livelihood health insurance',
    'planning-documents': 'visa residence documents passport biometric photo health insurance proof income enrolment birth certificate family documents',
    'current-status': 'residence status Aufenthaltstitel asylum protection work permission student family registration Germany',
    'current-goal': 'registration renewal residence permit work rights health insurance family benefits language integration appointment documents Germany',
    'current-documents': 'documents passport registration certificate residence document health insurance proof income rental contract appointment Germany',
  }
  const trail = path.map((item) => item.answerLabel || valueText(item.value)).join(' ')
  return [
    hints[nodeId] ?? 'Germany migration residence documents next step',
    ageContext,
    valueText(answers.locationIntent),
    valueText(answers.visaStatus),
    trail,
  ].join(' ')
}

function tagsFor(answers) {
  const tags = new Set()
  if (answers.locationIntent === 'planning_move') tags.add('topic:residence')
  if (answers.visaStatus === 'family') tags.add('topic:family')
  if (answers.visaStatus === 'asylum') tags.add('status:asylum')
  if (['work', 'skilled_work', 'blue_card', 'opportunity_card', 'vocational_training'].includes(answers.visaStatus)) {
    tags.add('topic:work')
  }
  return tags
}

function retrieve(query, answers, limit = 8) {
  const terms = words(query)
  const tags = tagsFor(answers)
  return DOCS
    .map((doc) => {
      const haystack = `${doc.title} ${doc.text}`.toLowerCase()
      const termScore = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 2 : 0), 0)
      const tagScore = doc.tags.reduce((sum, tag) => sum + (tags.has(tag) ? 1.5 : 0), 0)
      return { ...doc, score: termScore + tagScore }
    })
    .filter((doc) => doc.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

function firstSentence(text) {
  const compact = String(text ?? '').replace(/\s+/g, ' ').trim()
  const match = compact.match(/^(.{40,220}?[.!?])\s/)
  return (match?.[1] ?? compact.slice(0, 220)).trim()
}

function iconFor(doc) {
  const text = `${doc.title} ${doc.text}`.toLowerCase()
  if (/\b(work|job|employment|training|card)\b/.test(text)) return 'BriefcaseBusiness'
  if (/\b(study|education|language|course)\b/.test(text)) return 'GraduationCap'
  if (/\b(family|child|birth|marriage)\b/.test(text)) return 'Users'
  if (/\b(asylum|protection)\b/.test(text)) return 'ShieldCheck'
  return 'FileText'
}

function docSupportedByContext(doc, answers) {
  const age = Number(answers.age)
  if (!Number.isFinite(age) || age >= 16) return true
  const text = `${doc.title} ${doc.text}`.toLowerCase()
  return !/\b(higher education|university|skilled work|blue card|opportunity card|qualified employment|vocational training)\b/.test(text)
}

function topicOptions(docs, nodeId, answers) {
  const seen = new Set()
  return docs
    .filter((doc) => docSupportedByContext(doc, answers))
    .filter((doc) => {
      const key = doc.title.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((doc) => ({
      value: doc.id,
      label: doc.title,
      helper: firstSentence(doc.text),
      icon: iconFor(doc),
      badge: 'RAG source',
      next: defaultNext(nodeId),
      source: doc.title,
    }))
    .slice(0, 8)
}

function documentOptions(docs, nodeId) {
  const text = docs.map((doc) => `${doc.title}. ${doc.text}`).join('\n')
  const options = DOCUMENT_PATTERNS
    .filter(([, , , pattern]) => pattern.test(text))
    .map(([value, label, icon, pattern]) => {
      const source = docs.find((doc) => pattern.test(`${doc.title}. ${doc.text}`))?.title ?? 'Local RAG'
      return {
        value,
        label,
        helper: `Mentioned in RAG source: ${source}.`,
        icon,
        badge: 'From RAG',
        next: defaultNext(nodeId),
        source,
      }
    })
  if (nodeId === 'planning-readiness' && options.length) {
    options.push({
      value: 'still_exploring',
      label: 'Still exploring',
      helper: 'Use this when you do not yet have the source-mentioned proofs.',
      icon: 'Search',
      badge: 'RAG source',
      next: defaultNext(nodeId),
      source: 'Local RAG',
    })
  }
  return options.slice(0, 8)
}

export function buildPreviewGuidedOptions({ nodeId, answers = {}, path = [] }) {
  const docs = retrieve(guidedQuery(nodeId, answers, path), answers)
  const options = ['planning-readiness', 'planning-documents', 'current-documents'].includes(nodeId)
    ? documentOptions(docs, nodeId)
    : topicOptions(docs, nodeId, answers)
  return {
    options,
    generatedAt: new Date().toISOString(),
    provider: options.length ? 'local-rag-preview' : 'ai-unavailable',
    sources: docs.map((doc) => ({
      id: doc.id,
      title: doc.title,
      origin: doc.origin,
      updatedAt: doc.updatedAt,
      relevance: doc.score,
      excerpt: doc.text.slice(0, 240),
    })),
    trace: options.length
      ? ['Backend unavailable; generated explorable options from bundled local RAG preview. No internet used.']
      : ['Backend unavailable; local RAG preview did not contain options for this bubble.'],
  }
}
