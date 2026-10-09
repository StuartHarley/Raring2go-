# Decision Briefs

Four things are waiting on you, not on code. Each brief says what is needed, the realistic options, my recommendation,
what I will build once you decide, and an **answer sheet** you can fill in or reply to in one message. Nothing here is
built yet; where the code already helps, that is stated.

| # | Decision | Blocks | Effort once decided |
| --- | --- | --- | --- |
| 1 | Franchise Staff role and delegation rules | Franchisees managing their own team | Medium (about one package) |
| 2 | Online payment provider and rules | Advertisers paying invoices online (ADV-006) | Medium |
| 3 | Accounting system | Invoices and credit notes reaching the books (ADV-006) | Small to medium |
| 4 | E-signature provider | Real agreement signing (FRN-003) and advertiser acceptance (ADV-005) | Medium |

Recommended order: **1 and 3 first** (smallest, most valuable for the pilot), then 4, then 2.

---

## 1. Franchise Staff role and delegation

### What is needed
Today only Head Office can give people roles or invite them (`/app/roles`). The RBAC matrix already intends franchisees to
manage their own staff. That needs a **Franchise Staff** role and a rule for who may hand out what.

### What already protects you
These are built and tested, so any delegation you choose is safe by construction:
- Nobody can give out access they do not hold, or more widely than they hold it (so a franchisee can never grant network access).
- A role given in one territory only applies in that territory; cross-territory access is denied on the server.
- An administrator always remains; history is kept; every change is audited.

### Decisions
**A. What can Franchise Staff do?** Proposed default (least privilege), all limited to the franchisee's own territory:

| Area | Proposed Franchise Staff | Franchisee (for comparison) |
| --- | --- | --- |
| Advertiser CRM (contacts, activity, opportunities) | View and edit | Full, including proposals and booking |
| Proposals and bookings | Draft only; cannot book or send | Create, send, book |
| Invoicing and payments | No access | View; record payments if granted |
| Royalties | No access | View own statement |
| Content and editions | Create and edit drafts | Approve and publish locally |
| Audience and newsletters | View; draft campaigns | Send |
| Social posts | Draft | Approve and schedule |
| Franchise Hub, agreements, compliance | View obligations only | View and submit evidence |
| Roles and invitations | None | Invite and remove their own staff |

**B. Who may delegate, and how far?**
1. *Franchisee invites and removes Franchise Staff only* (recommended): they can never create another franchisee-level user.
2. Franchisee may also give staff individual extras from a short approved list (for example "may send newsletters").
3. Head Office only (current behaviour): staff are always added by Head Office.

**C. Safeguards to decide**
- Seat limit per franchise (for example 10), or unlimited?
- Must Head Office be told (audit entry only, or an email) when staff are added?
- Should a franchisee leaving or being suspended automatically end their staff's access? (Recommended: yes.)
- May staff see the audit trail for their own territory? (Recommended: no.)
- Should financial visibility (invoices, debt) be a separate switch the franchisee can grant to a named person?

### Options and trade-offs
| Option | Good | Cost |
| --- | --- | --- |
| 1B-1 Fixed role, franchisee invites/removes | Simple, predictable, easy to support and test | Franchisees cannot fine-tune |
| 1B-2 Fixed role plus approved extras | Flexible for larger territories | More screens, more combinations to test and explain |
| 1B-3 Stay Head Office only | No build, tightest control | Head Office carries all onboarding and leavers, a scaling and support burden |

### Recommendation
Option 1 with the proposed matrix, a 10-seat default, automatic removal when the franchisee is suspended or leaves, and
audit-only notification. Add extras later if real franchisees ask.

### What I will build
A built-in **Franchise Staff** role (permissions and scope as you decide), a franchisee-facing "My team" page to
invite, change and end staff within the guards above, leaver handling, audit events, role-by-role denial tests for the new
role (including cross-territory), and documentation. Roughly one package.

### Answer sheet
- Matrix in A: approved as shown / changes:
- Delegation option (B): 1 / 2 / 3
- Seat limit:
- Notification to Head Office on changes: audit only / email
- Auto-remove staff when the franchisee is suspended or leaves: yes / no
- Staff may see territory audit: yes / no
- Separate financial-visibility switch: yes / no

---

## 2. Online payment provider and rules

### What is needed
Advertisers can currently be invoiced and payments recorded by staff (bank transfer, manual). There is no way for an advertiser
to pay online. The platform already has a neutral payment port, de-duplicates provider payment events in the database, allocates
payments to invoices, and keeps issued invoices immutable. What is missing is a provider and the rules around it.

### Decisions
**A. Do you want online collection for the pilot at all?** Many pilots run on bank transfer with staff reconciling. If bank
transfer is acceptable for the pilot, this can wait and carries no risk. (Recommended for a *controlled* pilot.)

**B. If yes, which provider and method?**

| Option | Best for | Considerations |
| --- | --- | --- |
| **GoCardless** (Direct Debit, also instant bank pay) | Recurring B2B advertiser invoices in the UK, low fees | Mandates take days to set up; payments settle slowly; limited for one-off card payers |
| **Stripe** (card, plus bank methods) | One-off invoice payments, fast, strong developer tooling | Card fees are higher; chargebacks; a hosted payment page keeps card data out of our system |
| **Bank transfer plus open-banking matching** | Lowest cost, no card data | Reconciliation depends on references; the finance assistant already suggests matches |
| Adyen / Worldpay | Larger volumes, enterprise needs | Heavier onboarding and cost; not proportionate for a pilot |

**C. Rules**
- Pay by hosted payment link per invoice (recommended; no card data ever touches our system) or saved mandate/card?
- Who receives the money: each franchisee's own account, or Head Office with franchisee royalties settled afterwards? This changes the legal and accounting model and needs your accountant's view.
- Refunds: who may refund, up to what amount, and is a credit note always raised first (recommended)?
- Part payments, overpayments and failed or reversed payments: treat as allocations against the invoice, or hold as unallocated credit?
- Surcharges and late-payment fees: none, or a fixed rule?
- Reporting: should failed and disputed payments raise a task for the franchisee and Head Office?

### Recommendation
For the controlled pilot, stay on bank transfer with staff reconciliation (option A: no). After the pilot, add **hosted
payment links** with Stripe for one-off invoices (or GoCardless if recurring Direct Debit is the real need), paid into the
issuing organisation's account, credit note before any refund, and failures raising a task.

### What I will build
A provider adapter and verified, idempotent webhook (same pattern as the e-signature endpoint), a pay-by-link action on issued
invoices, automatic allocation of confirmed payments, failure and dispute handling that raises tasks, audit events, tests
for duplicate and out-of-order events, and a drill scenario. Roughly one package.

### Answer sheet
- Online collection in the pilot: yes / no (bank transfer only)
- Provider: Stripe / GoCardless / other:
- Method: hosted payment link / mandate / both
- Money goes to: issuing organisation / Head Office
- Refund rule (who, limit, credit note first):
- Part payment and overpayment treatment:
- Surcharges: none / rule:

---

## 3. Accounting system

### What is needed
Issued invoices and credit notes are queued and retried by a background job, but the only provider is a development stand-in.
In production nothing is sent until you choose a system. The adapter pushes invoices and credit notes; it does not yet pull
payments back.

### Decisions
**A. Which system?** Whatever the business (and each franchisee, if they differ) already uses.

| Option | Considerations |
| --- | --- |
| **Xero** | Common with UK small businesses; good API; contacts, invoices and credit notes map cleanly |
| **QuickBooks Online** | Also common; similar mapping |
| **Sage** | Common in UK; API varies by product |
| Export file only (CSV) | No integration risk, manual import, no automatic status |

**B. Whose books?** One set of books for Head Office, or each franchisee's own? (Advertiser invoices are issued by the franchise
organisation, so per-franchisee connections are the likely answer.) This decides whether credentials are stored per franchise
(supported by the existing encrypted connection store) or once.

**C. Mapping you must provide:** account codes for sales, VAT code mapping (standard, zero-rated, exempt) and a contact rule
(match advertiser by name or create a contact if none).

**D. Direction:** push only (build now), or also pull paid status back to reconcile payments (a further step).

### Recommendation
Xero (or whichever the business already uses), per-franchisee connection through the existing connections page, push
only first, account and VAT mapping held in configuration, and failures visible on `/app/finance/accounting` as built.

### What I will build
The adapter behind the existing port with idempotency keys, connection setup, contact matching, VAT and account mapping,
failure surfacing, tests against recorded provider responses, and a drill scenario. Small to medium.

### Answer sheet
- System:
- One set of books or per franchisee:
- Sales account code(s) and VAT mappings:
- Contact rule: match by name / create if missing
- Pull paid status back: not now / yes

---

## 4. E-signature provider

### What is needed
Franchise agreements go through approval, signing order and execution, and the platform already accepts verified signed-event
callbacks, fetches and scans the signed PDF, and locks the agreement. What is missing is the **outbound** side: actually
sending the document to a provider and translating their callbacks into the platform's neutral event format
(`docs/ESIGN_PROVIDER_CONTRACT.md`).

### Decisions
**A. Which provider?**

| Option | Considerations |
| --- | --- |
| **DocuSign** | Most recognised; strong audit certificate; higher cost |
| **Adobe Acrobat Sign** | Good if the business already uses Adobe; similar capabilities |
| **Dropbox Sign** | Simpler and cheaper; fewer enterprise features |
| **Yousign** | EU/UK-focused, aligned to eIDAS levels; good value |

**B. Level of signature.** A simple electronic signature is generally enough for most commercial agreements in the UK, but this
is a legal question for your solicitor. Confirm whether franchise agreements need an advanced signature or identity checks.

**C. Scope:** franchise agreements only (build now), or also advertiser proposal acceptance (ADV-005)? Advertiser acceptance
currently works by recording acceptance in the portal; a provider is only needed if you want signed, certified acceptance.

**D. Who sends and who signs:** signer order is franchisee then Head Office today. Confirm, and confirm reminders and expiry
(for example remind at 3 and 7 days, expire at 30).

### Recommendation
Pick the provider your solicitor is comfortable with (DocuSign or Yousign are the usual choices), confirm simple signatures
suffice, franchise agreements first, reminders at 3 and 7 days, expiry at 30.

### What I will build
Outbound send, a callback translator that signs events into the neutral format, configuration of trusted document hosts
and secrets, reminders and expiry through the job runtime, tests with recorded provider payloads, and a drill scenario.
Medium.

### Answer sheet
- Provider:
- Signature level confirmed by solicitor: simple / advanced / other
- Scope: franchise agreements only / also advertiser acceptance
- Reminders and expiry:

---

## How to answer

Reply with the answer sheets (any you are ready for) and I will build them in the recommended order. For anything you are
unsure of, "use your recommendation" is a valid answer.
