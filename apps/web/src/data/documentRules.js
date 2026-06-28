const BASE_RULES = {
  first_permit: [
    'passport',
    'photos',
    'insurance',
    'anmeldung',
    'rental_contract',
  ],
  renewal: ['passport', 'photos', 'insurance', 'current_permit', 'anmeldung'],
  extension: ['passport', 'current_permit', 'insurance', 'anmeldung'],
  change_status: [
    'passport',
    'photos',
    'insurance',
    'current_permit',
    'employment_contract',
    'anmeldung',
  ],
  registration: ['passport', 'rental_contract', 'anmeldung'],
  work_rights: ['passport', 'current_permit', 'employment_contract'],
}

const VISA_ADDITIONS = {
  work: ['employment_contract'],
  skilled_work: ['employment_contract', 'qualification_proof'],
  blue_card: ['employment_contract', 'qualification_proof'],
  vocational_training: ['employment_contract', 'language_certificate'],
  opportunity_card: ['qualification_proof', 'financial_proof', 'insurance'],
  student: ['insurance'],
  language_course: ['insurance', 'financial_proof', 'language_certificate'],
  family: ['insurance'],
  self_employment: ['insurance', 'financial_proof'],
  asylum: ['passport'],
  tourist: ['passport'],
  other: [],
}

export function resolveRequiredDocuments(answers = {}) {
  const goal = answers.primaryGoal ?? 'first_permit'
  const visa = answers.visaStatus ?? 'other'

  const base = BASE_RULES[goal] ?? BASE_RULES.first_permit
  const extras = VISA_ADDITIONS[visa] ?? []
  const required = [...new Set([...base, ...extras])]

  const held = answers.documentsHeld ?? []

  return required.map((id) => ({
    id,
    hasDocument: held.includes(id),
    priority: held.includes(id) ? 'ready' : 'required',
  }))
}

export function unlockNodesFromProfile(answers = {}) {
  const goal = answers.primaryGoal
  const stage = answers.journeyStage
  const visa = answers.visaStatus

  const nodes = {
    arrival: { status: 'locked' },
    'residence-permit': { status: 'locked' },
    'legal-rights': { status: 'locked' },
    'work-career': { status: 'locked' },
  }

  if (stage === 'just_arrived' || goal === 'registration') {
    nodes.arrival = {
      status: 'active',
      interview: { answers: {}, currentStep: 0, completed: false },
    }
  }

  if (
    goal === 'first_permit' ||
    goal === 'renewal' ||
    goal === 'extension' ||
    goal === 'change_status'
  ) {
    nodes['residence-permit'] = {
      status: 'active',
      interview: { answers: {}, currentStep: 0, completed: false },
    }
  }

  if (
    ['work', 'skilled_work', 'blue_card', 'opportunity_card', 'vocational_training'].includes(visa) ||
    goal === 'change_status' ||
    goal === 'work_rights'
  ) {
    nodes['work-career'] = {
      status: 'active',
      interview: { answers: {}, currentStep: 0, completed: false },
    }
  }

  if (stage === 'settled' || stage === 'few_months' || visa === 'asylum') {
    nodes['legal-rights'] = {
      status: 'active',
      interview: { answers: {}, currentStep: 0, completed: false },
    }
  }

  const activeNodes = Object.entries(nodes).filter(([, n]) => n.status === 'active')
  if (activeNodes.length === 0) {
    nodes['residence-permit'] = {
      status: 'active',
      interview: { answers: {}, currentStep: 0, completed: false },
    }
  }

  return nodes
}

export const DOCUMENT_LABEL_KEYS = {
  passport: 'auslander.documents.passport',
  photos: 'auslander.documents.photos',
  insurance: 'auslander.documents.insurance',
  anmeldung: 'auslander.documents.anmeldung',
  current_permit: 'auslander.documents.currentPermit',
  employment_contract: 'auslander.documents.employmentContract',
  rental_contract: 'auslander.documents.rentalContract',
  fiktionsbescheinigung: 'auslander.documents.fiktion',
  university_admission: 'auslander.bubble.documents.universityAdmission',
  qualification_proof: 'auslander.bubble.documents.qualificationProof',
  language_certificate: 'auslander.bubble.documents.languageCertificate',
  financial_proof: 'auslander.bubble.documents.financialProof',
}
