# Data minimization — the "Personal Data Wallet"

The challenge asks for data minimization with data stored "on the end device".
Wegweiser takes that literally and makes it visible.

## The principle

> The most private data is the data you never send.

A newcomer's situation — status, family, documents, where they are in the
process — is exactly what makes answers accurate, and exactly what's sensitive.
Wegweiser keeps that split clean: **personalization happens on the device;
only de-identified, non-identifying signals leave it.**

## Four concrete techniques

### 1. The wallet lives on the device
The whole profile (`lib/wallet.ts`) is stored in `localStorage`, or in
`sessionStorage` in **guest mode** (erased when the tab closes). It is never
POSTed as an object. There is no account, no server-side user record, nothing to
breach. The NestJS backend is stateless.

### 2. Only opaque category tags are sent
When context helps, the app derives coarse tags (`lib/privacy.ts → deriveTags`):

```
status:asylum   family:has_children   region:bavaria   lang:en
```

These are categories thousands of people share — not identity. Never sent: name,
country of origin, address, document contents, date of birth, or anything the
user didn't type. The server **sanitizes** tags too, dropping anything that isn't
a strict `key:value` pattern, so free text can't sneak through.

### 3. On-device de-identification (with server-side defense in depth)
Free-text questions pass through a PII scrubber **before** they can be sent
(`deidentify`): emails, phone numbers, street addresses, postal codes and dates
are replaced with placeholders. The NestJS API runs the **same** scrub again so a
misbehaving client can never get raw PII into the LLM or any log.

Live example (verified): the input

```
How do I register my address at Goethestraße 12, 86150?
```

leaves the device as

```
How do I register my address at [address], [postcode]?
```

### 4. k-anonymity guard
A combination specific enough to re-identify (e.g. a rare language + a tiny region
+ a niche flag) is coarsened before sending (`kAnonymityGuard`) — the app keeps
the coarse status and region and drops the long tail.

## Selective disclosure (the actual "wallet" idea)
The guided interview asks **only** what improves the current answer, one tap at a
time, and every question can be skipped. This is the self-sovereign-identity
pattern: reveal a fact just-in-time, only when it helps, and only as a tag.

## Transparency as a feature
Every answer ships with a **"This is what leaves your device"** receipt
(`components/PrivacyReceipt.tsx`) showing the exact de-identified query and the
exact tags. Trust isn't claimed; it's shown. The Wallet tab shows the same thing
for the whole profile, plus a one-tap **"Erase my wallet from this device."**

## What a counselor sees
On escalation, a human counselor sees only what the user explicitly chooses to
share in that moment — consistent with Integreat's existing Zammad hand-off.
