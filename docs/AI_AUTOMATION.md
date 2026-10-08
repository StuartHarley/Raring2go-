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
