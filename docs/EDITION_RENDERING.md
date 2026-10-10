# Edition rendering (print and digital PDFs)

One `territory_edition` is the single source for both outputs. Rendering turns it into a PDF in three stages:

1. **Layout (pure, in `packages/publishing/src/render.ts`).** `buildEditionRenderModel` reads each page's published template version, the assigned territory content (inheritance and local overrides already applied) and the latest autosaved revision, and fills the template's zones. `renderEditionHtml` writes the HTML. Print sheets are trim size plus bleed; digital pages are trim size.
2. **PDF (service, `services/pdf-render`).** Chromium prints the HTML. For print, Ghostscript then converts to PDF/X-1a with a CMYK output intent and embedded fonts.
3. **Record (`apps/web/lib/edition-output.ts`).** The PDF is verified, stored through the normal upload and malware-scan pipeline, and recorded as a `publication_output` with its audit event, in one transaction.

Generation is a durable job, `publishing.generate_output` (Jobs console shows status, retries and dead letters). The page queues it; the worker renders it. The job is idempotent: the key is a hash of the rendered HTML, so an unchanged edition returns the output it already made, and a changed edition makes a new version.

## Template zone schema

Zones live in the template version's `headlineZones`, `copyZones`, `imageZones`, `advertiserZones` and `editableZones` arrays. All geometry is millimetres from the trim box's top-left.

| Field | Meaning |
| --- | --- |
| `id` | Unique within the template. Content is keyed by it: `content.zones[id]` (text, or a list of strings/`{title}` for list zones) or `content.images[id]` (`{url, alt}`). |
| `type` | In `editableZones`: `headline`, `copy`, `image`, `list` or `highlight_list`. |
| `x y width height` | Place the zone. All four or none. Unplaced zones stack down the live area in template order. |
| `maxCharacters`, `maxWords`, `maxItems` | Limits. Going over is a blocking layout problem for print. |
| `minDpi`, `aspectRatio` | Carried for preflight. |

A zone outside the trim size, or with partial geometry, is a blocking problem. A page with no published template is refused. Only `http(s)` and `data:image` image URLs are placed.

## What stops an output

`prepareEditionOutput` runs before anything is rendered: the actor has the grant, the edition is theirs and approved, every page is ready, print has a passing preflight on every page, and there are no blocking layout problems (copy over limit, missing required image, bad geometry; digital blocks only on bad geometry). The same check feeds the "Not available: ..." reasons on the edition page.

## Print is only "press-ready" when it is proven

The service reports facts it read from the finished file (PDF/X marker, output intent present, no RGB, fonts embedded, page count). The app independently verifies that report (`verifyRenderResult`) and rejects the result if anything is missing. A development stand-in produces a clearly labelled **proof only** file and never claims press-readiness. Production with no render service configured refuses to generate.

## Configuration

| Variable | Where | Purpose |
| --- | --- | --- |
| `RENDER_SERVICE_URL` | web app | https address of the render service (plain http only for localhost). |
| `RENDER_API_KEY` | web app and service | Shared bearer secret. |
| `OUTPUT_INTENT_ICC` | service | Path to your printer's CMYK ICC profile (e.g. FOGRA39, PSO Coated v3). **Not shipped**: it is licensed separately. Without it print renders are refused. |
| `OUTPUT_INTENT_NAME` | service | Output condition name written into the file (default `FOGRA39`). |
| `CHROMIUM_PATH`, `GHOSTSCRIPT_PATH` | service | Defaults `/usr/bin/chromium`, `/usr/bin/gs`. |
| `RENDER_TIMEOUT_MS`, `RENDER_MAX_HTML_BYTES` | service | Defaults 180000 and 20 MB. |

Deploy `services/pdf-render/Dockerfile` the same way as the ClamAV scanner (`docs/RAILWAY_CLAMAV_SCANNER.md`): build context is the repo root, give it 2 GB of memory or more, set `RENDER_API_KEY`, and mount the ICC profile. The service renders one job at a time and answers 429 when busy; the job retries.

## Not yet verified against the real thing

Everything above is unit and integration tested with the browser and Ghostscript replaced by a fake runner. **Not yet done, and needed before the first press run:**

- Build the image and render a real edition on the hosting platform.
- Open the result in a preflight tool (Acrobat Pro or pdfToolbox) and confirm PDF/X-1a, the output intent, CMYK, embedded fonts and bleed with your printer's own checks. Ghostscript's PDF/X-1a mode is strict about transparency and overprint; a layout that uses transparency needs a look.
- Agree the profile and PDF/X flavour with the printer, and add brand fonts to the image.
- Limits of the layout engine: absolute-positioned zones with text clipped to the zone (no automatic text flow between zones). Flowing a story across columns or pages is a later piece.

## Page studio and page preflight

Editors fill a page's zones in the page studio (`/app/editions/[id]/pages/[pageId]`): text zones, lists and images (chosen from the territory's uploads or uploaded there, with the pixel size read from the file; an https link with a typed size remains as a fallback). It autosaves after a pause, keeping one revision per editing run; Save and Submit work without script. Saving lays the page out with what was saved and records the warnings (copy over its limit, too many list items, a missing required image), and a page with warnings cannot be submitted. HQ then approves the page or returns it with a comment.

Page preflight derives its facts from the layout, not from a guess: colour is CMYK because the print pipeline converts every file to it; bleed is present because the renderer runs any zone touching the trim edge into the bleed; resolution is computed from each image's pixel width and its zone size. An image with no recorded pixel size **fails** preflight as unverified resolution (it is never assumed fine), and a low-resolution image fails and cannot be fixed automatically.

## Crop marks, trim and bleed boxes, and the imposed booklet

**Print sheets** are the trim size plus a margin on every side (bleed + 5mm crop mark + 1mm). Eight hairline crop marks sit in the margin, each starting one bleed away from the trim so a mark never lands in the area that is printed and cut off. A test checks every mark against the bleed box.

**Boxes.** The service writes a TrimBox and BleedBox on every page (pdf-lib), before the PDF/X conversion, and reads them back from the finished file. If Ghostscript drops them they are written back afterwards, and then the file is **not** reported press-ready (the PDF library stamps a newer PDF version than PDF/X-1a allows) and a warning says so. The app also refuses a print file that does not report confirmed boxes.

**Imposition.** Every print output also produces an imposed saddle-stitch booklet: two pages per press-sheet side, in the order that folds and stitches into reading order (the cover shares the outer front with the back cover; the middle pages share the inner sheet). The page ordering is pure code with tests (`imposition.ts`); the placement is done on real PDFs in tests (`boxes.test.ts`): each page is cut to its bleed box except on the spine side, where it is cut at the trim so bleed never prints over a neighbour; crop marks at the outer corners and fold marks at the spine; the spread gets its own boxes and goes through the PDF/X conversion again. The imposed file is stored with the output and downloaded from the edition page.

**Not handled, and needs your printer's spec before a real run:** creep (shingling), gripper margin, press-sheet size and n-up beyond a two-page spread, perfect-bound and other binding orders, and any press-specific marks (colour bars, registration targets).

The pdf-lib steps are tested on real PDFs. Chromium and Ghostscript are still replaced by a fake in tests, so the whole chain is **still unverified on a real press-grade run**.

## Images in the studio

Editors choose an image from the territory's uploads or upload one in the studio. Uploads are checked for type (PNG, JPEG, WebP), size (4MB, the serverless request cap) and that the bytes really are that kind of image; the pixel size is read from the file and stored, and the file is scanned before it can be used. Files are stored against the edition's territory, so everyone working on that edition can use them and no other territory can. Saving a page takes the stored size, never the form's, so print preflight (resolution = pixels over the zone width) cannot be fooled.

At render time each placed file is resolved to a short-lived download link, after re-checking that it exists, is clean and belongs to the edition's territory; a missing or foreign image stops the render. The output's idempotency key is made from the layout with stable placeholders for the files, so a refreshed link reuses the existing output and a different picture makes a new version. The render service needs outbound access to the storage provider's download links; no images are embedded in the request.
