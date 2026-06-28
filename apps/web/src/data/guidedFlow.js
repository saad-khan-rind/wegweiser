export const GUIDED_FLOW_START_ID = 'entry'
export const GUIDED_FLOW_RESULT_ID = 'ai-result'

const sharedDocumentOptions = [
  { value: 'passport', labelKey: 'auslander.documents.passport' },
  { value: 'photos', labelKey: 'auslander.documents.photos' },
  { value: 'insurance', labelKey: 'auslander.documents.insurance' },
  { value: 'anmeldung', labelKey: 'auslander.documents.anmeldung' },
  { value: 'current_permit', labelKey: 'auslander.documents.currentPermit' },
  { value: 'employment_contract', labelKey: 'auslander.documents.employmentContract' },
  { value: 'rental_contract', labelKey: 'auslander.documents.rentalContract' },
  { value: 'fiktionsbescheinigung', labelKey: 'auslander.documents.fiktion' },
]

const planningDocumentOptions = [
  { value: 'passport', labelKey: 'auslander.documents.passport' },
  { value: 'photos', labelKey: 'auslander.documents.photos' },
  { value: 'insurance', labelKey: 'auslander.documents.insurance' },
  { value: 'employment_contract', labelKey: 'auslander.documents.employmentContract' },
  { value: 'university_admission', labelKey: 'auslander.bubble.documents.universityAdmission' },
  { value: 'qualification_proof', labelKey: 'auslander.bubble.documents.qualificationProof' },
  { value: 'language_certificate', labelKey: 'auslander.bubble.documents.languageCertificate' },
  { value: 'financial_proof', labelKey: 'auslander.bubble.documents.financialProof' },
]

function ageNumber(answers = {}) {
  const parsed = Number(answers.age)
  return Number.isFinite(parsed) ? parsed : null
}

function recommendedForAge(value, age) {
  if (age === null) return false
  if (age < 18) return ['family', 'school', 'language_course'].includes(value)
  if (age <= 26) return ['student', 'vocational_training', 'language_course'].includes(value)
  if (age <= 35) return ['skilled_work', 'blue_card', 'opportunity_card', 'student'].includes(value)
  return ['skilled_work', 'blue_card', 'opportunity_card', 'family', 'self_employment'].includes(value)
}

export function planningVisaOptions(answers = {}) {
  const age = ageNumber(answers)
  return [
    {
      value: 'student',
      labelKey: 'auslander.bubble.visas.student',
      helperKey: 'auslander.bubble.visas.studentHint',
      icon: 'GraduationCap',
    },
    {
      value: 'vocational_training',
      labelKey: 'auslander.bubble.visas.vocational',
      helperKey: 'auslander.bubble.visas.vocationalHint',
      icon: 'BriefcaseBusiness',
    },
    {
      value: 'skilled_work',
      labelKey: 'auslander.bubble.visas.skilledWork',
      helperKey: 'auslander.bubble.visas.skilledWorkHint',
      icon: 'BadgeCheck',
    },
    {
      value: 'blue_card',
      labelKey: 'auslander.bubble.visas.blueCard',
      helperKey: 'auslander.bubble.visas.blueCardHint',
      icon: 'Sparkles',
    },
    {
      value: 'opportunity_card',
      labelKey: 'auslander.bubble.visas.opportunity',
      helperKey: 'auslander.bubble.visas.opportunityHint',
      icon: 'Search',
    },
    {
      value: 'language_course',
      labelKey: 'auslander.bubble.visas.language',
      helperKey: 'auslander.bubble.visas.languageHint',
      icon: 'Languages',
    },
    {
      value: 'family',
      labelKey: 'auslander.bubble.visas.family',
      helperKey: 'auslander.bubble.visas.familyHint',
      icon: 'Users',
    },
    {
      value: 'self_employment',
      labelKey: 'auslander.bubble.visas.selfEmployment',
      helperKey: 'auslander.bubble.visas.selfEmploymentHint',
      icon: 'Lightbulb',
    },
    {
      value: 'asylum',
      labelKey: 'auslander.bubble.visas.protection',
      helperKey: 'auslander.bubble.visas.protectionHint',
      icon: 'ShieldCheck',
    },
  ].map((option) => ({
    ...option,
    recommended: recommendedForAge(option.value, age),
    badgeKey: recommendedForAge(option.value, age)
      ? 'auslander.bubble.recommended'
      : undefined,
  }))
}

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
        next: 'current-duration',
        set: { locationIntent: 'currently_in_germany' },
      },
      {
        value: 'planning_move',
        labelKey: 'auslander.bubble.entry.planning',
        helperKey: 'auslander.bubble.entry.planningHint',
        next: 'planning-age',
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
    options: [
      { value: 'tourist', labelKey: 'auslander.step2.tourist', next: 'current-goal' },
      { value: 'student', labelKey: 'auslander.step2.student', next: 'current-goal' },
      { value: 'work', labelKey: 'auslander.step2.work', next: 'current-goal' },
      { value: 'family', labelKey: 'auslander.bubble.visas.family', next: 'current-goal' },
      { value: 'asylum', labelKey: 'auslander.step2.asylum', next: 'current-goal' },
      { value: 'other', labelKey: 'auslander.step2.other', next: 'current-goal' },
    ],
  },
  'current-goal': {
    id: 'current-goal',
    type: 'single',
    answerKey: 'primaryGoal',
    questionKey: 'auslander.bubble.currentGoal.question',
    subtitleKey: 'auslander.bubble.currentGoal.subtitle',
    tone: 'amber',
    options: [
      { value: 'registration', labelKey: 'auslander.step3.registration', next: 'current-documents' },
      { value: 'first_permit', labelKey: 'auslander.step3.firstPermit', next: 'current-documents' },
      { value: 'renewal', labelKey: 'auslander.step3.renewal', next: 'current-documents' },
      { value: 'extension', labelKey: 'auslander.step3.extension', next: 'current-documents' },
      { value: 'change_status', labelKey: 'auslander.step3.changeStatus', next: 'current-documents' },
      { value: 'work_rights', labelKey: 'auslander.bubble.currentGoal.workRights', next: 'current-documents' },
    ],
  },
  'current-documents': {
    id: 'current-documents',
    type: 'multi',
    answerKey: 'documentsHeld',
    questionKey: 'auslander.bubble.documents.question',
    subtitleKey: 'auslander.bubble.documents.subtitle',
    tone: 'emerald',
    options: sharedDocumentOptions,
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
    getOptions: planningVisaOptions,
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
    options: [
      {
        value: 'university_admission',
        labelKey: 'auslander.bubble.readiness.universityAdmission',
        helperKey: 'auslander.bubble.readiness.universityAdmissionHint',
        next: 'planning-documents',
      },
      {
        value: 'job_offer',
        labelKey: 'auslander.bubble.readiness.jobOffer',
        helperKey: 'auslander.bubble.readiness.jobOfferHint',
        next: 'planning-documents',
      },
      {
        value: 'training_contract',
        labelKey: 'auslander.bubble.readiness.trainingContract',
        helperKey: 'auslander.bubble.readiness.trainingContractHint',
        next: 'planning-documents',
      },
      {
        value: 'family_invitation',
        labelKey: 'auslander.bubble.readiness.familyInvitation',
        helperKey: 'auslander.bubble.readiness.familyInvitationHint',
        next: 'planning-documents',
      },
      {
        value: 'still_exploring',
        labelKey: 'auslander.bubble.readiness.exploring',
        helperKey: 'auslander.bubble.readiness.exploringHint',
        next: 'planning-documents',
      },
    ],
  },
  'planning-documents': {
    id: 'planning-documents',
    type: 'multi',
    answerKey: 'documentsHeld',
    questionKey: 'auslander.bubble.documents.planningQuestion',
    subtitleKey: 'auslander.bubble.documents.planningSubtitle',
    tone: 'emerald',
    options: planningDocumentOptions,
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

export function getGuidedNodeOptions(node, answers = {}) {
  if (!node) return []
  if (typeof node.getOptions === 'function') return node.getOptions(answers)
  return node.options ?? []
}

export function getGuidedNextNode(node, value, answers = {}) {
  if (!node) return GUIDED_FLOW_START_ID
  if (typeof node.getNext === 'function') return node.getNext(value, answers)
  const option = getGuidedNodeOptions(node, answers).find((opt) => opt.value === value)
  return option?.next ?? node.next ?? GUIDED_FLOW_RESULT_ID
}

export function getGuidedOption(node, value, answers = {}) {
  return getGuidedNodeOptions(node, answers).find((option) => option.value === value)
}

export function getGuidedAnswerPatch(node, value, answers = {}) {
  const option = getGuidedOption(node, value, answers)
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
