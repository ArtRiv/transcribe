import { test } from "@playwright/test";

/**
 * AUTH-02: Magic-link callback spec.
 *
 * Status: fixme — requires intercepting the Supabase auth API or running
 * against a local Supabase instance with a known test email. Fully documented
 * in the Phase 4 UAT runbook at:
 *   .planning/phases/04-integration-auth/04-UAT.md §3 "Magic-Link Sign-In (manual)"
 *
 * Real verification: follow the manual UAT runbook steps — send a real magic
 * link to a test email, open the link, confirm /auth/callback → / redirect.
 *
 * [Cited: 04-08 PLAN Task 3; 04-VALIDATION.md §"Manual-Only Verifications"]
 */
test.fixme("magic-link callback exchanges code → session", async ({ page }) => {
  // Requires intercepting Supabase auth API or running against a local Supabase
  // start with a known test email. Documented for manual UAT (04-UAT.md §3).
  await page.goto("/auth/callback?code=invalid");
});
