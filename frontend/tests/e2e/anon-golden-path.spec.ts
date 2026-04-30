import { test, expect } from "@playwright/test";
import path from "node:path";

/**
 * TEST-05 — Anonymous golden path.
 * Runs against MOCK_ENGINE=1 + NEXT_PUBLIC_USE_MOCKS=1 (mock realtime).
 * The mock backend completes the job in ~5s with a deterministic payload.
 *
 * Coverage: load → upload → progress → editor → export download.
 * [Cited: 04-VALIDATION.md; 04-RESEARCH.md §Validation Architecture; 04-08 PLAN Task 3]
 */
test("anon golden path: upload → transcribe → edit → download", async ({ page }) => {
  await page.goto("/");

  // 1. Upload zone present (Phase 3 CORE-01).
  const upload = page.getByRole("button", { name: /upload|drop your file|drag/i }).first();
  await expect(upload).toBeVisible({ timeout: 5_000 });

  // 2. Set the fixture file via the hidden file input (Phase 3 a11y pattern).
  const fixture = path.resolve(
    "/home/arthur/Code/transcribe/.claude/worktrees/agent-a54e475d79686b96a/frontend",
    "tests/e2e/fixtures/short.wav",
  );
  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.setInputFiles(fixture);

  // 3. Click "Start transcription" (or whatever the Phase 3 CTA label is).
  const start = page.getByRole("button", { name: /start|transcribe|go/i }).first();
  await start.click();

  // 4. Progress UI mounts.
  await expect(page.getByText(/queued|extracting|transcribing/i).first()).toBeVisible({
    timeout: 10_000,
  });

  // 5. Wait for the editor to mount (mock pipeline finishes in ~5s).
  await expect(page).toHaveURL(/\/job\/[a-f0-9-]+/, { timeout: 30_000 });
  await expect(
    page.getByRole("region", { name: /transcript|editor/i }).first(),
  ).toBeVisible();

  // 6. Open export modal and trigger a .txt download.
  const exportBtn = page.getByRole("button", { name: /export|download/i }).first();
  await exportBtn.click();
  const txtTab = page.getByRole("tab", { name: /\.txt|plain text/i }).first();
  await txtTab.click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /download|save/i }).first().click(),
  ]);
  expect(await download.suggestedFilename()).toMatch(/\.txt$/);
});
