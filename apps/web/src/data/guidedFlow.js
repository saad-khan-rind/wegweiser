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

export function guidedAgeNumber(answers = {}) {
  const parsed = Number(answers.age)
  return Number.isFinite(parsed) ? parsed : null
}

export function isGuidedOptionAllowed(option, answers = {}) {
  const age = guidedAgeNumber(answers)
  if (age === null) return true
  const value = option?.value

  if (age < 18) {
    return ![
      'student',
      'vocational_training',
      'skilled_work',
      'blue_card',
      'opportunity_card',
      'self_employment',
      'job_offer',
      'university_admission',
      'training_contract',
      'employment_contract',
      'university_admission',
      'qualification_proof',
    ].includes(value)
  }

  return true
}

export function getLocalGuidedFallbackOptions(nodeId, answers = {}) {
  const age = guidedAgeNumber(answers)
  const minor = age !== null && age < 18

  if (nodeId === 'planning-visa') {
    const options = minor
      ? [
          {
            value: 'family',
            labelKey: 'auslander.bubble.visas.family',
            helperKey: 'auslander.bubble.visas.familyMinorHint',
            icon: 'Users',
            next: 'planning-readiness',
            badgeKey: 'auslander.bubble.aiChecked',
          },
          {
            value: 'school',
            labelKey: 'auslander.bubble.visas.school',
            helperKey: 'auslander.bubble.visas.schoolHint',
            icon: 'GraduationCap',
            next: 'planning-readiness',
          },
          {
            value: 'asylum',
            labelKey: 'auslander.bubble.visas.protection',
            helperKey: 'auslander.bubble.visas.protectionHint',
            icon: 'ShieldCheck',
            next: 'planning-readiness',
          },
          {
            value: 'counselor',
            labelKey: 'auslander.bubble.visas.counselor',
            helperKey: 'auslander.bubble.visas.counselorHint',
            icon: 'Lightbulb',
            next: 'planning-readiness',
          },
        ]
      : [
    {
      value: 'student',
      labelKey: 'auslander.bubble.visas.student',
      helperKey: 'auslander.bubble.visas.studentHint',
      icon: 'GraduationCap',
            next: 'planning-readiness',
    },
    {
      value: 'vocational_training',
      labelKey: 'auslander.bubble.visas.vocational',
      helperKey: 'auslander.bubble.visas.vocationalHint',
      icon: 'BriefcaseBusiness',
            next: 'planning-readiness',
    },
    {
      value: 'skilled_work',
      labelKey: 'auslander.bubble.visas.skilledWork',
      helperKey: 'auslander.bubble.visas.skilledWorkHint',
      icon: 'BadgeCheck',
            next: 'planning-readiness',
    },
    {
      value: 'blue_card',
      labelKey: 'auslander.bubble.visas.blueCard',
      helperKey: 'auslander.bubble.visas.blueCardHint',
      icon: 'Sparkles',
            next: 'planning-readiness',
    },
    {
      value: 'opportunity_card',
      labelKey: 'auslander.bubble.visas.opportunity',
      helperKey: 'auslander.bubble.visas.opportunityHint',
      icon: 'Search',
            next: 'planning-readiness',
    },
    {
      value: 'language_course',
      labelKey: 'auslander.bubble.visas.language',
      helperKey: 'auslander.bubble.visas.languageHint',
      icon: 'Languages',
            next: 'planning-readiness',
    },
    {
      value: 'family',
      labelKey: 'auslander.bubble.visas.family',
      helperKey: 'auslander.bubble.visas.familyHint',
      icon: 'Users',
            next: 'planning-readiness',
    },
    {
      value: 'self_employment',
      labelKey: 'auslander.bubble.visas.selfEmployment',
      helperKey: 'auslander.bubble.visas.selfEmploymentHint',
      icon: 'Lightbulb',
            next: 'planning-readiness',
    },
    {
      value: 'asylum',
      labelKey: 'auslander.bubble.visas.protection',
      helperKey: 'auslander.bubble.visas.protectionHint',
      icon: 'ShieldCheck',
            next: 'planning-readiness',
    },
        ]
    return options.filter((option) => isGuidedOptionAllowed(option, answers))
  }

  if (nodeId === 'planning-readiness' && minor) {
    return [
      {
        value: 'family_invitation',
        labelKey: 'auslander.bubble.readiness.familyInvitation',
        helperKey: 'auslander.bubble.readiness.familyInvitationHint',
        next: 'planning-documents',
      },
      {
        value: 'school_acceptance',
        labelKey: 'auslander.bubble.readiness.schoolAcceptance',
        helperKey: 'auslander.bubble.readiness.schoolAcceptanceHint',
        next: 'planning-documents',
      },
      {
        value: 'guardian_support',
        labelKey: 'auslander.bubble.readiness.guardianSupport',
        helperKey: 'auslander.bubble.readiness.guardianSupportHint',
        next: 'planning-documents',
      },
      {
        value: 'still_exploring',
        labelKey: 'auslander.bubble.readiness.exploring',
        helperKey: 'auslander.bubble.readiness.exploringHint',
        next: 'planning-documents',
      },
    ]
  }

  if (nodeId === 'planning-documents' && minor) {
    return [
      { value: 'passport', labelKey: 'auslander.documents.passport' },
      { value: 'guardian_consent', labelKey: 'auslander.bubble.documents.guardianConsent' },
      { value: 'birth_certificate', labelKey: 'auslander.bubble.documents.birthCertificate' },
      { value: 'family_proof', labelKey: 'auslander.bubble.documents.familyProof' },
      { value: 'school_acceptance', labelKey: 'auslander.bubble.documents.schoolAcceptance' },
      { value: 'insurance', labelKey: 'auslander.documents.insurance' },
      { value: 'financial_proof', labelKey: 'auslander.bubble.documents.financialProof' },
    ]
  }

  return null
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

export function getGuidedNodeOptions(node, answers = {}, optionOverride = null) {
  if (!node) return []
  const localFallback = getLocalGuidedFallbackOptions(node.id, answers)
  const options = optionOverride ?? localFallback ?? node.options ?? []
  return options.filter((option) => isGuidedOptionAllowed(option, answers))
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
