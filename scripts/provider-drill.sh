#!/usr/bin/env bash
# Provider failure drill (UAT-004). Proves, against the real database with each provider forced to fail, that the
# platform fails visibly and recoverably: nothing is reported as done that was not, nothing is lost, nothing is
# duplicated, and the operator can see and retry it. Every scenario is an automated test; this runs them and prints
# a pass/fail table you can attach to the pilot sign-off.
#
# Scenarios whose steps build on each other run their whole file (empty pattern); the rest run just their test.
#
# Usage: pnpm drill:providers        (needs DATABASE_URL pointing at a migrated, seeded database)
# Live drills with real providers (revoke a credential in staging and watch): docs/PROVIDER_FAILURE_DRILLS.md
set -uo pipefail

export RUN_DB_TESTS=1
failures=0
rows=()

run() { # label | package filter | test file ("" for package-wide) | test name pattern
  local label="$1" pkg="$2" file="$3" pattern="$4"
  local out
  if out=$(pnpm --filter "$pkg" exec vitest run ${file:+"$file"} ${pattern:+-t "$pattern"} 2>&1); then
    if echo "$out" | grep -qE "Tests +[0-9]+ passed"; then rows+=("PASS|$label"); else rows+=("SKIP|$label (no matching test ran)"); failures=$((failures + 1)); fi
  else
    rows+=("FAIL|$label"); failures=$((failures + 1)); echo "$out" | tail -25
  fi
}

run "Email provider rejects or is down: failure is recorded as recoverable"        @raring2go/email ""                          "provider rejection and outage"
run "Mailbox (Microsoft) rejects or token fails: recoverable failure"              @raring2go/email ""                          "access-token failure"
run "Reminder email fails: reminder stays scheduled and sends on the next run"     @raring2go/web   lib/compliance-jobs.test.ts ""
run "Social provider has no real connection: fails closed, staff retry after fix"  @raring2go/web   lib/social-runtime.test.ts  "fails closed in production"
run "Worker dies mid-publish: post flagged outcome-unknown, never double-posted"   @raring2go/web   lib/social-runtime.test.ts  "stuck mid-publish"
run "Two workers race: a post is published exactly once"                           @raring2go/web   lib/social-runtime.test.ts  "exactly once"
run "Accounting system down: hand-off retried with backoff, stops, then retried"   @raring2go/web   lib/finance-wiring.test.ts  "failing hand-off"
run "Accounting provider absent in production: fails closed, nothing marked synced" @raring2go/web  lib/finance-wiring.test.ts  "fails closed in production"
run "Xero down, rejecting, or revoked: retried, kept waiting for a person, never marked synced; token refreshed once" @raring2go/web lib/xero-runtime.test.ts ""
run "Stripe/GoCardless: duplicate or forged events, refunds, disputes, wrong account or currency: money recorded once, nothing reversed automatically" @raring2go/web lib/payments-runtime.test.ts ""
run "SignWell: forged/stale/tampered events, unconfirmed completion, replay: nothing executes until SignWell itself confirms; executed once" @raring2go/web lib/signwell-runtime.test.ts ""
run "E-sign document fetch fails: no claim recorded, provider retry succeeds"      @raring2go/web   lib/esign-runtime.test.ts   ""
run "E-sign untrusted host, bad checksum, not a PDF, or failed scan: refused"      @raring2go/web   lib/esign-runtime.test.ts   ""
run "E-sign webhook delivered twice or out of order: applied once"                 @raring2go/web   lib/esign-runtime.test.ts   "applies each signer once"
run "File scan infected or tampered: nothing stored or downloadable"               @raring2go/web   lib/franchise-documents.test.ts "stores nothing when the file is refused"
run "Alert webhook down: alert stays pending and is sent on the next tick"         @raring2go/web   lib/health-alerts.test.ts   ""

echo
echo "Provider failure drill: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '%-6s %s\n' RESULT SCENARIO
for row in "${rows[@]}"; do printf '%-6s %s\n' "${row%%|*}" "${row#*|}"; done
echo
if [ "$failures" -gt 0 ]; then echo "$failures scenario(s) did not pass."; exit 1; fi
echo "All scenarios passed."
