# Edition Factory: how it works and how to check it

One `territory_edition` is the single record behind a territory's print and digital magazine. This is the whole path, with the screen for each step. Rendering details are in `EDITION_RENDERING.md`.

| Step | Screen | Who (seeded grants) | What it enforces |
| --- | --- | --- | --- |
| Template library | `/app/editions/templates` | HQ (`edition.template`) | Zones validated against the page size; locked furniture required; approve then publish; published versions never change, a change is a new version. |
| Season and master | `/app/editions/seasons` | HQ (`edition create/approve`) | Page count multiple of 4, real dates in deadline order; master must be approved before generating. |
| Territory editions | same | HQ | One edition per territory per season; generation is repeatable and skips existing ones. |
| Flatplan | `/app/editions/[id]/flatplan` | HQ, franchise (`edition.page edit`) | Territory scope on every change; only published templates; locked pages (cover) cannot be moved or changed locally; frozen once approved. |
| Page studio | `/app/editions/[id]/pages/[pageId]` | HQ, franchise (`edition.content edit_local`) | Autosave, layout warnings block submission, one revision per editing run. |
| Page review | same | HQ (`edition approve`) | Approve, or return with a comment. |
| Preflight | same | HQ (`edition.preflight override`) | Derived from the layout; unverifiable image resolution fails; safe fixes make a derived result only. |
| Edition lifecycle | `/app/editions/[id]` | HQ | Submit needs a flatplan; approve needs every page ready; publish needs a generated digital output; published editions cannot be reopened. |
| Outputs | same | HQ (`edition.output`) | Queued as a durable job; print needs a passing preflight on every page; the file is verified before it is recorded. |
| Control Room | `/app/editions` | HQ, franchise (own territory) | Filters; bulk submit, approve, publish, queue digital or print for up to 100 editions, each authorised and applied on its own. |

## UAT checklist (the full path, end to end)

1. Create a template with a headline, a copy zone and an image zone; approve and publish it.
2. Create a season (8 pages), approve the master, generate editions for two territories.
3. Create the flatplan, assign the template to pages, add local content, move a page; confirm the cover will not move.
4. In the page studio, exceed a word limit: the warning shows and Submit is refused. Fix it, submit.
5. As HQ, return a page with a comment; as the editor see it; resubmit; approve.
6. Add an image with no pixel size: preflight fails as unverified; enter the size and re-run: passes. Enter a low pixel size: fails and offers no fix.
7. Submit the edition, approve it, generate the digital output, publish; confirm the public magazine page lists it.
8. Generate the print output with the real render service (see `EDITION_RENDERING.md`, "Not yet verified") and check the PDF in Acrobat Pro or pdfToolbox.
9. In the Control Room, tick several editions and run a bulk action; confirm the ready ones moved and the rest were skipped.
10. As a franchisee in another territory, confirm none of the above can be reached by pasting an edition or page id.

## Known limits

- Zones are absolutely positioned; text does not flow between zones or pages, and there are no crop marks.
- Images are linked by https URL with a recorded pixel size; picking from the upload library is not wired into the studio yet.
- Franchisees edit and submit pages; only HQ holds the preflight and approval grants in the seed data.
- Not yet run against a real Chromium and Ghostscript.
