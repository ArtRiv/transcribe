import { test } from "@playwright/test";

/**
 * AUTH-08: Re-open saved transcript spec.
 *
 * Status: fixme — requires a signed-in user with at least one saved transcript
 * in their history. Documented for manual UAT at:
 *   .planning/phases/04-integration-auth/04-UAT.md §5 "History Operations"
 *
 * Real verification:
 *   1. Complete the anon promotion flow (UAT §4).
 *   2. Navigate to /history.
 *   3. Click the transcript card → editor opens with the saved payload.
 *   4. Edit a segment → blur → navigate away → return → edits preserved.
 *
 * [Cited: 04-08 PLAN Task 3; 04-VALIDATION.md §"Manual-Only Verifications"]
 */
test.fixme("re-open saved transcript from history shows editable editor", async ({ page }) => {
  // Requires a live Supabase session + at least one promoted transcript.
  // Follow UAT runbook §4 (promotion) then §5 (history operations) for manual steps.
  await page.goto("/history");
});
