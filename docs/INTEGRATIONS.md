# Integration Boundaries

Keep provider-specific code behind adapters. The product should be able to swap providers without changing the domain model.

- E-sign: agreement envelope creation, signer order, reminders, webhook completion, signed PDF/certificate retrieval.
- Payments: card and Direct Debit initiation/status/refund webhooks; idempotent reconciliation.
- Accounting: invoice/payment/credit-note mapping and sync where the accounting ledger remains authoritative.
- Bulk email delivery: send payload, domain authentication status, delivery/bounce/complaint/click events; audience and campaign UX remains native.
- Object storage/file pipeline: original and derived assets, access control, virus/security checks, conversion/preflight jobs.
- Public website/CMS: publish approved articles/events/offers/competitions/digital editions and receive enquiries/subscriptions.
- AI: common gateway exposing existing Raring2go content/events workflows plus future model/tool adapters.

Every webhook must authenticate the sender, deduplicate events and retain the provider event ID in the audit/job history.
