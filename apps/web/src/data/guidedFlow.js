export const GUIDED_FLOW_START_ID = 'entry'
export const GUIDED_FLOW_RESULT_ID = 'ai-result'

export const GUIDED_FLOW_NODES = {
  entry: {
    id: 'entry',
    type: 'single',
    answerKey: 'locationIntent',
    questionKey: 'auslander.bubble.entry.question',
    subtitleKey: 'auslander.bubble.entry.subtitle',
    tone: 'sky',
    options: [
      {
        value: 'currently_in_germany',
        labelKey: 'auslander.bubble.entry.current',
        helperKey: 'auslander.bubble.entry.currentHint',
        next: 'current-status',
        set: { locationIntent: 'currently_in_germany' },
      },
      {
        value: 'planning_move',
        labelKey: 'auslander.bubble.entry.planning',
        helperKey: 'auslander.bubble.entry.planningHint',
        next: 'planning-visa',
        set: { locationIntent: 'planning_move', journeyStage: 'abroad', primaryGoal: 'first_permit' },
      },
    ],
  },
  'current-duration': {
    id: 'current-duration',
    type: 'single',
    answerKey: 'journeyStage',
    questionKey: 'auslander.bubble.currentDuration.question',
    subtitleKey: 'auslander.bubble.currentDuration.subtitle',
    tone: 'teal',
    options: [
      {
        value: 'just_arrived',
        labelKey: 'auslander.step1.justArrived',
        helperKey: 'auslander.bubble.currentDuration.justArrivedHint',
        next: 'current-status',
      },
      {
        value: 'few_months',
        labelKey: 'auslander.step1.fewMonths',
        helperKey: 'auslander.bubble.currentDuration.fewMonthsHint',
        next: 'current-status',
      },
      {
        value: 'settled',
        labelKey: 'auslander.step1.settled',
        helperKey: 'auslander.bubble.currentDuration.settledHint',
        next: 'current-status',
      },
    ],
  },
  'current-status': {
    id: 'current-status',
    type: 'single',
    answerKey: 'visaStatus',
    questionKey: 'auslander.bubble.currentStatus.question',
    subtitleKey: 'auslander.bubble.currentStatus.subtitle',
    tone: 'indigo',
    requiresAiOptions: true,
    options: [],
    next: 'current-goal',
  },
  'current-goal': {
    id: 'current-goal',
    type: 'single',
    answerKey: 'primaryGoal',
    questionKey: 'auslander.bubble.currentGoal.question',
    subtitleKey: 'auslander.bubble.currentGoal.subtitle',
    tone: 'amber',
    requiresAiOptions: true,
    options: [],
    next: 'current-documents',
  },
  'current-documents': {
    id: 'current-documents',
    type: 'multi',
    answerKey: 'documentsHeld',
    questionKey: 'auslander.bubble.documents.question',
    subtitleKey: 'auslander.bubble.documents.subtitle',
    tone: 'emerald',
    requiresAiOptions: true,
    options: [],
    next: GUIDED_FLOW_RESULT_ID,
  },
  'planning-age': {
    id: 'planning-age',
    type: 'number',
    answerKey: 'age',
    questionKey: 'auslander.bubble.planningAge.question',
    subtitleKey: 'auslander.bubble.planningAge.subtitle',
    tone: 'coral',
    min: 0,
    max: 90,
    next: 'planning-visa',
  },
  'planning-visa': {
    id: 'planning-visa',
    type: 'single',
    answerKey: 'visaStatus',
    questionKey: 'auslander.bubble.planningVisa.question',
    subtitleKey: 'auslander.bubble.planningVisa.subtitle',
    tone: 'violet',
    requiresAiOptions: true,
    options: [],
    next: 'planning-readiness',
    set: { primaryGoal: 'first_permit' },
  },
  'planning-readiness': {
    id: 'planning-readiness',
    type: 'single',
    answerKey: 'planningReadiness',
    questionKey: 'auslander.bubble.readiness.question',
    subtitleKey: 'auslander.bubble.readiness.subtitle',
    tone: 'lime',
    requiresAiOptions: true,
    options: [],
    next: 'planning-documents',
  },
  'planning-documents': {
    id: 'planning-documents',
    type: 'multi',
    answerKey: 'documentsHeld',
    questionKey: 'auslander.bubble.documents.planningQuestion',
    subtitleKey: 'auslander.bubble.documents.planningSubtitle',
    tone: 'emerald',
    requiresAiOptions: true,
    options: [],
    next: GUIDED_FLOW_RESULT_ID,
  },
  [GUIDED_FLOW_RESULT_ID]: {
    id: GUIDED_FLOW_RESULT_ID,
    type: 'result',
    questionKey: 'auslander.bubble.ai.question',
    subtitleKey: 'auslander.bubble.ai.subtitle',
    tone: 'result',
  },
}

export function getGuidedNode(nodeId = GUIDED_FLOW_START_ID) {
  return GUIDED_FLOW_NODES[nodeId] ?? GUIDED_FLOW_NODES[GUIDED_FLOW_START_ID]
}

export function getGuidedNodeOptions(node, answers = {}, optionOverride = null) {
  if (!node) return []
  if (Array.isArray(optionOverride)) return optionOverride
  return Array.isArray(node.options) ? node.options : []
}

export function getGuidedNextNode(node, value, answers = {}, optionOverride = null) {
  if (!node) return GUIDED_FLOW_START_ID
  if (typeof node.getNext === 'function') return node.getNext(value, answers)
  const option = getGuidedNodeOptions(node, answers, optionOverride).find((opt) => opt.value === value)
  return option?.next ?? node.next ?? GUIDED_FLOW_RESULT_ID
}

export function getGuidedOption(node, value, answers = {}, optionOverride = null) {
  return getGuidedNodeOptions(node, answers, optionOverride).find((option) => option.value === value)
}

export function getGuidedAnswerPatch(node, value, answers = {}, optionOverride = null) {
  const option = getGuidedOption(node, value, answers, optionOverride)
  return {
    ...(node?.set ?? {}),
    ...(option?.set ?? {}),
    [node.answerKey]: value,
  }
}

export function buildGuidedTrailLabel(path = []) {
  return path
    .map((item) => item.answerLabel)
    .filter(Boolean)
    .join(' -> ')
}
