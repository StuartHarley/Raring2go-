# Data Model

This is the domain model to guide the first schema. Names may evolve, but the ownership and lifecycle boundaries should remain explicit.

## Identity & access
`users`, `organisations`, `memberships`, `roles`, `permissions`, `role_permissions`, `user_role_assignments`, `territory_access`, `delegations`, `sessions`, `audit_events`

## Franchise
`franchise_candidates`, `franchises`, `territories`, `territory_postcodes`, `franchise_agreements`, `agreement_versions`, `agreement_signers`, `agreement_obligations`, `documents`, `insurance_policies`, `compliance_requirements`, `compliance_records`, `training_modules`, `training_completions`, `support_plans`, `support_actions`

## Advertiser & sales
`advertisers`, `advertiser_contacts`, `opportunities`, `pipeline_events`, `products`, `packages`, `inventory_slots`, `proposals`, `proposal_items`, `campaigns`, `campaign_channels`, `campaign_assets`, `proofs`, `renewals`

## Finance
`invoices`, `invoice_lines`, `payments`, `payment_allocations`, `credit_notes`, `refunds`, `accounting_mappings`, `royalty_rules`, `royalty_statements`, `royalty_lines`, `royalty_adjustments`

## Publishing
`seasons`, `master_editions`, `territory_editions`, `edition_pages`, `page_templates`, `template_versions`, `template_zones`, `content_items`, `content_variants`, `content_inheritance`, `events`, `offers`, `competitions`, `assets`, `asset_versions`, `preflight_results`, `publication_outputs`

## Audience & communication
`audience_profiles`, `consents`, `preferences`, `subscriptions`, `segments`, `segment_memberships`, `email_templates`, `email_campaigns`, `email_variants`, `email_blocks`, `email_deliveries`, `suppressions`, `social_posts`, `content_calendar_items`

## Automation & AI
`workflow_definitions`, `workflow_versions`, `workflow_runs`, `workflow_steps`, `tasks`, `approvals`, `exceptions`, `jobs`, `ai_runs`, `ai_sources`, `ai_outputs`, `notifications`

## Analytics
`metric_definitions`, `metric_snapshots`, `territory_benchmarks`, `franchise_health_snapshots`, `advertiser_metrics`, `edition_metrics`, `email_metrics`

## Critical relationships
- `franchises` own one or more `territories`; users gain access via memberships/role assignments/territory access.
- `territory_editions` belong to a territory and season/master edition and contain ordered `edition_pages`.
- `edition_pages` reference a published template version plus content placements and inheritance/override metadata.
- `campaigns` connect advertisers to print/digital/email/social inventory and finance.
- `invoices` are generated from booked commercial records and payment allocations determine balance.
- `franchise_agreements` and agreement versions drive term dates, fee/royalty rules and onboarding triggers.
- `audience_profiles` have immutable consent history and current preferences/suppression state.
- workflow/AI/audit records reference source entities using typed entity identifiers plus strongly typed foreign keys where lifecycle rules require them.