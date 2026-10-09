# Audience import (MKT-001, UAT-003)

Staff import a CSV at **Audience > Import contacts** (`/app/audience/import`). Permission: `marketing.import.manage`, scoped to
the territory: staff can import only into territories they cover, and an import in another territory looks like it does not exist.

## The flow

1. **Dry run.** The file is parsed and every row is classified. Nothing in the audience changes. The result shows counts, the first 25
   rows, and a downloadable **reject report** (every refused or not-emailed row with the reason, as a CSV to fix and re-upload).
2. **Import.** Applies it. The rows are **re-checked against the audience at that moment**, so someone who unsubscribed between the
   upload and the click is still left out.
3. **Roll back** (afterwards, if needed).

Uploading the identical file again for the same territory and basis returns the existing import instead of making a second one, and
applying or reversing is claimed with a single conditional update, so a double click or two workers cannot do either twice.

## Consent: what the importer will and will not do

There are exactly two declared bases:

| Basis | What happens |
|---|---|
| **People agreed, and the file records when and where** | A row with a valid consent date (not future, not older than 24 months) **and** a consent source becomes a subscriber, with a consent event recording the date, source, import, line and basis. A row without that evidence is imported as pending. |
| **No consent record** | Everyone is imported as pending, whatever dates the file contains. |

**Pending** means the person is on file, visible to staff, traceable to the import, and **not eligible for any send** until they confirm
themselves (their own preferences page). They are not entered into journeys and are not "welcomed".

Never revived by an import: anyone suppressed (unsubscribed, bounced, complained) and anyone who unsubscribed from that territory.

There is deliberately **no** third option such as "legitimate interest" or "soft opt-in". Whether a particular list can lawfully be
emailed on that footing is a legal decision for you, not something this code decides. If you decide a list qualifies, it can be added
as a named basis with its own evidence requirements.

## File format

CSV, UTF-8, up to **2 MB and 5,000 rows** (split larger lists). Header names are matched loosely:

| Field | Accepted headers |
|---|---|
| email (required) | email, e-mail, email address |
| first name | first_name, firstname, first name, given name |
| last name | last_name, lastname, surname, family name |
| consent date | consent_date, consented_at, optin_time, opt_in_date, opt-in date, subscribed_at (`YYYY-MM-DD` or `DD/MM/YYYY`) |
| consent source | consent_source, optin_source, signup source, source |
| tags | tags, tag, labels (separated by `,` `;` or `|`, up to 10) |

Other columns are ignored and reported. Addresses are compared case-insensitively; names are cleaned of control characters.

## Existing contacts

An existing person is **never overwritten**. If they already have a subscription in the territory nothing changes; if not, and the row
has consent evidence, they are subscribed here; otherwise they are added as pending.

## Rollback

Withdraws the subscriptions the import created (status `import_rolled_back`, which is *not* an unsubscribe, so a corrected file can bring
the same people back) and appends a `withdrawn` consent event to each person's history: **consent events are never deleted**. Anyone who
has since confirmed or changed their subscription themselves is left alone. People already emailed cannot be un-emailed, and the result
says how many there were. The contact records themselves stay with nothing eligible to send; removing the people is an erasure request
and has its own four-eyes flow.

## Personal data kept

The raw rows are dropped as soon as an import is applied. What stays is the **reject report** (so staff can still fix and re-upload),
the ids of what was created, and the audit trail. The report contains the email addresses of rows that were refused or left pending.
