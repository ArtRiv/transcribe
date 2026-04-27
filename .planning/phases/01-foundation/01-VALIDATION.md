---
phase: 1
slug: foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-27
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | bash probes + `psql -f` SQL probes (no unit-test framework yet — Phase 2 introduces pytest, Phase 3 introduces vitest/playwright) |
| **Config file** | `backend/scripts/verify_phase1.sh` (created by planner) |
| **Quick run command** | `bash backend/scripts/verify_phase1.sh --quick` |
| **Full suite command** | `bash backend/scripts/verify_phase1.sh` |
| **Estimated runtime** | ~10 seconds (probes only — no model loading, no audio processing) |

---

## Sampling Rate

- **After every task commit:** Run `bash backend/scripts/verify_phase1.sh --quick`
- **After every plan wave:** Run `bash backend/scripts/verify_phase1.sh`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

> Filled in by the planner during step 8. Each task in each PLAN.md gets a row.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| _(populated by planner)_ | | | | | | | | | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Wave 0 establishes the verification harness used by all later waves:

- [ ] `backend/scripts/verify_phase1.sh` — runs all phase-1 probes; exits 0 on success, non-zero on any failure
- [ ] Probe: `git ls-files | grep -qE '\.env(?!\.example)' && exit 1` — fails if any non-`.env.example` env file is tracked
- [ ] Probe: `pre-commit run gitleaks --all-files` (dry-run) — must pass on the working tree
- [ ] Probe: SQL — `SELECT count(*) FROM pg_tables WHERE schemaname='public' AND rowsecurity=false` must return 0
- [ ] Probe: SQL — `SELECT count(*) FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename IN ('jobs','transcripts')` must return 2
- [ ] Probe: file — `~/.transcribe/tunnel-url` exists and matches `^https://[a-z0-9-]+\.trycloudflare\.com$`
- [ ] Probe: HTTP — `curl -fsS "$(cat ~/.transcribe/tunnel-url)/healthz"` returns 200 (after backend `/healthz` ships in Phase 2; for Phase 1, accepted-fail because no backend yet — script tolerates this with `--phase=1`)
- [ ] Probe: Vercel — `vercel ls --json transcribe | jq '.deployments[0].state'` returns `"READY"`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| HuggingFace license accepted on `pyannote/segmentation-3.0` and `pyannote/speaker-diarization-3.1` | OPS-03 / Phase 2 prerequisite | License acceptance is gated by HF's web UI; no headless API | User logs into HF, visits both model pages, clicks "Accept terms"; planner adds a `huggingface-cli scan-cache` or simple `curl -H "Authorization: Bearer $HF_TOKEN" .../model/info` probe to verify token works |
| Vulkan backend works on AMD RX 6600 | REPO-05 (sets stage for Phase 2) | Requires hardware probe via `vulkaninfo --summary` | Run `vulkaninfo --summary | grep -i "AMD Radeon"` — must show the RX 6600 |
| Vercel auto-deploy actually triggered on first `main` push | OPS-01 | Requires GitHub→Vercel webhook delivery + dashboard inspection | Push initial commit to GitHub `main`; visit Vercel dashboard, confirm deployment appears within ~30s |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
