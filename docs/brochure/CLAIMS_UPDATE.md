# Brochure claims to correct (Raring2go! only)

The three meeting PDFs have no source files in the repo, so they cannot be edited from here. This is the exact wording to change in whatever you use to produce them. Figures are from the repository on 10 October 2026. The Advantage MIS and XplorerGroup claims are not covered: they come from other repositories.

| Where | Says now | Change to | Why |
| --- | --- | --- | --- |
| All three: Raring2go! panel | "Today: 148 tables · 72 pages · in internal UAT" | "Today: 151 tables · 84 pages · ready for internal UAT" | Counts have moved. **Confirm the UAT wording yourself:** scripted UAT has not been executed (the backlog marks it needing your cohort), so "in internal UAT" is true only if you have started it. |
| All three: panel | "Foundations, edition pipeline, newsletters and job engine are already built." | "Foundations, the full edition pipeline (templates to press-ready PDF output), newsletters, finance and the job engine are built; live provider and press checks are next." | The pipeline is now end to end, and "built" must not imply live-verified. |
| Investor brochure p.15: phase table, row 4 | "Edition Factory at scale: inheritance, control room, bulk ops: PROVING" | "BUILT · not yet run at 80+ editions" | Control Room and bulk actions now exist; scale is untested. |
| Same table, row 6 | "Finance, royalties, benchmarks, health score: PARTIAL" | "BUILT · live provider checks pending" | Royalties, scorecard, benchmarks, health score, Xero and online payments are in the repo. |
| Same table, row 7 | "AI: wire content & events GPTs, copilots, automation builder: NEXT" | "AI gateway, content and events workflows, repurposing and automation builder: BUILT · live model checks pending" | All of these are built; AI-001 to AI-004 and AUT-002 are complete. "Copilots" beyond the gateway should stay out. |
| Same table, footnote | "Status from repository review, 8 Oct 2026. 'Built' = implemented and under internal UAT; live-provider checks (email, payments, storage, malware scan) not yet executed." | "Status from repository review, 10 Oct 2026. 'Built' = implemented with automated tests; live-provider and press checks (email, payments, e-signature, accounting, storage, malware scan, PDF/X output) not yet executed." | "Under internal UAT" overstates; e-signature, accounting and PDF output are new unverified items. |
| Investor brochure p.14: stats | "Raring2go! Publishing OS 90k lines" | "about 110k lines" (TypeScript, including tests) | Count has grown. Keep the existing method footnote. |
| Roadmap, all three: "Print engine for Raring2go!" | "Rendered PDF/X output, colour management and imposition so territory editions flow straight to a Revoria press." | "Press-ready PDF/X-1a output with CMYK colour is built and awaiting press verification; basic booklet imposition is built; press-sheet layout to the printer's spec is the remaining work." | PDF/X output, CMYK output intent, crop marks, trim and bleed boxes and basic saddle-stitch imposition are built; creep, gripper margin and press-sheet layout are not, and none of it has been run on a real press. Do not imply press-proven. |
| Roadmap: "Raring2go! Business-in-a-Box launches: After its first real-territory proof point: Edition Factory, native email, finance and royalties, AI agents." | as left | "...launches to the network: the built modules go live territory by territory." | The modules are built; what remains is proof and rollout, not building them. |
| Where "80+ editions" is described as a capability (Control Room, "80+ editions on autopilot") | as left | Keep as the design target, add "designed for 80+ editions; first territory proof planned Q1 2027" | The Control Room is built but has not run at that scale. |

## Claims that are fine as they stand

"Foundations built", "edition pipeline built" in the phase 3 row, the Q1 2027 first proof point (a forecast), the Q2 2027 launch date (a forecast), and "suggest-only" AI rules (enforced in code).

## Claims to avoid until verified live

Any "taking payments", "sending email", "e-signing" or "press-ready" statement about Raring2go! in the present tense. Say "built, live checks pending".
