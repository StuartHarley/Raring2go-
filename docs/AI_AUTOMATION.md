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
