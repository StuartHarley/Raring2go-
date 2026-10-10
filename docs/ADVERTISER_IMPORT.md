# Advertiser import (ADV-001, UAT-003)

Staff import a CSV of local businesses at **Advertisers > Import a list of advertisers** (`/app/advertisers/import`). Permission: `advertiser.import manage`, scoped to the territory: a franchisee can import only into their own territory (HQ into any), and an import in another territory looks like it does not exist.

## The flow

1. **Dry run.** The file is parsed and every row is classified. No advertiser record changes. The result shows counts, the first 25 rows, and a downloadable **report** of every row that was not added, with the reason (a CSV to fix and re-upload).
2. **Import.** Applies it. Every row is **re-checked against the advertisers as they are at that moment**, so a business added since the upload is left out, never duplicated.
3. **Roll back** (afterwards, if needed).

Uploading the identical file again for the same territory returns the existing import instead of making a second one, and applying or reversing is claimed with a single conditional update, so a double click or two workers cannot do either twice.

## What an import creates

For each new business: an advertiser organisation, an **advertiser record as a prospect** (relationship state "new") in the chosen territory, its tags and notes, a **primary contact** if the row has a contact name, email or phone, and an activity entry saying where it came from (`source` is `import:<id>`, so every imported record is traceable to its import).

An import **never** sends anything, prices anything, invoices or books anything, assigns an account owner, or **signs anyone up to emails**. A business contact is held for account management only; the parent audience is a different system that an advertiser import never touches (tested).

## What it will not do

An **existing business is never merged or overwritten.** A row whose name matches an existing advertiser (ignoring case and extra spaces: the same test the "add an advertiser" form uses) is reported as already an advertiser and left exactly as it was. Also refused, with a reason: a row with no business name, a contact email that is not a valid address, and a name repeated earlier in the file.

## File format

CSV, UTF-8, up to **1 MB and 1,000 rows** (split larger lists). Header names are matched loosely:

| Field | Accepted headers |
|---|---|
| business name (required) | business, business name, company, company name, organisation, name, advertiser |
| contact | contact, contact name, contact person, owner |
| email | email, e-mail, email address, contact email |
| phone | phone, telephone, tel, mobile |
| role | role, job title, position |
| tags | tags, labels, category (separated by `,` `;` or `|`, up to 10) |
| notes | notes, comments |

Other columns are ignored and reported. Values are cleaned of control characters. The downloadable report defuses spreadsheet formulas (a cell starting `=`, `+`, `-` or `@`).

## Rollback

Removes the businesses the import created **only if they are still exactly as the import left them**: still a prospect, with only the contact and activity entry the import made, and no opportunity, proposal, booking, invoice, artwork, task, renewal, production request or reservation. Anything that has been worked on since is **kept** and counted as "left alone". Removed records are soft-deleted (so the audit trail still makes sense) and their names become available again, so a corrected file can bring them back.

## Personal data kept

The raw rows are dropped as soon as an import is applied. What stays is the report (it contains business names and the reason each was refused), the ids of what was created and the counts. The audit trail records the dry run, the commit and any rollback (`advertiser.import.*`), with counts and the source description.

## Not built

Importing franchise records and publishing content (UAT-003 still needs those), updating existing advertisers from a file, and mapping columns by hand (headers are matched by name).
