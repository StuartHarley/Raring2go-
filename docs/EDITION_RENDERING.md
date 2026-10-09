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
- Limits of the layout engine: absolute-positioned zones with text clipped to the zone (no automatic text flow between zones) and no crop marks yet. Flowing a story across columns or pages is a later piece.
