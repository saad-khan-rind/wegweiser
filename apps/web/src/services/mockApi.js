import { getFlowForNode } from '../data/flows'
import {
  GUIDED_FLOW_RESULT_ID,
  GUIDED_FLOW_START_ID,
  buildGuidedTrailLabel,
  getGuidedNode,
  getGuidedNodeOptions,
} from '../data/guidedFlow'
import { unlockNodesFromProfile } from '../data/documentRules'
import { TOTAL_AUSLANDER_STEPS } from '../data/auslanderInterview'
import { detectIntent, buildSummaryCard, orderActionCards } from '../data/assistantMock'
import { buildPreviewGuidedOptions } from '../data/guidedRag'
import { requestAssistant, requestGuidedFlowAdvice, requestGuidedFlowOptions } from './apiClient'

const STORAGE_KEY = 'migrant_assistant_guest'
const STORAGE_VERSION = 6
const DEFAULT_LOCALE = 'en'

const delay = (ms = 200) =>
  import.meta.env?.MODE === 'test'
    ? Promise.resolve()
    : new Promise((resolve) => setTimeout(resolve, ms))

function readStorage() {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function writeStorage(session) {
  // `setItem` is atomic: it either persists the full serialized session or
  // throws (e.g. QuotaExceededError). Any failure here propagates to the
  // caller and leaves the previously persisted session untouched, so no
  // partial write can occur (Req 10.5).
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
}

function defaultHelpFlow() {
  return {
    phase: 'choose',
    currentStep: 0,
    activeBubbleId: GUIDED_FLOW_START_ID,
    bubblePath: [],
    answers: {},
    guidedAdvice: null,
    optionCache: {},
    completed: false,
  }
}

function defaultNodes() {
  return {
    arrival: { status: 'locked' },
    'residence-permit': { status: 'locked' },
    'legal-rights': { status: 'locked' },
    'work-career': { status: 'locked' },
  }
}

function defaultAssistantState() {
  return {
    activeSessionId: null,
    sessions: [],
    wallet: [],
  }
}

function createDefaultSession() {
  return {
    schemaVersion: STORAGE_VERSION,
    sessionId: crypto.randomUUID(),
    mode: 'guest',
    locale: DEFAULT_LOCALE,
    activeNodeId: null,
    helpFlow: defaultHelpFlow(),
    assistant: defaultAssistantState(),
    nodes: defaultNodes(),
    createdAt: new Date().toISOString(),
  }
}

function isStructurallyValidSession(session) {
  return (
    !!session &&
    typeof session === 'object' &&
    typeof session.sessionId === 'string' &&
    session.sessionId.length > 0
  )
}

function migrateSession(session) {
  // Hard reset only when the stored blob is unparseable (already null by the
  // time it reaches here) or structurally invalid (not an object / missing a
  // usable sessionId). Everything else is upgraded in place.
  if (!isStructurallyValidSession(session)) {
    return {
      ...createDefaultSession(),
      sessionId: session?.sessionId ?? crypto.randomUUID(),
      locale: session?.locale ?? DEFAULT_LOCALE,
      createdAt: session?.createdAt ?? new Date().toISOString(),
    }
  }

  // Non-destructive upgrade: preserve all existing data (cardGroups, wallet,
  // answers, nodes, helpFlow) while back-filling any missing structure and the
  // fields introduced by newer schema versions.
  if (!session.helpFlow) {
    session.helpFlow = defaultHelpFlow()
  }
  session.helpFlow.activeBubbleId ??= GUIDED_FLOW_START_ID
  session.helpFlow.bubblePath ??= []
  session.helpFlow.guidedAdvice ??= null
  session.helpFlow.optionCache ??= {}
  session.helpFlow.answers ??= {}
  session.helpFlow.completed ??= false
  if (!session.nodes) {
    session.nodes = defaultNodes()
  }
  if (!session.assistant) {
    session.assistant = defaultAssistantState()
  }
  session.locale ??= DEFAULT_LOCALE
  if (!Array.isArray(session.assistant.sessions)) {
    session.assistant.sessions = []
  }
  if (!Array.isArray(session.assistant.wallet)) {
    session.assistant.wallet = []
  }

  // Back-fill the per-assistant-session fields added in schema v5.
  for (const assistantSession of session.assistant.sessions) {
    if (!assistantSession || typeof assistantSession !== 'object') continue
    assistantSession.intent ??= null
    assistantSession.cardCompletion ??= {}
  }

  session.schemaVersion = STORAGE_VERSION
  return session
}

function resetHelpFlow(session) {
  session.helpFlow = defaultHelpFlow()
  session.nodes = defaultNodes()
  session.activeNodeId = null
  return session
}

function ensureInterview(node) {
  if (!node.interview) {
    node.interview = { answers: {}, currentStep: 0, completed: false }
  }
  return node
}

function compactValue(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join(', ')
  if (value === null || value === undefined) return ''
  return String(value)
}

function buildUnavailableGuidedAdvice({ path = [], locale = DEFAULT_LOCALE }) {
  const isGerman = locale === 'de'
  const title = buildGuidedTrailLabel(path) || (isGerman ? 'Gefuehrter Weg' : 'Guided path')
  const body = isGerman
    ? 'Ich habe deinen Bubble-Pfad, aber der AI/RAG-Dienst konnte gerade keine quellenbasierte Anleitung erzeugen. Es wurde kein lokaler Visa-Plan erfunden.'
    : 'I have your bubble trail, but the AI/RAG service could not generate source-grounded guidance right now. No local visa plan was invented.'

  const cards = [
    {
      id: 'guided-ai-unavailable',
      title: isGerman ? 'AI/RAG nicht verfuegbar' : 'AI/RAG unavailable',
      description: body,
      icon: 'AlertCircle',
      status: 'recommended',
      category: 'other',
      classification: 'advisable',
      content: { body },
    },
  ]

  const contextSummary = {
    userPrompt: title,
    intent: 'guided-flow',
    answeredQuestions: path.map((item) => ({
      questionId: item.answerKey ?? item.nodeId,
      question: item.question,
      answerValue: compactValue(item.value),
      answerLabel: item.answerLabel,
    })),
    followUpPrompts: [],
  }

  return {
    meta: {
      requestId: crypto.randomUUID(),
      generatedAt: new Date().toISOString(),
      intent: 'guided-flow',
      version: 'local',
    },
    status: 'completed',
    intro: body,
    contextSummary,
    cards,
    walletBundle: {
      bundleId: crypto.randomUUID(),
      title,
      generatedAt: new Date().toISOString(),
      contextSummary,
      cards,
    },
    escalate: true,
  }
}

export const apiService = {
  initializeGuestSession: async ({ restartHelp = false } = {}) => {
    await delay(300)
    const existing = readStorage()
    if (existing?.sessionId) {
      let session = migrateSession(existing)
      if (restartHelp) {
        session = resetHelpFlow(session)
      }
      writeStorage(session)
      return session
    }
    const session = {
      ...createDefaultSession(),
      locale: existing?.locale ?? DEFAULT_LOCALE,
    }
    writeStorage(session)
    return session
  },

  fetchUserProgress: async () => {
    await delay()
    const session = readStorage()
    if (!session) return null
    const migrated = migrateSession(session)
    writeStorage(migrated)
    return migrated
  },

  setHelpPhase: async (phase) => {
    await delay()
    const session = readStorage()
    if (!session) throw new Error('No guest session')
    session.helpFlow = { ...session.helpFlow, phase }
    writeStorage(session)
    return session
  },

  startGuidedInterview: async () => {
    await delay()
    const session = readStorage()
    if (!session) throw new Error('No guest session')
    session.helpFlow = {
      phase: 'interview',
      currentStep: 0,
      activeBubbleId: GUIDED_FLOW_START_ID,
      bubblePath: [],
      answers: {},
      guidedAdvice: null,
      optionCache: {},
      completed: false,
    }
    writeStorage(session)
    return session
  },

  fetchGuidedBubbleOptions: async (nodeId) => {
    await delay(180)
    const session = readStorage()
    if (!session) throw new Error('No guest session')
    const helpFlow = session.helpFlow ?? defaultHelpFlow()
    const node = getGuidedNode(nodeId ?? helpFlow.activeBubbleId)

    if (!node || node.type === 'number' || node.type === 'result') {
      return { options: [], provider: 'none', generatedAt: new Date().toISOString() }
    }

    if (!node.requiresAiOptions) {
      const payload = {
        options: getGuidedNodeOptions(node, helpFlow.answers ?? {}),
        provider: 'local-structure',
        generatedAt: new Date().toISOString(),
        sources: [],
        trace: ['Static context question; no legal options generated locally.'],
      }
      helpFlow.optionCache = {
        ...(helpFlow.optionCache ?? {}),
        [node.id]: payload,
      }
      session.helpFlow = helpFlow
      writeStorage(session)
      return payload
    }

    const live = await requestGuidedFlowOptions({
      nodeId: node.id,
      answers: helpFlow.answers ?? {},
      path: helpFlow.bubblePath ?? [],
      language: session.locale ?? DEFAULT_LOCALE,
    })
    const hasLiveOptions = Array.isArray(live?.options) && live.options.length > 0
    const preview = hasLiveOptions
      ? null
      : buildPreviewGuidedOptions({
          nodeId: node.id,
          answers: helpFlow.answers ?? {},
          path: helpFlow.bubblePath ?? [],
          language: session.locale ?? DEFAULT_LOCALE,
        })
    const hasPreviewOptions = Array.isArray(preview?.options) && preview.options.length > 0
    const options = getGuidedNodeOptions(
      node,
      helpFlow.answers ?? {},
      hasLiveOptions ? live.options : hasPreviewOptions ? preview.options : [],
    )

    const payload = {
      options,
      provider: hasLiveOptions
        ? (live?.provider ?? 'guided-ai')
        : hasPreviewOptions
          ? preview.provider
          : 'ai-unavailable',
      generatedAt: live?.generatedAt ?? preview?.generatedAt ?? new Date().toISOString(),
      sources: hasLiveOptions ? (live?.sources ?? []) : (preview?.sources ?? []),
      trace: hasLiveOptions
        ? (live?.trace ?? [])
        : hasPreviewOptions
          ? [
              ...(live?.trace ?? []),
              ...(preview?.trace ?? []),
            ]
        : [
            ...(live?.trace ?? []),
            ...(preview?.trace ?? []),
            'AI/RAG did not return verified options; no local visa fallback was used.',
          ],
    }

    helpFlow.optionCache = {
      ...(helpFlow.optionCache ?? {}),
      [node.id]: payload,
    }
    session.helpFlow = helpFlow
    writeStorage(session)
    return payload
  },

  saveGuidedBubbleAnswer: async ({
    nodeId,
    nextNodeId,
    answerKey,
    value,
    answerLabel,
    question,
    patch = {},
  }) => {
    await delay()
    const session = readStorage()
    if (!session) throw new Error('No guest session')

    const helpFlow = session.helpFlow ?? defaultHelpFlow()
    const answers = {
      ...(helpFlow.answers ?? {}),
      ...patch,
      [answerKey]: value,
    }
    const compactPath = (helpFlow.bubblePath ?? []).filter((item) => item.nodeId !== nodeId)
    compactPath.push({
      id: crypto.randomUUID(),
      nodeId,
      answerKey,
      question,
      value,
      answerLabel,
      answeredAt: new Date().toISOString(),
    })

    helpFlow.answers = answers
    helpFlow.bubblePath = compactPath
    helpFlow.activeBubbleId = nextNodeId ?? GUIDED_FLOW_RESULT_ID
    helpFlow.currentStep = compactPath.length
    helpFlow.guidedAdvice = null
    helpFlow.completed = helpFlow.activeBubbleId === GUIDED_FLOW_RESULT_ID
    helpFlow.phase = 'interview'

    if (helpFlow.completed) {
      session.nodes = unlockNodesFromProfile(answers)
    }

    session.helpFlow = helpFlow
    writeStorage(session)
    return session
  },

  goBackGuidedBubble: async () => {
    await delay()
    const session = readStorage()
    if (!session) throw new Error('No guest session')

    const helpFlow = session.helpFlow ?? defaultHelpFlow()
    const path = [...(helpFlow.bubblePath ?? [])]
    const last = path.pop()
    if (!last) {
      helpFlow.activeBubbleId = GUIDED_FLOW_START_ID
      helpFlow.answers = {}
    } else {
      const answers = { ...(helpFlow.answers ?? {}) }
      delete answers[last.answerKey]
      if (last.answerKey === 'locationIntent') {
        delete answers.journeyStage
        delete answers.primaryGoal
      }
      helpFlow.answers = answers
      helpFlow.activeBubbleId = last.nodeId
      helpFlow.bubblePath = path
    }

    helpFlow.currentStep = helpFlow.bubblePath?.length ?? 0
    helpFlow.guidedAdvice = null
    helpFlow.completed = false
    helpFlow.phase = 'interview'
    session.helpFlow = helpFlow
    writeStorage(session)
    return session
  },

  resetGuidedBubbleFlow: async () => {
    await delay()
    const session = readStorage()
    if (!session) throw new Error('No guest session')
    session.helpFlow = {
      ...defaultHelpFlow(),
      phase: 'interview',
    }
    session.nodes = defaultNodes()
    session.activeNodeId = null
    writeStorage(session)
    return session
  },

  generateGuidedFlowAdvice: async () => {
    await delay(350)
    const session = readStorage()
    if (!session) throw new Error('No guest session')
    const helpFlow = session.helpFlow ?? defaultHelpFlow()
    const answers = helpFlow.answers ?? {}
    const path = helpFlow.bubblePath ?? []

    const response =
      (await requestGuidedFlowAdvice({
        answers,
        path,
        language: session.locale ?? DEFAULT_LOCALE,
      })) ??
      buildUnavailableGuidedAdvice({
        path,
        locale: session.locale ?? DEFAULT_LOCALE,
      })

    helpFlow.guidedAdvice = response
    helpFlow.completed = true
    helpFlow.activeBubbleId = GUIDED_FLOW_RESULT_ID
    helpFlow.phase = 'interview'
    session.helpFlow = helpFlow
    session.nodes = unlockNodesFromProfile(answers)
    writeStorage(session)
    return session
  },

  saveGuidedInterviewStep: async (stepIndex, stepAnswers) => {
    await delay()
    const session = readStorage()
    if (!session) throw new Error('No guest session')

    const answers = { ...session.helpFlow.answers, ...stepAnswers }
    const nextStep = stepIndex + 1
    const isLast = nextStep >= TOTAL_AUSLANDER_STEPS

    session.helpFlow = {
      ...session.helpFlow,
      answers,
      currentStep: isLast ? stepIndex : nextStep,
      phase: isLast ? 'interview' : 'interview',
    }

    if (isLast) {
      session.helpFlow.phase = 'results'
      session.helpFlow.completed = true
      session.nodes = unlockNodesFromProfile(answers)
    }

    writeStorage(session)
    return session
  },

  setGuidedInterviewStep: async (stepIndex) => {
    await delay()
    const session = readStorage()
    if (!session) throw new Error('No guest session')
    session.helpFlow.currentStep = stepIndex
    writeStorage(session)
    return session
  },

  completeGuidedInterview: async () => {
    await delay()
    const session = readStorage()
    if (!session) throw new Error('No guest session')
    session.helpFlow.phase = 'results'
    session.helpFlow.completed = true
    session.nodes = unlockNodesFromProfile(session.helpFlow.answers)
    writeStorage(session)
    return session
  },

  finishHelpFlow: async () => {
    await delay()
    const session = readStorage()
    if (!session) throw new Error('No guest session')
    session.helpFlow.phase = 'complete'
    writeStorage(session)
    return session
  },

  saveActiveNode: async (nodeId) => {
    await delay()
    const session = readStorage()
    if (!session) throw new Error('No guest session')
    session.activeNodeId = nodeId
    writeStorage(session)
    return session
  },

  saveInterviewAnswers: async (nodeId, stepIndex, answers) => {
    await delay()
    const session = readStorage()
    if (!session) throw new Error('No guest session')

    const node = ensureInterview(session.nodes[nodeId])
    node.interview.answers = { ...node.interview.answers, ...answers }
    node.interview.currentStep = stepIndex + 1
    writeStorage(session)
    return session
  },

  setInterviewStep: async (nodeId, stepIndex) => {
    await delay()
    const session = readStorage()
    if (!session) throw new Error('No guest session')

    const node = ensureInterview(session.nodes[nodeId])
    node.interview.currentStep = stepIndex
    writeStorage(session)
    return session
  },

  completeInterview: async (nodeId) => {
    await delay()
    const session = readStorage()
    if (!session) throw new Error('No guest session')

    const node = ensureInterview(session.nodes[nodeId])
    node.interview.completed = true
    if (node.status === 'active') {
      node.status = 'completed'
    }
    writeStorage(session)
    return session
  },

  fetchActionCards: async (nodeId) => {
    await delay()
    const session = readStorage()
    if (!session) throw new Error('No guest session')

    const flow = getFlowForNode(nodeId)
    const node = session.nodes[nodeId]
    const nodeAnswers = node?.interview?.answers ?? {}
    const profileDocs = session.helpFlow?.answers?.documentsHeld ?? []

    const selectedDocs = nodeAnswers.documents ?? profileDocs
    const requiredDocs = flow?.requiredDocuments ?? []

    const checklist = requiredDocs.map((docId) => ({
      id: docId,
      hasDocument: selectedDocs.includes(docId),
    }))

    const visaStatus =
      nodeAnswers.visaStatus ??
      session.helpFlow?.answers?.visaStatus ??
      null

    return {
      actions: flow?.actions ?? [],
      checklist,
      visaStatus,
      answers: nodeAnswers,
    }
  },

  saveLocale: async (locale) => {
    await delay(100)
    const session = readStorage()
    if (session) {
      session.locale = locale
      writeStorage(session)
    } else {
      writeStorage({ locale })
    }
    return locale
  },

  fetchLocale: async () => {
    await delay(100)
    const session = readStorage()
    return session?.locale ?? DEFAULT_LOCALE
  },

  // --- Assistant workspace ---

  getAssistantSessions: async () => {
    await delay(100)
    const session = readStorage()
    if (!session) throw new Error('No guest session')
    const migrated = migrateSession(session)
    writeStorage(migrated)
    return migrated.assistant
  },

  // Clears the assistant workspace conversation (sessions + active id) so the
  // Navigator starts from a clean entry view. Called once per page load so a
  // browser refresh resets the workspace. The saved wallet is preserved.
  clearAssistantSessions: async () => {
    const session = readStorage()
    if (!session) return defaultAssistantState()
    const migrated = migrateSession(session)
    migrated.assistant = {
      ...defaultAssistantState(),
      wallet: migrated.assistant?.wallet ?? [],
    }
    writeStorage(migrated)
    return migrated.assistant
  },

  submitAssistantPrompt: async ({ prompt, sessionId = null, intent = null }) => {
    await delay(600)
    const session = readStorage()
    if (!session) throw new Error('No guest session')

    const assistant = session.assistant ?? defaultAssistantState()
    let activeSession = sessionId
      ? assistant.sessions.find((s) => s.id === sessionId)
      : null

    if (!activeSession) {
      activeSession = {
        id: crypto.randomUUID(),
        title: prompt.slice(0, 60),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        originalPrompt: prompt,
        followUpPrompts: [],
        cardGroups: [],
        guidedAnswers: {},
        guidedQuestionDefs: [],
        guidedState: null,
        status: 'idle',
        // Establish the session's intent on creation (Req 7.4): an explicit
        // intent (e.g. from a goal tile) takes priority over free-text
        // classification of the prompt.
        intent: intent ?? detectIntent(prompt),
        cardCompletion: {},
      }
      assistant.sessions.unshift(activeSession)
      assistant.activeSessionId = activeSession.id
    } else {
      // Follow-up on an existing session: keep the established intent unless
      // re-detection (or an explicit override) yields a defined topic intent
      // that differs from it. The `general` fallback never displaces an
      // established intent (Req 7.1, 7.2, 7.3, 7.5).
      const detected = intent ?? detectIntent(prompt)
      if (detected !== 'general' && detected !== activeSession.intent) {
        activeSession.intent = detected
      }
    }

    // Live answer from the backend AI service. Returns the same response shape
    // the UI consumed before, plus the (dynamic) clarifying-question catalog to
    // persist across follow-ups so answer labels can be resolved.
    const { response, questionDefs } = await requestAssistant({
      prompt,
      intent: activeSession.intent,
      answers: activeSession.guidedAnswers ?? {},
      followUpPrompts: activeSession.followUpPrompts ?? [],
      language: session.locale ?? DEFAULT_LOCALE,
      questionDefs: activeSession.guidedQuestionDefs ?? [],
      originalPrompt: activeSession.originalPrompt ?? prompt,
    })
    activeSession.guidedQuestionDefs = questionDefs

    if (!activeSession.originalPrompt) {
      activeSession.originalPrompt = prompt
    } else if (activeSession.cardGroups.length > 0 || activeSession.guidedState) {
      activeSession.followUpPrompts.push({
        id: crypto.randomUUID(),
        text: prompt,
        createdAt: new Date().toISOString(),
      })
    }

    if (response.status === 'needs_more_info') {
      activeSession.guidedState = {
        intro: response.intro,
        guidedQuestions: response.guidedQuestions,
        contextSummary: response.contextSummary,
        meta: response.meta,
        status: response.status,
      }
      activeSession.status = 'needs_more_info'
    } else {
      activeSession.guidedState = null
      activeSession.cardGroups.push({
        id: crypto.randomUUID(),
        prompt,
        intro: response.intro,
        cards: response.cards,
        contextSummary: response.contextSummary,
        walletBundle: response.walletBundle,
        meta: response.meta,
        status: response.status,
        escalate: response.escalate ?? false,
        createdAt: new Date().toISOString(),
      })
      activeSession.status = 'completed'
    }

    activeSession.updatedAt = new Date().toISOString()
    activeSession.title = activeSession.originalPrompt.slice(0, 60)

    session.assistant = assistant
    writeStorage(session)
    return { session: activeSession, response }
  },

  submitGuidedAnswer: async ({ sessionId, questionId, value }) => {
    await delay(400)
    const session = readStorage()
    if (!session) throw new Error('No guest session')

    const assistant = session.assistant ?? defaultAssistantState()
    const activeSession = assistant.sessions.find((s) => s.id === sessionId)
    if (!activeSession) throw new Error('Assistant session not found')

    activeSession.guidedAnswers = {
      ...activeSession.guidedAnswers,
      [questionId]: value,
    }

    const { response, questionDefs } = await requestAssistant({
      prompt: activeSession.originalPrompt,
      intent: activeSession.intent,
      answers: activeSession.guidedAnswers,
      followUpPrompts: activeSession.followUpPrompts ?? [],
      language: session.locale ?? DEFAULT_LOCALE,
      questionDefs: activeSession.guidedQuestionDefs ?? [],
      originalPrompt: activeSession.originalPrompt,
    })
    activeSession.guidedQuestionDefs = questionDefs

    if (response.status === 'needs_more_info') {
      activeSession.guidedState = {
        intro: response.intro,
        guidedQuestions: response.guidedQuestions,
        contextSummary: response.contextSummary,
        meta: response.meta,
        status: response.status,
      }
      activeSession.status = 'needs_more_info'
    } else {
      activeSession.guidedState = null
      activeSession.cardGroups.push({
        id: crypto.randomUUID(),
        prompt: activeSession.originalPrompt,
        intro: response.intro,
        cards: response.cards,
        contextSummary: response.contextSummary,
        walletBundle: response.walletBundle,
        meta: response.meta,
        status: response.status,
        escalate: response.escalate ?? false,
        createdAt: new Date().toISOString(),
      })
      activeSession.status = 'completed'
    }

    activeSession.updatedAt = new Date().toISOString()
    session.assistant = assistant
    writeStorage(session)
    return { session: activeSession, response }
  },

  revertGuidedAnswer: async ({ sessionId, questionId }) => {
    await delay(50)
    const session = readStorage()
    if (!session) throw new Error('No guest session')

    const assistant = session.assistant ?? defaultAssistantState()
    const activeSession = assistant.sessions.find((s) => s.id === sessionId)
    if (!activeSession?.guidedState) return activeSession

    const questions = activeSession.guidedState.guidedQuestions ?? []
    const required = questions.filter((q) => q.required !== false)
    const idx = required.findIndex((q) => q.id === questionId)
    if (idx < 0) return activeSession

    const nextAnswers = { ...activeSession.guidedAnswers }
    for (let i = idx; i < required.length; i += 1) {
      delete nextAnswers[required[i].id]
    }
    activeSession.guidedAnswers = nextAnswers
    activeSession.updatedAt = new Date().toISOString()

    session.assistant = assistant
    writeStorage(session)
    return activeSession
  },

  addCardToWallet: async ({ sessionId, cardId, cardGroupId = null }) => {
    await delay(150)
    const session = readStorage()
    if (!session) throw new Error('No guest session')

    const assistant = session.assistant ?? defaultAssistantState()
    const activeSession = assistant.sessions.find((s) => s.id === sessionId)
    if (!activeSession) throw new Error('Assistant session not found')

    const groups = activeSession.cardGroups ?? []
    // Locate the card across ALL card groups so any visible group's cards can
    // be saved (Req 6.4). When an explicit cardGroupId is provided, target that
    // group; otherwise search every group for the one containing the card, and
    // fall back to the last group for backward compatibility.
    let cardGroup = null
    if (cardGroupId) {
      cardGroup = groups.find((g) => g.id === cardGroupId) ?? null
    } else {
      cardGroup =
        groups.find((g) => g.cards?.some((c) => c.id === cardId)) ??
        groups[groups.length - 1] ??
        null
    }
    const card = cardGroup?.cards?.find((c) => c.id === cardId)
    if (!card) throw new Error('Card not found')

    const existing = assistant.wallet.find(
      (w) => w.sessionId === sessionId && w.cardId === cardId,
    )
    if (existing) return { wallet: assistant.wallet, item: existing, added: false }

    const item = {
      id: crypto.randomUUID(),
      type: 'card',
      savedAt: new Date().toISOString(),
      title: card.title,
      sessionId,
      cardId,
      cardGroupId: cardGroup.id,
      userPrompt: activeSession.originalPrompt,
      contextSummary: cardGroup.contextSummary ?? activeSession.guidedState?.contextSummary,
      card,
    }

    assistant.wallet.unshift(item)
    session.assistant = assistant
    writeStorage(session)
    return { wallet: assistant.wallet, item, added: true }
  },

  // Saves the session-level summary as a synthetic "card" wallet item so the
  // existing wallet UI and PDF export handle it without special-casing. The
  // summary captures the goal, the most important next step, and every step at
  // a glance. Deduped per session via the fixed cardId 'summary'.
  addSummaryToWallet: async ({ sessionId }) => {
    await delay(150)
    const session = readStorage()
    if (!session) throw new Error('No guest session')

    const assistant = session.assistant ?? defaultAssistantState()
    const activeSession = assistant.sessions.find((s) => s.id === sessionId)
    if (!activeSession) throw new Error('Assistant session not found')

    const groups = activeSession.cardGroups ?? []
    const latest = groups[groups.length - 1]
    const summary = buildSummaryCard({
      goalLabel: activeSession.originalPrompt ?? null,
      answeredQuestions:
        latest?.contextSummary?.answeredQuestions ??
        activeSession.guidedState?.contextSummary?.answeredQuestions ??
        [],
      cards: latest?.cards ?? [],
      escalate: latest?.escalate ?? false,
      language: session.locale ?? DEFAULT_LOCALE,
    })

    const existing = assistant.wallet.find(
      (w) => w.sessionId === sessionId && w.cardId === 'summary',
    )
    if (existing) return { wallet: assistant.wallet, item: existing, added: false }

    const stepTitles = orderActionCards(latest?.cards ?? []).map((c) => c.title)
    const card = {
      id: 'summary',
      title: summary.goalLabel || activeSession.originalPrompt || 'Your summary',
      description: summary.verdict?.text ?? '',
      icon: 'Sparkles',
      status: 'recommended',
      category: 'other',
      classification: 'advisable',
      content: {
        body: summary.verdict?.text ?? '',
        steps: stepTitles,
        items: summary.urgency?.label
          ? [{ text: `${summary.urgency.label}${summary.urgency.detail ? ` — ${summary.urgency.detail}` : ''}`, status: 'info' }]
          : [],
      },
    }

    const item = {
      id: crypto.randomUUID(),
      type: 'card',
      savedAt: new Date().toISOString(),
      title: card.title,
      sessionId,
      cardId: 'summary',
      cardGroupId: latest?.id ?? null,
      userPrompt: activeSession.originalPrompt,
      contextSummary: latest?.contextSummary ?? activeSession.guidedState?.contextSummary,
      card,
    }

    assistant.wallet.unshift(item)
    session.assistant = assistant
    writeStorage(session)
    return { wallet: assistant.wallet, item, added: true }
  },

  addSessionToWallet: async ({ sessionId, cardGroupId = null }) => {
    await delay(150)
    const session = readStorage()
    if (!session) throw new Error('No guest session')

    const assistant = session.assistant ?? defaultAssistantState()
    const activeSession = assistant.sessions.find((s) => s.id === sessionId)
    if (!activeSession) throw new Error('Assistant session not found')

    const groups = activeSession.cardGroups ?? []
    // Target an explicit card group when provided so any visible group's bundle
    // can be saved (Req 6.4); otherwise fall back to the last group for
    // backward compatibility.
    const cardGroup = cardGroupId
      ? groups.find((g) => g.id === cardGroupId)
      : groups[groups.length - 1]
    if (!cardGroup?.walletBundle) throw new Error('No wallet bundle available')

    const bundle = cardGroup.walletBundle
    const existing = assistant.wallet.find(
      (w) => w.type === 'session' && w.bundleId === bundle.bundleId,
    )
    if (existing) return { wallet: assistant.wallet, item: existing, added: false }

    const item = {
      id: crypto.randomUUID(),
      type: 'session',
      savedAt: new Date().toISOString(),
      title: bundle.title,
      bundleId: bundle.bundleId,
      sessionId,
      cardGroupId: cardGroup.id,
      contextSummary: bundle.contextSummary,
      cards: bundle.cards,
    }

    assistant.wallet.unshift(item)
    session.assistant = assistant
    writeStorage(session)
    return { wallet: assistant.wallet, item, added: true }
  },

  removeFromWallet: async (walletItemId) => {
    await delay(100)
    const session = readStorage()
    if (!session) throw new Error('No guest session')

    const assistant = session.assistant ?? defaultAssistantState()
    assistant.wallet = assistant.wallet.filter((w) => w.id !== walletItemId)
    session.assistant = assistant
    writeStorage(session)
    return assistant.wallet
  },

  // --- "My information" review panel ---

  // Aggregates everything stored about the guest on this device into a single,
  // human-reviewable structure, grouped by source. Labels for topic answers are
  // taken from the data already stored on each session (contextSummary), so the
  // mock API stays free of i18n concerns; the profile answers are returned raw
  // and resolved to labels by the UI against the question catalog.
  getStoredProfile: async () => {
    await delay(80)
    const empty = {
      helpAnswers: {},
      helpCompleted: false,
      topics: [],
      wallet: [],
      locale: DEFAULT_LOCALE,
    }
    const session = readStorage()
    if (!session) return empty

    const migrated = migrateSession(session)
    writeStorage(migrated)

    const topics = (migrated.assistant?.sessions ?? []).map((s) => {
      const lastGroup = s.cardGroups?.[s.cardGroups.length - 1]
      const cs = lastGroup?.contextSummary ?? s.guidedState?.contextSummary
      return {
        id: s.id,
        title: s.originalPrompt || s.title || '',
        intent: s.intent ?? null,
        answeredQuestions: cs?.answeredQuestions ?? [],
        updatedAt: s.updatedAt ?? s.createdAt ?? null,
      }
    })

    return {
      helpAnswers: migrated.helpFlow?.answers ?? {},
      helpBubblePath: migrated.helpFlow?.bubblePath ?? [],
      helpCompleted: Boolean(migrated.helpFlow?.completed),
      topics,
      wallet: migrated.assistant?.wallet ?? [],
      locale: migrated.locale ?? DEFAULT_LOCALE,
    }
  },

  // Clears just the guided-interview profile answers, leaving topics and wallet
  // intact.
  clearProfileAnswers: async () => {
    const session = readStorage()
    if (!session) throw new Error('No guest session')
    session.helpFlow = defaultHelpFlow()
    session.nodes = defaultNodes()
    session.activeNodeId = null
    writeStorage(session)
    return session
  },

  // Removes a single explored topic (assistant session).
  removeAssistantSession: async (sessionId) => {
    const session = readStorage()
    if (!session) throw new Error('No guest session')
    const assistant = session.assistant ?? defaultAssistantState()
    assistant.sessions = (assistant.sessions ?? []).filter((s) => s.id !== sessionId)
    if (assistant.activeSessionId === sessionId) assistant.activeSessionId = null
    session.assistant = assistant
    writeStorage(session)
    return assistant
  },

  // Wipes everything stored on this device and starts a fresh guest session.
  clearAllData: async () => {
    const fresh = createDefaultSession()
    writeStorage(fresh)
    return fresh
  },
}
