import { test } from "@playwright/test";

/**
 * AUTH-03: Session persistence spec.
 *
 * Status: fixme — requires a real signed-in session (magic-link flow) and a
 * page reload to confirm the session cookie is refreshed by the proxy middleware.
 * Documented for manual UAT at:
 *   .planning/phases/04-integration-auth/04-UAT.md §3 "Magic-Link Sign-In" item 5
 *
 * Real verification:
 *   1. Complete magic-link sign-in (UAT §3).
 *   2. Refresh the page.
 *   3. Confirm user button still shows initials chip (still signed in).
 *
 * [Cited: 04-08 PLAN Task 3; 04-VALIDATION.md §"Manual-Only Verifications"]
 */
test.fixme("session persists across page reload", async ({ page }) => {
  // Requires a live Supabase session. Follow UAT runbook §3 for manual verification.
  await page.goto("/");
  // After magic-link sign-in and reload, user button should show initials chip.
});
