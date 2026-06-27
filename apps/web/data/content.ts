import type { Station, ProfileMeta, KbEntry } from "@/lib/types";

// ---------------------------------------------------------------------------
// Station library. Each station is a "stop" on someone's migration route.
// Content mirrors real German processes; in production these map 1:1 to
// Integreat CMS pages (sources carry the page origin + last-updated date so
// "the current legal situation" is always visible and verifiable).
// ---------------------------------------------------------------------------

const D = (s: string) => s; // identity helper to keep lines short

export const STATIONS: Record<string, Station> = {
  arrived: {
    id: "arrived",
    title: "Arrived in Germany",
    icon: "🛬",
    line: "core",
    estMinutes: 0,
    blurb: "Your starting point. Everything below builds on this.",
    summary:
      "Welcome. The first weeks are mostly paperwork that unlocks everything else — an address, an ID number, insurance and a bank account. Do them roughly in order and the rest gets easier.",
    requiredDocs: ["Passport or ID"],
    checklist: ["Keep your passport safe", "Note your arrival date"],
    actions: [
      { kind: "explain", title: "What happens in my first 2 weeks?", meta: "≈ 2 min read" },
    ],
    sources: [{ title: "Welcome to Germany", origin: "integreat", updatedAt: "2026-05-30" }],
    confidence: 0.99,
    updatedAt: "2026-05-30",
  },

  anmeldung: {
    id: "anmeldung",
    title: "Register your address",
    icon: "🏠",
    line: "core",
    estMinutes: 15,
    blurb: "Anmeldung — the key that unlocks almost everything else.",
    summary:
      "Within 14 days of moving in you must register your address at the local Bürgeramt. You get a registration certificate (Meldebescheinigung) that you need for a bank account, tax ID and many other steps.",
    requiredDocs: ["Passport or ID", "Landlord confirmation (Wohnungsgeberbestätigung)", "Rental contract"],
    checklist: [
      "Get the Wohnungsgeberbestätigung signed by your landlord",
      "Book a Bürgeramt appointment",
      "Bring everyone living with you",
    ],
    actions: [
      { kind: "explain", title: "Explain Anmeldung simply", meta: "≈ 2 min" },
      { kind: "office", title: "Find the Bürgeramt near me" },
      { kind: "appointment", title: "Book an appointment" },
      { kind: "checklist", title: "Check my documents are ready" },
    ],
    sources: [
      { title: "Registering your address", origin: "municipality", updatedAt: "2026-06-12" },
      { title: "Bundesmeldegesetz §17", origin: "federal", updatedAt: "2025-11-02" },
    ],
    confidence: 0.97,
    updatedAt: "2026-06-12",
  },

  taxid: {
    id: "taxid",
    title: "Get your tax ID",
    icon: "🔢",
    line: "core",
    estMinutes: 5,
    blurb: "Arrives by post a few weeks after you register.",
    summary:
      "After registering your address, the tax office automatically posts your tax ID (Steuer-Identifikationsnummer) to your home. Your employer needs it to pay you correctly.",
    requiredDocs: ["Registration certificate"],
    checklist: ["Watch your letterbox", "Store the number safely"],
    actions: [
      { kind: "explain", title: "What is a tax ID for?", meta: "≈ 1 min" },
      { kind: "link", title: "Request it again if it's lost" },
    ],
    sources: [{ title: "Tax identification number", origin: "federal", updatedAt: "2026-02-18" }],
    confidence: 0.95,
    updatedAt: "2026-02-18",
  },

  health: {
    id: "health",
    title: "Health insurance",
    icon: "🏥",
    line: "core",
    estMinutes: 30,
    blurb: "Mandatory in Germany — pick a public insurer to start.",
    summary:
      "Health insurance is required for everyone. Most newcomers join a public insurer (gesetzliche Krankenkasse). Once you choose one, they send a card you use at every doctor.",
    requiredDocs: ["Registration certificate", "Passport or ID"],
    checklist: ["Choose a Krankenkasse", "Submit the membership form", "Wait for your insurance card"],
    actions: [
      { kind: "explain", title: "Public vs private — what fits me?", meta: "≈ 2 min" },
      { kind: "link", title: "Compare public insurers" },
      { kind: "escalate", title: "My situation is unusual — talk to a counselor" },
    ],
    sources: [{ title: "Health insurance basics", origin: "integreat", updatedAt: "2026-06-01" }],
    confidence: 0.93,
    updatedAt: "2026-06-01",
  },

  bank: {
    id: "bank",
    title: "Open a bank account",
    icon: "🏦",
    line: "core",
    estMinutes: 20,
    blurb: "Needed for rent, salary and most contracts.",
    summary:
      "A current account (Girokonto) lets you receive your salary and pay rent. You can open a basic account (Basiskonto) even with limited documents — banks must offer it.",
    requiredDocs: ["Passport or ID", "Registration certificate", "Tax ID"],
    checklist: ["Pick a bank or online account", "Verify your identity", "Activate online banking"],
    actions: [
      { kind: "explain", title: "What's a Basiskonto?", meta: "≈ 1 min" },
      { kind: "link", title: "Accounts that accept newcomers" },
    ],
    sources: [{ title: "Basic bank account right", origin: "federal", updatedAt: "2025-12-09" }],
    confidence: 0.92,
    updatedAt: "2025-12-09",
  },

  residence: {
    id: "residence",
    title: "Residence permit",
    icon: "📄",
    line: "core",
    estMinutes: 45,
    blurb: "Your legal right to stay — renew before it expires.",
    summary:
      "Your residence permit (Aufenthaltstitel) sets out how long you can stay and whether you can work. Book your appointment at the Ausländerbehörde well before it expires — slots fill up.",
    requiredDocs: ["Passport", "Biometric photo", "Proof of insurance", "Proof of income or studies"],
    checklist: ["Check your expiry date", "Gather documents", "Book the Ausländerbehörde appointment"],
    actions: [
      { kind: "explain", title: "Explain my permit type", meta: "≈ 2 min" },
      { kind: "appointment", title: "Book at the Ausländerbehörde" },
      { kind: "upload", title: "Check my documents" },
      { kind: "deadline", title: "Set a renewal reminder" },
    ],
    sources: [
      { title: "Residence permits overview", origin: "bamf", updatedAt: "2026-06-20" },
      { title: "Aufenthaltsgesetz", origin: "federal", updatedAt: "2026-04-15" },
    ],
    confidence: 0.9,
    updatedAt: "2026-06-20",
  },

  // Asylum line
  asylumApply: {
    id: "asylumApply",
    title: "Apply for asylum",
    icon: "🛡️",
    line: "asylum",
    estMinutes: 60,
    blurb: "Register and lodge your application with BAMF.",
    summary:
      "First report as an asylum seeker, then lodge your formal application at the BAMF branch. You receive an arrival certificate (Ankunftsnachweis) and later an interview date.",
    requiredDocs: ["Passport or any ID you have", "Arrival certificate"],
    checklist: ["Report as asylum seeker", "Lodge the application at BAMF", "Keep every letter you receive"],
    actions: [
      { kind: "explain", title: "How does the asylum process work?", meta: "≈ 3 min" },
      { kind: "office", title: "Find the nearest BAMF office" },
      { kind: "escalate", title: "Get a counselor for my case" },
    ],
    sources: [{ title: "The asylum procedure", origin: "bamf", updatedAt: "2026-06-22" }],
    confidence: 0.88,
    updatedAt: "2026-06-22",
  },
  asylumInterview: {
    id: "asylumInterview",
    title: "Asylum interview",
    icon: "🗣️",
    line: "asylum",
    estMinutes: 120,
    blurb: "The most important step — prepare with support.",
    summary:
      "At your hearing you explain your reasons for fleeing. You have the right to an interpreter. Counseling services can help you prepare; this strongly affects the outcome.",
    requiredDocs: ["Invitation letter", "Any evidence you have"],
    checklist: ["Confirm the date", "Prepare your account", "Arrange counseling support"],
    actions: [
      { kind: "escalate", title: "Book counseling before my interview" },
      { kind: "explain", title: "What will they ask me?", meta: "≈ 3 min" },
    ],
    sources: [{ title: "Preparing for the hearing", origin: "integreat", updatedAt: "2026-05-28" }],
    confidence: 0.84,
    updatedAt: "2026-05-28",
  },
  integration: {
    id: "integration",
    title: "Integration course",
    icon: "📚",
    line: "asylum",
    estMinutes: 30,
    blurb: "Language plus an orientation course — often funded.",
    summary:
      "An integration course combines German lessons with an orientation module. Depending on your status it may be free or low-cost, and it helps with later steps like work and permanent residence.",
    requiredDocs: ["Residence document", "Course entitlement (if issued)"],
    checklist: ["Check your entitlement", "Find a course provider", "Register"],
    actions: [
      { kind: "explain", title: "Am I entitled to a course?", meta: "≈ 2 min" },
      { kind: "office", title: "Find a course near me" },
    ],
    sources: [{ title: "Integration courses", origin: "bamf", updatedAt: "2026-06-05" }],
    confidence: 0.9,
    updatedAt: "2026-06-05",
  },
  workauth: {
    id: "workauth",
    title: "Permission to work",
    icon: "💼",
    line: "asylum",
    estMinutes: 20,
    blurb: "When and how you're allowed to take a job.",
    summary:
      "Whether you may work depends on your status and how long you've been here. The Ausländerbehörde notes work permission in your document. Rules changed recently — check the current date below.",
    requiredDocs: ["Residence document", "Job offer (if you have one)"],
    checklist: ["Check your work status", "Ask the Ausländerbehörde if unclear"],
    actions: [
      { kind: "explain", title: "Can I work yet?", meta: "≈ 2 min" },
      { kind: "escalate", title: "Unclear case — ask a counselor" },
    ],
    sources: [{ title: "Access to work by status", origin: "federal", updatedAt: "2026-06-18" }],
    confidence: 0.82,
    updatedAt: "2026-06-18",
  },

  // Student line
  enrol: {
    id: "enrol",
    title: "University enrolment",
    icon: "🎓",
    line: "student",
    estMinutes: 40,
    blurb: "Confirm your place and enrol for the semester.",
    summary:
      "After admission, enrol (Immatrikulation) and pay the semester fee. Enrolment proof is needed for your residence permit and student insurance.",
    requiredDocs: ["Admission letter", "Passport", "Proof of insurance", "Proof of funds"],
    checklist: ["Accept your place", "Pay the semester fee", "Collect enrolment proof"],
    actions: [
      { kind: "explain", title: "What is the semester fee?", meta: "≈ 1 min" },
      { kind: "link", title: "Blocked account & proof of funds" },
    ],
    sources: [{ title: "Studying in Germany", origin: "integreat", updatedAt: "2026-04-22" }],
    confidence: 0.9,
    updatedAt: "2026-04-22",
  },
  studentwork: {
    id: "studentwork",
    title: "Working as a student",
    icon: "⏱️",
    line: "student",
    estMinutes: 10,
    blurb: "There's a yearly limit on working days.",
    summary:
      "Students from outside the EU may work a limited number of days per year alongside studies. Going over the limit can affect your permit, so track your days.",
    requiredDocs: ["Enrolment proof", "Residence permit"],
    checklist: ["Check your day limit", "Track days worked"],
    actions: [{ kind: "explain", title: "How many days can I work?", meta: "≈ 1 min" }],
    sources: [{ title: "Student work limits", origin: "federal", updatedAt: "2026-03-11" }],
    confidence: 0.86,
    updatedAt: "2026-03-11",
  },

  // Work / Blue Card line
  bluecard: {
    id: "bluecard",
    title: "EU Blue Card",
    icon: "🔷",
    line: "work",
    estMinutes: 50,
    blurb: "Fast-track residence for qualified professionals.",
    summary:
      "The EU Blue Card is for graduates with a qualifying job offer above a salary threshold. It speeds up permanent residence and family reunification. Thresholds update yearly — check the date below.",
    requiredDocs: ["Degree recognition", "Employment contract", "Passport", "Biometric photo"],
    checklist: ["Confirm salary meets the threshold", "Get your degree recognised", "Apply at the Ausländerbehörde"],
    actions: [
      { kind: "explain", title: "Do I qualify for a Blue Card?", meta: "≈ 2 min" },
      { kind: "link", title: "Check this year's salary threshold" },
      { kind: "appointment", title: "Book the appointment" },
    ],
    sources: [{ title: "EU Blue Card", origin: "bamf", updatedAt: "2026-06-19" }],
    confidence: 0.88,
    updatedAt: "2026-06-19",
  },
  employer: {
    id: "employer",
    title: "Register with your employer",
    icon: "🧾",
    line: "work",
    estMinutes: 15,
    blurb: "Hand over the details your employer needs to pay you.",
    summary:
      "Give your employer your tax ID, social security number and bank details. Your social security number arrives after your first registered job or on request.",
    requiredDocs: ["Tax ID", "Bank details"],
    checklist: ["Share tax ID", "Share bank details", "Note your social security number"],
    actions: [{ kind: "explain", title: "What does my employer need?", meta: "≈ 1 min" }],
    sources: [{ title: "Starting work", origin: "integreat", updatedAt: "2026-05-15" }],
    confidence: 0.92,
    updatedAt: "2026-05-15",
  },

  // Family line
  childcare: {
    id: "childcare",
    title: "Childcare & school",
    icon: "🎒",
    line: "family",
    estMinutes: 30,
    blurb: "Get your children into Kita or school.",
    summary:
      "Children have a right to childcare and must attend school. Register early for a Kita place; for school, contact the local school office which assigns a place.",
    requiredDocs: ["Children's passports", "Registration certificate", "Vaccination record"],
    checklist: ["Register for a Kita place", "Contact the school office", "Bring vaccination records"],
    actions: [
      { kind: "explain", title: "How do I find a Kita place?", meta: "≈ 2 min" },
      { kind: "office", title: "Find the school office" },
    ],
    sources: [{ title: "Childcare and school", origin: "integreat", updatedAt: "2026-06-08" }],
    confidence: 0.9,
    updatedAt: "2026-06-08",
    requiresFlag: "has_children",
  },
  kindergeld: {
    id: "kindergeld",
    title: "Child benefit (Kindergeld)",
    icon: "💶",
    line: "family",
    estMinutes: 25,
    blurb: "Monthly support for families with children.",
    summary:
      "Families raising children can receive monthly child benefit. You apply at the Familienkasse with your children's documents and your tax ID.",
    requiredDocs: ["Children's birth certificates", "Tax ID", "Residence document"],
    checklist: ["Fill the Familienkasse application", "Attach birth certificates", "Submit"],
    actions: [
      { kind: "explain", title: "Am I eligible for Kindergeld?", meta: "≈ 2 min" },
      { kind: "deadline", title: "Apply — it can be backdated" },
    ],
    sources: [{ title: "Child benefit", origin: "federal", updatedAt: "2026-06-10" }],
    confidence: 0.9,
    updatedAt: "2026-06-10",
    requiresFlag: "has_children",
  },
  reunification: {
    id: "reunification",
    title: "Bring your family",
    icon: "👨‍👩‍👧",
    line: "family",
    estMinutes: 60,
    blurb: "Family reunification once your status allows it.",
    summary:
      "Once your own status is settled you may be able to bring close family. Requirements include enough income and housing. The process runs partly through the German embassy abroad.",
    requiredDocs: ["Your residence permit", "Marriage / birth certificates", "Proof of income & housing"],
    checklist: ["Check eligibility for your status", "Gather family documents", "Start the embassy process"],
    actions: [
      { kind: "explain", title: "Who counts as family?", meta: "≈ 3 min" },
      { kind: "escalate", title: "Complex case — talk to a counselor" },
    ],
    sources: [{ title: "Family reunification", origin: "bamf", updatedAt: "2026-06-14" }],
    confidence: 0.8,
    updatedAt: "2026-06-14",
  },
};

// ---------------------------------------------------------------------------
// Journey templates. Composed from the station library and branched by profile.
// ---------------------------------------------------------------------------

export const PROFILES: Record<string, ProfileMeta> = {
  arriving: {
    id: "arriving",
    label: "I just arrived",
    glyph: "🛬",
    line: "core",
    tagline: "Let's get the essentials sorted, in order.",
    stationIds: ["arrived", "anmeldung", "taxid", "health", "bank", "residence"],
  },
  asylum: {
    id: "asylum",
    label: "I'm seeking asylum",
    glyph: "🛡️",
    line: "asylum",
    tagline: "Your protection process, step by step, with human support.",
    stationIds: ["arrived", "asylumApply", "anmeldung", "asylumInterview", "integration", "workauth"],
  },
  student: {
    id: "student",
    label: "I'm a student",
    glyph: "🎓",
    line: "student",
    tagline: "From enrolment to working alongside your studies.",
    stationIds: ["arrived", "enrol", "anmeldung", "residence", "health", "studentwork"],
  },
  worker: {
    id: "worker",
    label: "I'm here to work",
    glyph: "🔷",
    line: "work",
    tagline: "Blue Card, registration, and getting paid.",
    stationIds: ["arrived", "anmeldung", "taxid", "bluecard", "bank", "employer"],
  },
  eu: {
    id: "eu",
    label: "I'm an EU citizen",
    glyph: "🇪🇺",
    line: "core",
    tagline: "Fewer steps — mostly registration and the basics.",
    stationIds: ["arrived", "anmeldung", "taxid", "health", "bank"],
  },
  family: {
    id: "family",
    label: "I'm here with family",
    glyph: "👨‍👩‍👧",
    line: "family",
    tagline: "The essentials, plus school, benefits and reunification.",
    stationIds: ["arrived", "anmeldung", "health", "childcare", "kindergeld", "reunification"],
  },
};

// ---------------------------------------------------------------------------
// Knowledge base for free-form questions. Matched on-device; in production
// this is replaced by the RAG service over uploaded docs + official web crawl.
// ---------------------------------------------------------------------------

export const KB: KbEntry[] = [
  {
    id: "kb-anmeldung",
    keywords: ["register", "address", "anmeldung", "bürgeramt", "wohnung", "meldebescheinigung"],
    stationId: "anmeldung",
    answer:
      "You register your address at the local Bürgeramt within 14 days of moving in. Bring your passport, the landlord confirmation and your rental contract. You'll get a registration certificate you'll reuse for many other steps.",
    cards: [
      { kind: "checklist", title: "Documents needed", body: "Passport · Landlord confirmation · Rental contract" },
      { kind: "office", title: "Find the Bürgeramt near me" },
      { kind: "appointment", title: "Book an appointment" },
    ],
    sources: [{ title: "Registering your address", origin: "municipality", updatedAt: "2026-06-12" }],
    confidence: 0.95,
  },
  {
    id: "kb-health",
    keywords: ["health", "insurance", "krankenkasse", "doctor", "sick", "krank", "versicherung"],
    stationId: "health",
    answer:
      "Health insurance is mandatory. Most newcomers join a public insurer (gesetzliche Krankenkasse), which then sends an insurance card you use at every doctor.",
    cards: [
      { kind: "explain", title: "Public vs private", body: "For most newcomers, public is the default and simplest start." },
      { kind: "link", title: "Compare public insurers" },
    ],
    sources: [{ title: "Health insurance basics", origin: "integreat", updatedAt: "2026-06-01" }],
    confidence: 0.9,
  },
  {
    id: "kb-work",
    keywords: ["work", "job", "arbeit", "permit", "allowed", "erlaubnis", "arbeiten"],
    stationId: "workauth",
    answer:
      "Whether you can work depends on your residence status and how long you've been here. Your permission is written in your residence document. Recent rule changes mean it's worth checking the current date on the source.",
    cards: [
      { kind: "explain", title: "Check my work status", body: "Tell me your status and I'll point to the exact rule." },
      { kind: "escalate", title: "Unclear case — ask a counselor" },
    ],
    sources: [{ title: "Access to work by status", origin: "federal", updatedAt: "2026-06-18" }],
    confidence: 0.8,
  },
  {
    id: "kb-kindergeld",
    keywords: ["child", "benefit", "kindergeld", "family", "kinder", "money", "support"],
    stationId: "kindergeld",
    answer:
      "Families raising children can receive monthly child benefit (Kindergeld). Apply at the Familienkasse with your children's documents and your tax ID. It can often be backdated, so apply as soon as you can.",
    cards: [
      { kind: "explain", title: "Am I eligible?", body: "If you live here and care for your children, you likely qualify." },
      { kind: "deadline", title: "Apply — it can be backdated" },
    ],
    sources: [{ title: "Child benefit", origin: "federal", updatedAt: "2026-06-10" }],
    confidence: 0.88,
  },
  {
    id: "kb-residence",
    keywords: ["residence", "permit", "aufenthalt", "visa", "renew", "extend", "expire", "ausländerbehörde"],
    stationId: "residence",
    answer:
      "Your residence permit sets how long you can stay and whether you can work. Book your renewal at the Ausländerbehörde well before it expires, since appointment slots are limited.",
    cards: [
      { kind: "appointment", title: "Book at the Ausländerbehörde" },
      { kind: "deadline", title: "Set a renewal reminder" },
      { kind: "upload", title: "Check my documents" },
    ],
    sources: [{ title: "Residence permits overview", origin: "bamf", updatedAt: "2026-06-20" }],
    confidence: 0.85,
  },
  {
    id: "kb-german",
    keywords: ["german", "language", "course", "learn", "deutsch", "sprache", "integration", "kurs"],
    stationId: "integration",
    answer:
      "Integration and language courses combine German lessons with an orientation module. Depending on your status they can be free or low-cost. A course provider near you can confirm your entitlement.",
    cards: [
      { kind: "explain", title: "Am I entitled to a course?" },
      { kind: "office", title: "Find a course near me" },
    ],
    sources: [{ title: "Integration courses", origin: "bamf", updatedAt: "2026-06-05" }],
    confidence: 0.88,
  },
  {
    id: "kb-bank",
    keywords: ["bank", "account", "konto", "girokonto", "basiskonto", "salary", "iban"],
    stationId: "bank",
    answer:
      "A current account (Girokonto) lets you receive salary and pay rent. Even with limited documents you can open a basic account (Basiskonto) — banks are required to offer one.",
    cards: [
      { kind: "explain", title: "What's a Basiskonto?" },
      { kind: "link", title: "Accounts that accept newcomers" },
    ],
    sources: [{ title: "Basic bank account right", origin: "federal", updatedAt: "2025-12-09" }],
    confidence: 0.86,
  },
];
