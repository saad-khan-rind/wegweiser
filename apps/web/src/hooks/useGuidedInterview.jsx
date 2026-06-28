import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { AUSLANDER_STEPS } from '../data/auslanderInterview'
import {
  GUIDED_FLOW_START_ID,
  getGuidedNode,
} from '../data/guidedFlow'
import { resolveRequiredDocuments } from '../data/documentRules'
import { apiService } from '../services/mockApi'

const GuidedInterviewContext = createContext(null)
const EMPTY_HELP_FLOW = {}
const EMPTY_ANSWERS = {}
const EMPTY_BUBBLE_PATH = []

export function GuidedInterviewProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [documentResults, setDocumentResults] = useState(null)

  const helpFlow = session?.helpFlow ?? EMPTY_HELP_FLOW
  const phase = helpFlow.phase ?? 'choose'
  const currentStep = helpFlow.currentStep ?? 0
  const answers = helpFlow.answers ?? EMPTY_ANSWERS
  const stepData = AUSLANDER_STEPS[currentStep] ?? null
  const activeBubbleId = helpFlow.activeBubbleId ?? GUIDED_FLOW_START_ID
  const activeBubble = getGuidedNode(activeBubbleId)
  const bubblePath = helpFlow.bubblePath ?? EMPTY_BUBBLE_PATH
  const guidedAdvice = helpFlow.guidedAdvice ?? null

  const refresh = useCallback(async () => {
    const data = await apiService.fetchUserProgress()
    setSession(data)
    return data
  }, [])

  useEffect(() => {
    refresh().finally(() => setLoading(false))
  }, [refresh])

  useEffect(() => {
    if (phase === 'results' && answers) {
      setDocumentResults(resolveRequiredDocuments(answers))
    }
  }, [phase, answers])

  const startInterview = useCallback(async () => {
    setLoading(true)
    try {
      const updated = await apiService.startGuidedInterview()
      setSession(updated)
    } finally {
      setLoading(false)
    }
  }, [])

  const saveStepAndAdvance = useCallback(
    async (stepAnswers) => {
      setLoading(true)
      try {
        const updated = await apiService.saveGuidedInterviewStep(
          currentStep,
          stepAnswers,
        )
        setSession(updated)
      } finally {
        setLoading(false)
      }
    },
    [currentStep],
  )

  const saveBubbleAnswer = useCallback(async (payload) => {
    setLoading(true)
    try {
      const updated = await apiService.saveGuidedBubbleAnswer(payload)
      setSession(updated)
    } finally {
      setLoading(false)
    }
  }, [])

  const goBackBubble = useCallback(async () => {
    setLoading(true)
    try {
      const updated = await apiService.goBackGuidedBubble()
      setSession(updated)
    } finally {
      setLoading(false)
    }
  }, [])

  const resetBubbleFlow = useCallback(async () => {
    setLoading(true)
    try {
      const updated = await apiService.resetGuidedBubbleFlow()
      setSession(updated)
    } finally {
      setLoading(false)
    }
  }, [])

  const generateGuidedAdvice = useCallback(async () => {
    setLoading(true)
    try {
      const updated = await apiService.generateGuidedFlowAdvice()
      setSession(updated)
      setDocumentResults(resolveRequiredDocuments(updated.helpFlow?.answers))
    } finally {
      setLoading(false)
    }
  }, [])

  const goBackStep = useCallback(async () => {
    if (currentStep <= 0) {
      const updated = await apiService.setHelpPhase('choose')
      setSession(updated)
      return
    }
    setLoading(true)
    try {
      const updated = await apiService.setGuidedInterviewStep(currentStep - 1)
      setSession(updated)
    } finally {
      setLoading(false)
    }
  }, [currentStep])

  const completeInterview = useCallback(async () => {
    setLoading(true)
    try {
      const updated = await apiService.completeGuidedInterview()
      setSession(updated)
      setDocumentResults(resolveRequiredDocuments(updated.helpFlow?.answers))
    } finally {
      setLoading(false)
    }
  }, [])

  const goToChooseMode = useCallback(async () => {
    setLoading(true)
    try {
      const updated = await apiService.setHelpPhase('choose')
      setSession(updated)
    } finally {
      setLoading(false)
    }
  }, [])

  const finishAndExplore = useCallback(async () => {
    setLoading(true)
    try {
      const updated = await apiService.finishHelpFlow()
      setSession(updated)
    } finally {
      setLoading(false)
    }
  }, [])

  const showAssistant = useCallback(async () => {
    setLoading(true)
    try {
      const updated = await apiService.setHelpPhase('assistant')
      setSession(updated)
    } finally {
      setLoading(false)
    }
  }, [])

  const value = useMemo(
    () => ({
      session,
      loading,
      phase,
      currentStep,
      answers,
      stepData,
      activeBubbleId,
      activeBubble,
      bubblePath,
      guidedAdvice,
      totalSteps: AUSLANDER_STEPS.length,
      documentResults,
      startInterview,
      saveStepAndAdvance,
      saveBubbleAnswer,
      goBackBubble,
      resetBubbleFlow,
      generateGuidedAdvice,
      goBackStep,
      completeInterview,
      goToChooseMode,
      finishAndExplore,
      showAssistant,
      refresh,
    }),
    [
      session,
      loading,
      phase,
      currentStep,
      answers,
      stepData,
      activeBubbleId,
      activeBubble,
      bubblePath,
      guidedAdvice,
      documentResults,
      startInterview,
      saveStepAndAdvance,
      saveBubbleAnswer,
      goBackBubble,
      resetBubbleFlow,
      generateGuidedAdvice,
      goBackStep,
      completeInterview,
      goToChooseMode,
      finishAndExplore,
      showAssistant,
      refresh,
    ],
  )

  return (
    <GuidedInterviewContext.Provider value={value}>
      {children}
    </GuidedInterviewContext.Provider>
  )
}

export function useGuidedInterview() {
  const ctx = useContext(GuidedInterviewContext)
  if (!ctx) {
    throw new Error('useGuidedInterview must be used within GuidedInterviewProvider')
  }
  return ctx
}
