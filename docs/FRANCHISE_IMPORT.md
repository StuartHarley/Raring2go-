# Franchise import (UAT-003)

Head office imports a CSV of franchises and their territories at **Franchisees > Import franchises and territories** (`/app/franchisees/import`). Permission: `franchise.import manage`, network scope, granted to head office roles only. A franchisee cannot upload, read, list, apply or reverse an import, and an import looks like it does not exist to them (tested).

## The flow

1. **Dry run.** The file is parsed and every row classified. No franchise or territory record changes. The result shows counts, the first 25 rows, and a downloadable **report** of every row that was not added, with the reason.
2. **Import.** Applies it. Every row is **re-checked against the territories and franchises as they are at that moment**, so a code or name added since the upload is left out, never duplicated.
3. **Roll back** (afterwards, if needed).

Uploading the identical file again returns the existing import. Applying or reversing is claimed with one conditional update, so a double click or two workers cannot do either twice.

## What a row creates

A franchise **organisation**, its **territory** (active, linked to that organisation), the **franchise record** (status active; stage *trading* or *onboarding*, trading by default; launch and renewal dates if given; tags), and a **primary contact** if the row has a contact name, email or phone.

An import **never** creates a user, a role assignment, an agreement, an invoice, a payment or any consent, never sends anything, and never sets a franchise owner. Getting the franchisee into the platform stays the invitation flow's job, after which the contact can be linked.

## What it will not do

Existing records are **never merged or overwritten**. Refused, with a reason: a missing territory code, territory name or franchise name; a territory code that is not 2 to 15 letters, numbers or hyphens; an invalid email; a date that is not real (yyyy-mm-dd or dd/mm/yyyy); a renewal that is not after the launch; a stage that is not `trading` or `onboarding`; a code or franchise name repeated earlier in the file; a territory code that already exists (including removed territories, because codes are unique for ever); a franchise name that already exists.

## File format

CSV, UTF-8, up to **512 KB and 500 rows**. Headers are matched loosely:

| Field | Accepted headers |
|---|---|
| territory code (required) | territory code, code, territory id, area code |
| territory name (required) | territory, territory name, area, area name |
| franchise name (required) | franchise, franchise name, business, business name, company, trading name |
| contact | contact, contact name, owner, owner name, franchisee |
| email | email, e-mail, contact email, owner email |
| phone | phone, telephone, tel, mobile |
| launch date | launch date, launched, start date, opened |
| renewal date | renewal date, renewal, agreement renewal |
| stage | stage, lifecycle, status |
| tags | tags, labels (up to 10) |

Other columns are ignored and reported. Values are cleaned of control characters; the report defuses spreadsheet formulas.

## Rollback

A franchise is removed only if **nothing but the import's own records refers to it, its territory or its organisation**, and it is still as the import left it (active, no owner, standard support). "Refers to" is found from the database's own foreign keys, so a table added later (agreements, editions, advertisers, invoices, users' assignments, anything) is covered automatically, and any reference at all, even a removed one, keeps the franchise. Anything kept is counted as "left alone". Removed records are soft-deleted; the territory gives up its code (it is renamed `CODE~removed-<import>`) so a corrected file can use the code again.

## Personal data kept

The parsed rows (which include contact names, emails and phone numbers) are dropped as soon as an import is applied. What stays is the report, the ids created and the counts. The contact details live on the franchise contact records the import created. The audit trail records the dry run, the commit and any rollback (`franchise.import.*`).

## Operations

New permission: run the seed in every environment (`pnpm db:seed`). New table `franchise_imports` (migration 0061).

## Not built

Importing publishing content (editions, articles) from another system, updating existing franchises from a file, and manual column mapping.
