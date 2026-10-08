# AI and Automation Rules

## Existing Raring2go AI services
The existing content-creation GPT and events-finding GPT should be integrated through the common AI gateway. Treat them as existing domain capabilities: preserve their behaviour initially, wrap them with structured inputs/outputs, logging, source/context capture and approval routing, then optimise later.

## AI use cases
- Sales: prospect summaries, next action, outreach drafts, package suggestions, renewal/churn signals.
- Editorial: draft, localise, headline/standfirst, copy-fit, proofread, classify and repurpose.
- Events: territory/date discovery, deduplication, validation, scoring and approval queue.
- Artwork: explain preflight failures, classify assets and suggest safe fixes.
- Email: subject/preheader, campaign assembly, local modules and performance summary.
- Franchise: agreement comparison support, onboarding guidance, compliance/support summaries and health insights.
- Finance: invoice matching suggestions, aged-debt priority, royalty anomalies and management commentary.

## Guardrails
AI output never silently becomes a final legal conclusion, material financial adjustment, sensitive compliance decision or high-risk publication. Store source references and user acceptance/rejection for consequential outputs. Keep AI data access within the same permission and territory boundary as the requesting user.

## Workflow examples
- Agreement signed -> create franchise + onboarding + document tasks + territory workspace.
- Advertiser booked -> invoice/payment action + inventory reservation + artwork request + production + renewal timer.
- Article approved -> website + email module + social variants + SEO metadata.
- Master newsletter approved -> build territory variants + route approval + schedule.
- Master article corrected -> propagate only to inherited, non-overridden instances.
- Edition deadline approaching -> calculate health + raise missing content/preflight/approval exceptions.


## AI run record and gateway (AI-001)

Every AI call that matters leaves an `ai_runs` row (migration `0042`): task key and prompt version, purpose, provider and model, the requesting actor (human user or automation), organisation/territory scope, the record the output is for (`subject_type`/`subject_id`), **source references** (record ids/URLs the model was given, never copies of record bodies), a bounded and secret-redacted summary of the input, the output, token usage, estimated cost, latency, and **approval state**. Failed calls are recorded too (with real usage when the model replied but the output was unusable).

- **Approval states.** `not_required` (informational), `pending` (a person must decide before the output is used), `approved`, `rejected`. A decision is made once (conditional update), audited (`ai.approve` / `ai.reject`), and use is traceable (`applied_at`, `ai.apply`). `risk: high` tasks (legal, financial, compliance, publication) are always created `pending` and need **four-eyes**: the decider cannot be the requester. Low-risk suggestions may be accepted by the person who asked.
- **Tasks and providers** (`@raring2go/ai`): an `AiTask` owns its prompt, parsing, deterministic fallback, input summary and source references; an `AiProvider` turns a prompt into text (Anthropic, or deterministic for dev/tests). `runAiTask` is the single entry point: it runs a caller-supplied `guard` first (permission, rate limit, spend cap; a blocked call records nothing because nothing reached a model), calls the provider, parses, records the run, and writes an `ai.generate` audit event with actor type `ai`, mode `suggested`. Provider error text is never shown to users; unusable-output messages are.
- **Existing newsletter assist** (subject lines, block copy, campaign draft) keeps its gateway and now records an `ai_runs` row for every call, success or failure. Accepting a suggestion in the editor approves and applies the requester's latest pending run for that draft and task. `pending` means no human decision was recorded.
- **AI Runs console** (`/app/system/ai`): filterable by decision, with per-run detail (sources, input, output, model, usage) and approve/reject. Permissions `ai.run.view` and `ai.run.decide`: HQ network scope, franchisee own territory only; another territory's run is indistinguishable from a missing one.
- **Pricing** moved to `@raring2go/ai` (`estimateCostMinor`); the existing spend cap and rate limit are unchanged. Pricing figures remain unverified against the vendor's current price list.
- **Seed/migration impact.** Migration `0042` is additive (`DROP TABLE ai_runs` to roll back). Seed adds permissions `…0553-0554` and HQ/franchisee grants; re-run `pnpm db:seed`.


## Content drafts and external workflows (AI-002)

**Content Studio → "Draft new content with AI"** (`/app/content/new`) and **"Revise this draft with AI"** on a draft content record. The brief goes through the `content.draft` task; the user then reviews the draft (`/app/content/drafts/[runId]`) and accepts or rejects it: no copy/paste.

- **Nothing is written until accepted.** Generating only creates an `ai_runs` row (`pending`). *Accept* is one transaction: a NEW content item (or a new draft version of a draft item), the run's approval, the `applied_at` mark and the domain events commit together. *Reject* records the decision and creates nothing.
- **AI content is always a draft.** New items are `status: draft`, `source_type: ai`, with `provenance.aiRunId`/`acceptedByUserId`, `approved_at`/`published_at` null; they enter the normal approval path. **Approved or published content cannot be revised by AI** (it would bypass the approval it already had).
- **Output hygiene.** Output is validated (title and body required), length-bounded and stripped of HTML. The prompt forbids inventing dates, prices, venues, quotes or links and asks the model to list what to confirm in `notes`, which is shown prominently on the review page.
- **Permissions.** Running needs `content.ai.generate`; accepting additionally needs `content.create` (new) or `content.edit` (revision) and territory access; deciding needs `ai.run.decide`. A territory user cannot see or accept another scope's run (indistinguishable from missing).
- **Failure and limits.** Per-territory rate limit and monthly spend cap apply; usage is recorded for the cap. A failed or unusable response records a failed run and shows a safe message.

### Wiring the existing GPT workflows (adapter, not copied prompts)

The existing Raring2go content-creation and events-finding GPT workflows are not defined in this repository, so they are integrated through an adapter boundary rather than reproduced. If a workflow is exposed as an HTTPS service, set:

```
AI_WORKFLOW_CONTENT_DRAFT_URL=https://…      AI_WORKFLOW_CONTENT_DRAFT_TOKEN=…   # optional bearer
AI_WORKFLOW_EVENTS_DISCOVER_URL=https://…    AI_WORKFLOW_EVENTS_DISCOVER_TOKEN=…
```

The runner then POSTs `{ "task": "content.draft", "input": { brief, contentType, territory, existing } }` and expects `{ "output": { title, standfirst, body, notes }, "model"?: string, "usage"?: { inputTokens, outputTokens } }`. The platform validates the output exactly as it does built-in output; the run is recorded with provider `external_workflow`. Only https is accepted (http for localhost), redirects are refused, responses are size- and time-limited, and error text shows the HTTP status only, never the response body. Without a URL the built-in prompt path (Anthropic, or the deterministic dev provider) is used. A custom GPT without an API cannot be called directly: it must be fronted by a small service that accepts this contract.

**Seed/migration impact.** No migration. Seed grants franchisee `content.create`/`content.edit` for their own territory.


## Event discovery (AI-003)

`/app/content/events` ("Event Discovery" in Publishing): pick a territory and date range, run the search, review a queue of suggestions, approve or reject each. Table `event_suggestions` (migration `0043`).

- **External-only by design.** The `events.discover` task has `externalOnly: true`. A bare model has no web access and would invent events, so a real provider **refuses to run** unless the events-finding workflow is configured (`AI_WORKFLOW_EVENTS_DISCOVER_URL`, contract in the AI-002 section); the call is rejected before the guard, any spend or any record. The deterministic development provider returns clearly labelled `[Sample]` events so the queue can be exercised locally. Workflow request: `{ task: "events.discover", input: { territory, territoryId, from, to, interests, maxResults } }`; response `{ output: { events: [{ title, startsAt, endsAt?, venue?, url, summary?, sourceContext }] } }`.
- **Every candidate is validated individually**, and invalid ones are dropped with a reason rather than failing the run: title, a valid start date that is neither past nor outside the requested range, an end date within 7 days, a **source URL** (public http(s), no credentials, no private/bare hosts; tracking parameters and fragments stripped) and **source context** are all required. Text is plain, length-bounded and HTML-stripped.
- **Dedupe.** A suggestion is dropped if it matches anything already known for the territory: same normalised title+day+venue key, same canonical source URL, or the same day with a near-identical title (token similarity ≥ 0.8), against earlier suggestions in *any* status (so a rejected event never resurfaces), existing event content, and others in the same batch. A unique index on (territory, dedupe key) is the backstop. The result reports how many were skipped as duplicates or dropped as invalid.
- **Never publishes.** A suggestion is not content. Approving one runs a single transaction that creates a **draft** territory `event` content item (source URL and context carried in provenance; `approved_at`/`published_at` null) and records the decision; the item then follows normal content approval. Rejecting records the decision and a note.
- **Permissions and tenancy.** `content.event_suggestion.view|discover|decide`: HQ network, franchisee own territory only. Discovery for another territory is refused before any model spend; another territory's suggestions are neither listed nor decidable. Approval additionally needs `content.create` for that territory. Decisions are single-shot and audited (`ai.approve`/`ai.reject`; discovery as `ai.generate`).
- **Cost controls.** Same per-territory rate limit and monthly spend cap as other AI tasks; the run is recorded in AI Runs; date range capped at 90 days, results at 20 per run.


## Content repurposing (AI-004)

On an **approved or published** article, Content Studio offers **"Create variants with AI"** for website, newsletter, Facebook, Instagram, LinkedIn and magazine. Variants are listed under "Variants and approval" with their status, a preview and an **Approve** button.

- **Source must be approved.** AI repurposing refuses draft or archived content: a variant made from unapproved text would bypass the source's approval. Network (HQ-owned) content can only be repurposed or approved from a network context, never a territory's (this also closes a gap in the existing variant functions).
- **One AI run per channel** (task `content.repurpose`, recorded in AI Runs). Output is normalised into exactly the shape the rest of the platform consumes; identifiers and derived fields (website slug, newsletter block reference, word-count target) are set by the platform, never taken from the model. Text is plain, bounded per channel (e.g. Instagram caption 2,200, LinkedIn 1,300, SEO title 70) and HTML-stripped.
- **Variants link back.** Each variant version records `sourceContentItemId`, `sourceVersionId`, `aiRunId` and the generating task; variants start as `ai_draft`. Regenerating an approved variant never overwrites it: it becomes `needs_review` with a new version.
- **Fact guard.** Specific claims in the output (links, emails, prices, times, "12 March" dates, multi-digit numbers) that do not appear in the source are listed on the variant ("Check before approving: not found in the source - £5"). It does not block, because copy may legitimately say "5 ideas", but it puts the check in front of the approver. Derived fields are excluded.
- **Approval and audit are preserved.** Approving a variant approves its current version, records the AI task decision (`accepted`), approves and applies the linked AI run, and writes `content.variant.approved`. Variant generation writes one transaction for all successful channels; one channel failing never discards the others (failures are reported per channel).
- **Permissions.** Generating needs `content.ai.generate`; approving needs `content.ai.approve` (HQ network, franchisee own territory). Seed adds no new permissions for this ticket.


## Assistants (section 9): sales, artwork, finance, franchise

Package `@raring2go/assistants`; panels sit inside the page where the job is done.

**Design rule: facts are computed, a model only words them.** Every assistant has a deterministic, tested engine that works out the facts and verdicts from the records (renewal risk, aged-debt ranking, payment matches, royalty anomalies, preflight fix verdicts, onboarding next steps, document differences). Each panel shows that analysis **with no model at all**. The optional AI step turns it into friendlier wording or a draft, and the task's `parse` merges the model's text into the computed result: a model cannot change a risk level, a score, a fixability verdict, a tone ceiling, a figure or a list of items, cannot add an item that was not offered, and its text is stripped of markup and bounded. Where output is a draft or money or law is involved it needs a person to review it.

| Assistant | Where | Computed (no model) | AI task (key, risk, approval) | Guard rails specific to it |
| --- | --- | --- | --- | --- |
| Sales | Advertiser 360 | Renewal risk with a stated reason for every point; ranked next-best actions; package ideas near typical spend | `sales.advertiser_brief` (low, none); `sales.outreach_draft` (low, **review**) | Risk level, score and actions cannot be changed; invented packages dropped; any money amount in a draft that is not in the advertiser's record becomes `[amount to confirm]` and the sender is told; nothing is ever sent |
| Artwork | Edition Studio, Preflight | Plain-English explanation and fix verdict per preflight finding; rules-based file classifier | `artwork.preflight_help` (low, none) | The most cautious of the engine's and the knowledge base's verdict wins; low resolution is always "needs new artwork"; a summary claiming "print-ready" while a blocker remains is discarded |
| Finance | Commercial Command Centre, Royalties | Aged-debt ranking by lateness, size and payment history; payment-matching suggestions; royalty anomaly flags from each territory's own history | `finance.chase_notes` (low, none); `finance.royalty_notes` (**high**, **review**) | Chase tone cannot be firmer than the lateness allows; matches are applied only through the existing audited allocation (needs `advertiser.payment.allocate`), recomputed from live balances; royalty notes state "questions, not findings", and the requester cannot approve them |
| Franchise | Franchisee 360 | Onboarding next steps (tasks waiting on others are never suggested); attention items across compliance, insurance, agreement and renewal; health insight from the Franchise Health Score | `franchise.briefing` (low, none); `franchise.agreement_comparison` (**high**, **review**) | The lists are fixed; the comparison reports only differences found by the diff, carries a fixed "not legal advice" notice, is Head Office only, and needs a second person |

**Permissions.** `artwork.ai_assist`, `advertiser.ai_assist`, `finance.ai_assist`, `franchise.ai_assist`: HQ Admin at network scope, Franchisee for their own territory. The analysis needs only the permission to see the record itself; the AI controls need the assistant permission and a configured provider. Agreement comparison additionally needs the assistant permission at **network** scope. The royalty review needs the network royalty view; a territory user is never shown a comparison across territories.

**Tenancy.** Facts are built from records loaded through the advertising, finance, franchise and publishing services, which already limit them to the actor's scope, so an assistant never sees what the person asking cannot. Cross-territory and no-permission cases are tested against Postgres for each assistant.

**Records and cost.** Every AI step goes through the gateway: an `ai_runs` row (actor, purpose, source references, bounded input, output, approval state), a usage event, the per-territory rate limit and monthly spend cap, and an audit event. Re-reading a stored run never calls a model. Stored inputs are summaries, not record bodies or the user's own talking points.

**Without a provider.** With `AI_PROVIDER=none` (the default) panels show the calculated analysis and say AI wording is not switched on. `AI_PROVIDER=deterministic` produces template output for local testing.

**Known limits.** The sales assistant does not yet know which packages an advertiser has bought (not recorded against the advertiser), so package ideas rest on typical spend. Agreement comparison compares the structured `content` of two agreement versions, not signed PDFs. The existing Raring2go GPT workflows are still only wired for content drafts and event discovery (see above); these assistants use the built-in prompts.

**Migration/seed impact.** No migration. Four new permissions and their grants (`pnpm db:seed` on existing environments). Also fixes `allocatePayment`, which built a non-UUID event id when an invoice became fully paid (found by the Postgres test; it would have failed on real persistence).
