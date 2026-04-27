# Feature Research

**Domain:** Self-hostable audio/video transcription web app (local-GPU Whisper + diarization)
**Researched:** 2026-04-27
**Confidence:** HIGH (broad ecosystem coverage; competitor feature parity well-documented)

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels broken/amateur, even though most are individually small. The bar set by Otter, Descript, Sonix, Trint, and the open-source `Whisper-WebUI` family is consistent enough that anything below it reads as "demo, not product."

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Drag-and-drop file upload** with click-to-browse fallback | Every transcription app has this; a bare `<input type="file">` reads as 2010 | S | Already in scope. Show file name + size after drop. Reject on extension client-side, validate on server. |
| **Visible file-size & duration cap** *before* upload starts | Surprise rejection after a 1.5 GB upload is rage-inducing | S | Display the cap on the upload control itself ("up to 500 MB / 3 hours"). Validate client-side before kicking off the upload. |
| **Format normalization via ffmpeg** so any audio/video container works | Users expect to drop an `.mkv`, `.m4a`, `.mov`, `.opus` and have it just work | S | Already implied by the project's ffmpeg backend. Communicate "audio extracted" vs failing on weird containers. |
| **Quality preset (Fast/Average/Slow)** with a one-line explanation | "tiny vs large-v3" is jargon; Sonix/Otter hide model complexity behind speed labels | S | In scope. Add hint text under each radio: "Fast = 5x realtime, lower accuracy" etc. |
| **Auto-detect language with manual override** | Whisper supports 99 languages; users hit at least one wrong autodetect and need the escape hatch | S | In scope. Show detected language in the result for confidence. |
| **Diarization on/off toggle** | Single-speaker recordings don't need diarization overhead; users want to skip it | S | In scope. Default ON for the typical "meeting" use case. |
| **Speaker count: auto vs fixed N** | pyannote auto-detect over-predicts speaker count on hard audio; users need to force "exactly 2" | S | In scope. Forcing num_speakers materially improves quality on 1:1 conversations. ([pyannote issue #1009](https://github.com/pyannote/pyannote-audio/issues/1009)) |
| **Progress bar with non-fake percentage** | Fake bars that sit at 0% then jump to 90% destroy trust ([smart-interface-design-patterns.com](https://smart-interface-design-patterns.com/articles/designing-better-loading-progress-ux/)) | M | In scope. Stage labels ("Extracting audio → Transcribing → Diarizing → Aligning") cover the gap when % is unknown. |
| **Speaker-labeled transcript** with line breaks at speaker change | The whole point of diarization; running text without speaker labels feels broken | S | In scope. One line per speaker turn, speaker label as visual lead-in. |
| **Visible timestamps** (at least per speaker turn) | Lets users locate moments; required for the "go check what they said at 47:12" use case | S | In scope. Show `[hh:mm:ss]` per turn, not per word — too noisy per word. |
| **Click-to-seek**: clicking a line jumps the audio player to that timestamp | Standard in Otter, Descript, Rev, Sonix; without it, transcript + audio are disconnected ([Rev help](https://support.rev.com/hc/en-us/articles/29824992702989-Transcription-Editor)) | S | Requires an `<audio>` element wired to per-segment start times. |
| **Inline text editing** | Mishears are guaranteed; if users can't fix them, the transcript isn't usable as-is | M | In scope. `contenteditable` per segment, debounce-save to local state. |
| **Speaker rename, applied globally** | "Speaker 3 → Maria" is the single most-requested edit on diarized output | S | In scope. Maintain a speaker-id → label map; render through the map. |
| **Reassign segment to a different speaker** with "apply to all by this same speaker-id" | Diarization frequently splits one person across two IDs; without merge, transcript is unfixable | M | In scope. UI: dropdown on segment + checkbox "merge SPK_2 into SPK_1 everywhere." |
| **Download as .txt, .srt, .vtt, .json** | These four cover reading, subtitling, and re-import; missing one = "what, no SRT?" | S | In scope. JSON should round-trip (re-import preserves edits). |
| **Copy-to-clipboard** of the full transcript (with toggle: with/without timestamps, with/without speakers) | Users want to paste into Notion/email without re-formatting; hugely common ask | S | One button, two checkboxes. Cheap, very high perceived polish. |
| **Per-IP rate limit + file-size cap + single-job queue** | Public URL on a home GPU; without these the app is one bad actor away from being down | M | In scope. Communicated as "one transcription at a time — yours starts in ~2 min." |
| **Anonymous transcribes work without sign-in** | Sign-up walls on a free portfolio piece kill drive-by trials | S | In scope. Sign-in is purely an unlock for history. |
| **Visible "your data lives in this browser tab"** for anonymous users | Users assume their audio is being kept; a privacy posture statement is now table stakes post-2024 | S | One sentence under the upload box: "Anonymous uploads aren't saved. Your transcript only exists in this browser until you download it." |
| **Audio playback controls** (play/pause, scrub, speed: 1x/1.25x/1.5x/2x) | Users review at 1.5x; missing speed control is a Day 1 complaint | S | Native `<audio>` + `playbackRate` setter. Trivial. |

### Differentiators (Competitive Advantage)

Features that elevate the product above "yet another Whisper wrapper." Several of these are cheap to build but signal craft — strongly recommended for a portfolio piece.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Read-along highlight** of the currently-playing word/segment | Otter and Descript both ship this; transforms the transcript from text-blob to interactive document. Dramatic perceived-quality jump for ~1 day of work | M | Hook into `audio.timeupdate`. Mutate DOM directly (not React state) at 4–66Hz to avoid re-render storms ([metaview blog](https://www.metaview.ai/resources/blog/syncing-a-transcript-with-audio-in-react)). Highlight at *segment* granularity first; word-level can come later. |
| **Find-in-transcript (Cmd-F-style)** with jump-to-result | Indispensable on 90-min meeting transcripts; trivial with the data already in memory | S | Local-only search over rendered text. With timestamps, results can also seek the audio. **Portfolio-quality cheap win.** |
| **Find-and-replace** in the transcript (e.g., "Maria" → "María") | One-click fixup of recurring mishears; massive time-saver vs editing each instance | S | Same input as find; add replace-one / replace-all. **Cheap; high signal.** |
| **Confidence-shaded text** — words with low Whisper confidence rendered in a muted color or with a subtle underline | Auphonic and others do this; it directs the editor's attention. Whisper-timestamped exposes per-word confidence by default | M | Use `whisper-timestamped` or WhisperX word-confidence. Map score → opacity / color. **Unique signal of craft for a portfolio piece.** ([whisper-timestamped](https://github.com/linto-ai/whisper-timestamped), [Auphonic docs](https://auphonic.com/help/algorithms/speech_recognition.html)) |
| **"Needs review" auto-flag** — segments with average confidence below a threshold get a small badge | Turns the transcript into a checklist: jump to flagged segments, fix, dismiss flag | M | Builds on confidence shading. One pass at transcript-load time. |
| **Color-coded speakers** (consistent palette per speaker-id, accessible contrast) | Visual scanning of "who said what" is dramatically faster with color than name-only labels | S | Hash speaker-id → palette index. Use the Shadcn/Tailwind palette so contrast is guaranteed. **Cheap; high polish.** |
| **Auto-save edits to localStorage** | Browser tab crash / accidental close should not lose 20 minutes of editing | S | `setItem` on a debounced timer. On load, prompt "restore your unsaved edits to this transcript?" |
| **Undo/redo** for transcript edits | Standard contenteditable browser undo is unreliable across renames + segment reassigns; a real undo stack covers it | M | Track an action log (text edit, speaker rename, segment reassign) with inverse operations. |
| **Read mode vs Edit mode toggle** | On a long transcript, reading is the dominant activity; an edit-everywhere UI makes reading feel fragile | S | Edit mode shows segment chrome (handles, dropdowns); read mode hides it. Pure CSS toggle. **Cheap; signals product thinking.** |
| **Keyboard shortcuts for the editor** (space = play/pause without losing focus, Tab = next segment, Cmd-K = command palette) | Power users live in keyboard; presence of shortcuts signals the product was designed by someone who uses it | M | Document them in a `?` overlay. **Portfolio-grade signal of craft.** |
| **History view** with rename, delete, search | In scope as "history list," but adding rename + search elevates it to actually useful | S | Already gated behind sign-in. |
| **Re-open transcript and continue editing** from history | The point of having history; without it, history is just a log | M | Persisted JSON transcript in Supabase storage; load → editor. |
| **Self-host docs** — a clean README with screenshots, "run this on your own GPU" instructions, an `.env.example`, and `docker-compose.yml` | The product *is* the deployment story for a portfolio piece; reviewers will judge the README more than the UI | M | Sample audio file for testing. One-command bootstrap. |
| **In-browser microphone recording** as an alternate input ("record a quick note") | Lowers friction for short use cases; one extra entry point | M | `MediaRecorder` API → WebM blob → same upload pipeline. Be aware: iOS Safari has historical quirks with the API ([buildwithmatija.com](https://www.buildwithmatija.com/blog/iphone-safari-mediarecorder-audio-recording-transcription)). |
| **Markdown export** (speakers as bold, timestamps as inline `[hh:mm:ss]`) | `.md` is the fastest way for the friend to drop a transcript into Notion/Obsidian; one extra format, almost free | S | Same renderer as `.txt` with a different formatter. **Cheap; high utility for the actual user.** |
| **"Share read-only link"** for anonymous transcripts via opaque URL token (only generated on explicit user click) | Without sign-in, this is the lightweight collaboration story; opt-in keeps the privacy posture | M | Defer to v1.x — adds storage retention semantics that conflict with "anonymous = ephemeral." Worth flagging. |

### Anti-Features (Commonly Requested, Often Problematic)

Features that other transcription products ship and that users sometimes ask for, but that we should deliberately *not* build. Reasoning included so future scope creep can be deflected.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Paste a YouTube URL → transcribe** | Otter and many open-source Whisper UIs offer this; it feels obvious | Legal exposure on a public URL (transcribing copyrighted videos is a contested fair-use call ([insight7](https://insight7.io/youtube-transcription-and-copyright-what-you-need-to-know/))); requires `yt-dlp` which YouTube actively breaks; most users *can* upload the file themselves | Document "use yt-dlp locally, then upload" in the README. Keeps the app neutral. |
| **Real-time / streaming transcription** (live mic → text as you speak) | Otter's flagship demo; impressive | Out of scope per PROJECT.md. Adds WebSocket plumbing, low-latency model variant, completely different UX surface, and the friend's actual use case is uploaded recordings | Reaffirmed out of scope. Browser-recorded clips are a *paste-and-transcribe* flow, not streaming. |
| **Translation to English (or other languages)** | Whisper has a `task=translate` mode; it's a one-line model arg | Out of scope per PROJECT.md. Translation quality varies wildly; doubles the surface area of "is this output trustworthy?"; users who need translation reach for DeepL anyway | Out of scope. Mention in README that the underlying model can do it; users can fork. |
| **AI summary / chapters / action items** | Otter's "AI Notes," Sonix's chapters; very on-trend in 2025–2026 | Adds a paid LLM dependency (OpenAI / Anthropic) → violates the $0/month constraint; or adds a heavyweight local LLM → doubles GPU memory pressure. Quality bar for summaries is brutal — bad summaries destroy trust in the whole product | Document "pipe the .txt into your LLM of choice." Keep the tool focused. |
| **Multi-user collaboration** (shared transcripts, comments, suggestions) | Trint and Sonix lean on this for teams | Out of scope per PROJECT.md. Adds RLS complexity, presence, conflict resolution, and a sharing model that fights with the anonymous-by-default posture | Out of scope. Read-only share-link (above) is the only collaboration concession, and it's deferred. |
| **Speaker fingerprinting across files** ("this is Maria again") | Otter pitches this for recurring meetings | Out of scope per PROJECT.md. Requires a per-user enrollment store, raises real privacy questions on a portfolio site, and pyannote's per-file diarization doesn't ship a stable embedding for cross-file ID without tuning | Out of scope. Re-rename per file. |
| **Comments / highlights / annotations** on the transcript | Otter, Descript, Sonix all have this | Adds persistence semantics for anonymous users (where do comments live?), competes with simple Markdown export workflow, and isn't part of the friend's "make it readable" need | Defer indefinitely. Markdown export covers note-taking. |
| **Timeline / waveform editor** (Descript-style: edit the audio by editing the text) | Descript's killer feature | Massively complex; requires word-level audio splicing, format-specific re-encoding, undo/redo with media operations. Distinct product category | Out of scope. Output formats include word-level timestamps (.json) so users can do this in Descript if they want. |
| **Login wall before transcribing** | "Captures users for marketing" | Kills drive-by portfolio reviewers and contradicts the "anonymous transcribes work" requirement | Anonymous-first stays. Sign-in only adds value (history). |
| **Password-based auth** | Familiar | More attack surface (resets, breaches, hashing), more UI (forgot-password flows), and Supabase magic links cover the same ground with less code | Magic-link only via Supabase OTP. ([Supabase magic link docs](https://supabase.com/docs/guides/auth/passwordless-login/auth-magic-link)) |
| **Word-level click-to-seek** (every word is a seek target) | "More precise!" | At 90 minutes of audio, that's tens of thousands of click targets; performance hit (event handlers, layout) and the UX gain over segment-level click-to-seek is small | Segment-level click-to-seek is plenty. Word-level highlight (read-along) without click is fine. |
| **Cancel job → also delete partial transcript from server** | "Privacy!" | We're not persisting anonymous server-side anyway; cancel = forget local state. Building cleanup paths for an in-progress job adds a state machine | Cancel just stops the worker and returns the user to the upload screen. Anonymous state was never persisted. |
| **OpenAI Whisper API as paid fallback** when local GPU is offline | "Better availability" | Out of scope per PROJECT.md (recurring cost). Also: when the host PC is off, the *frontend* on Vercel can still tell the user "host is offline, try later" — that's a known and accepted constraint | Out of scope. Status indicator: "host PC is offline." |
| **DOCX / PDF export** | Sonix and Trint offer these; common ask | DOCX requires `python-docx` or similar (medium complexity, formatting quirks), PDF requires headless Chrome or wkhtmltopdf (heavyweight, often broken in containers). Markdown + .txt cover the same downstream use cases via Pandoc | Defer indefinitely. Markdown export is the bridge. |

## Feature Dependencies

```
Upload + ffmpeg normalize
    └──required by──> Transcription job
                         └──required by──> Speaker-labeled transcript
                                              ├──required by──> Speaker rename (global)
                                              ├──required by──> Segment reassign + merge
                                              ├──required by──> Inline text edit
                                              └──required by──> All export formats

Word-level timestamps (WhisperX output)
    └──required by──> Click-to-seek
                         └──enhances──> Read-along highlight
    └──required by──> .vtt / .srt with accurate cues
    └──required by──> Find-in-transcript with jump-to-audio

Per-word confidence (whisper-timestamped or WhisperX)
    └──required by──> Confidence-shaded text
                         └──required by──> "Needs review" badges

Inline edit
    └──required by──> Find-and-replace
                         └──enhances──> Speaker rename (global) [same UX surface]
    └──enhances──by──> Auto-save (localStorage)
                         └──enhances──by──> Undo/redo

Audio player + segment timestamps
    └──required by──> Click-to-seek
                         └──required by──> Read-along highlight
                                              └──enhances──> Read mode vs edit mode

Supabase auth (magic link)
    └──required by──> History view
                         └──required by──> Re-open transcript
                                              └──required by──> Persistent transcript in Supabase storage

Single-job queue + rate limit
    └──required by──> Public URL safety
                         └──enhances──> Honest progress UX ("you're #2 in queue")
```

### Dependency Notes

- **All edit operations require a structured transcript object** (segments with start/end/speaker/text), not raw text. This is the central data model — it must be defined early.
- **Click-to-seek requires the `<audio>` element to be loaded with the *original* uploaded audio**, not a re-encoded version. This affects backend storage of the upload during the editing session.
- **Read-along highlight depends on click-to-seek's data plumbing** but adds a per-frame DOM-mutation hot path. Build click-to-seek first, ship it, then add read-along.
- **Confidence shading depends on the chosen ASR backend** exposing per-word confidence. WhisperX does (alignment scores), `whisper-timestamped` does (explicit confidence), vanilla `openai-whisper` does *not* in a clean way. This is a stack-research question — flag for STACK.md.
- **History conflicts with the privacy posture** unless anonymous transcripts stay client-only. Resolution: signed-in users opt-in to persistence; anonymous never touches Supabase storage.
- **Find-and-replace conflicts with confidence shading** if replace clears confidence. Resolution: edited words are marked "user-edited" and shown without confidence color.
- **Cancel during a job conflicts with the single-job queue** if cancel doesn't actually free the GPU. Resolution: cancel must terminate the worker process / kill the model invocation, not just hide the UI.

## MVP Definition

### Launch With (v1)

The minimum that delivers the core value ("turn 90 minutes of audio into a readable transcript I can fix and download") and does not feel broken to a portfolio reviewer.

- [ ] **Drag-and-drop + click-to-browse upload** with size cap visible — without this, the entry point feels amateur
- [ ] **Quality preset (Fast/Average/Slow)** with model-size mapping — already in scope
- [ ] **Diarization toggle + auto/fixed speaker count** — already in scope; the friend's primary use case is multi-speaker meetings
- [ ] **Language auto-detect with override** — already in scope
- [ ] **Honest progress UX** with stage labels (Queued → Extracting → Transcribing → Diarizing → Aligning) — fake bars destroy trust
- [ ] **Speaker-labeled transcript with timestamps and color-coded speakers** — color is cheap, dramatic polish lift
- [ ] **Click-to-seek + audio player with playback speed** — the core "review" loop
- [ ] **Speaker rename (global)** — top diarization-fix request
- [ ] **Segment reassign with merge-everywhere** — already in scope; required when pyannote splits one person
- [ ] **Inline text edit** — already in scope
- [ ] **Find-in-transcript** — cheap (S), huge utility on 90-min files, signals craft
- [ ] **Copy-to-clipboard with timestamp/speaker toggle** — single highest "ratio of polish per LOC" feature
- [ ] **Download as .txt, .srt, .vtt, .json** — already in scope
- [ ] **Markdown download** — one extra format, almost free, directly serves the "drop into Notion" path the friend will use
- [ ] **Per-IP rate limit, file-size cap, single-job queue** — already in scope; non-negotiable for a public URL
- [ ] **Anonymous transcribes (no sign-in)** — already in scope
- [ ] **Optional Supabase magic-link sign-in** — already in scope
- [ ] **History view (list, rename, delete, re-open)** for signed-in users — already in scope; without re-open, history is dead weight
- [ ] **Auto-save edits to localStorage** — one prompt-on-load is the difference between "lost an hour" and "fine"
- [ ] **Privacy posture statement** under the upload control — one sentence, sets expectations

### Add After Validation (v1.x)

Trigger: v1 ships, the friend uses it on real recordings, the dev posts the repo for portfolio review.

- [ ] **Read-along highlight** (current segment highlighted as audio plays) — trigger: v1 click-to-seek works, performance budget understood
- [ ] **Find-and-replace** — trigger: friend reports recurring mishears
- [ ] **Confidence shading + "needs review" badges** — trigger: confirm the chosen backend (WhisperX vs whisper-timestamped) exposes word confidence cleanly
- [ ] **Read mode vs Edit mode toggle** — trigger: feedback that long transcripts feel cluttered
- [ ] **Keyboard shortcuts** with `?` help overlay — trigger: stable editor UX, ready to layer power-user affordances
- [ ] **Undo/redo stack** — trigger: edit complexity grows past simple text fixes
- [ ] **In-browser microphone recording** — trigger: a use case actually appears (low priority for the stated scope)

### Future Consideration (v2+)

- [ ] **Read-only share link for anonymous transcripts** — defer: forces a retention policy decision that conflicts with "anonymous = ephemeral"
- [ ] **Word-level click-to-seek** — defer: marginal UX gain, real performance work; segment-level is sufficient
- [ ] **DOCX / PDF export** — defer: Markdown via Pandoc covers it; both export targets have nasty edge cases for $0 of value over Markdown

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Drag-and-drop upload | HIGH | LOW | P1 |
| Quality preset | HIGH | LOW | P1 |
| Diarization toggle + speaker count | HIGH | LOW | P1 |
| Language auto-detect + override | MEDIUM | LOW | P1 |
| Honest progress UX (stage labels) | HIGH | MEDIUM | P1 |
| Speaker-labeled transcript w/ timestamps | HIGH | LOW | P1 |
| Color-coded speakers | MEDIUM | LOW | P1 |
| Click-to-seek + audio player | HIGH | LOW | P1 |
| Playback speed (1x–2x) | MEDIUM | LOW | P1 |
| Speaker rename (global) | HIGH | LOW | P1 |
| Segment reassign + merge | HIGH | MEDIUM | P1 |
| Inline text edit | HIGH | MEDIUM | P1 |
| Find-in-transcript | HIGH | LOW | P1 |
| Copy-to-clipboard w/ toggles | HIGH | LOW | P1 |
| .txt / .srt / .vtt / .json export | HIGH | LOW | P1 |
| Markdown export | MEDIUM | LOW | P1 |
| Rate limit + size cap + queue | HIGH | MEDIUM | P1 |
| Anonymous transcribes | HIGH | LOW | P1 |
| Magic-link sign-in | MEDIUM | LOW | P1 |
| History view (list/rename/delete/re-open) | MEDIUM | MEDIUM | P1 |
| Auto-save to localStorage | HIGH | LOW | P1 |
| Privacy posture statement | MEDIUM | LOW | P1 |
| Read-along highlight | MEDIUM | MEDIUM | P2 |
| Find-and-replace | MEDIUM | LOW | P2 |
| Confidence-shaded text | MEDIUM | MEDIUM | P2 |
| "Needs review" badges | MEDIUM | MEDIUM | P2 |
| Read/Edit mode toggle | MEDIUM | LOW | P2 |
| Keyboard shortcuts | MEDIUM | MEDIUM | P2 |
| Undo/redo | MEDIUM | MEDIUM | P2 |
| In-browser mic recording | LOW | MEDIUM | P3 |
| Read-only share link | LOW | MEDIUM | P3 |
| Word-level click-to-seek | LOW | MEDIUM | P3 |
| DOCX / PDF export | LOW | HIGH | P3 |
| YouTube URL input | LOW | MEDIUM | **Anti** |
| Real-time / streaming | LOW | HIGH | **Anti** |
| Translation | LOW | LOW | **Anti** |
| AI summary / chapters | MEDIUM | HIGH | **Anti** |
| Multi-user collab / comments | LOW | HIGH | **Anti** |
| Speaker fingerprinting across files | LOW | HIGH | **Anti** |
| Password-based auth | LOW | LOW | **Anti** |
| OpenAI API fallback | LOW | LOW | **Anti** |

**Priority key:**
- **P1**: MVP — must ship in v1
- **P2**: Add after v1 validation; mostly differentiators that elevate polish
- **P3**: Future consideration; defer past first portfolio post
- **Anti**: Explicitly excluded; reasoning above so it doesn't sneak back in

## Competitor Feature Analysis

| Feature | Otter.ai | Descript | Sonix / Trint | Whisper-WebUI (OSS) | Our Approach |
|---------|----------|----------|---------------|---------------------|--------------|
| Upload UX | Drag-drop, mobile capture, meeting-bot integration | Drag-drop, file replace, transcript replace | Drag-drop, bulk upload, cloud import | Drag-drop, YouTube URL, mic | Drag-drop + click-to-browse only; no URLs (legal/scope) |
| Model selection | Hidden (one model) | Hidden (one model) | Hidden (one model) | Exposed: faster-whisper / WhisperX / model size | Quality preset (Fast/Avg/Slow) — preset over picker |
| Diarization | Auto, named via "voice prints" across meetings | Auto, manual fix | Auto, manual fix | Optional toggle, pyannote | Toggle + auto/fixed N + post-hoc reassign with merge |
| Click-to-seek | Yes, with read-along highlight | Yes, word-level | Yes, with read-along | Varies by fork | Yes, segment-level click-to-seek + read-along (P2) |
| Inline edit | Yes | Yes — *edits the audio too* | Yes | Limited / read-only | Yes (text only — not audio) |
| Find / replace | Yes | Yes (filler-word search built-in) | Yes | No | Find P1; replace P2 |
| Confidence highlighting | Subtle | Yes ("correction wizard") | Yes (red shading) | No | Yes — confidence shading P2 |
| Export formats | TXT, DOCX, PDF, SRT | TXT, SRT, VTT, JSON, DOCX, video | TXT, DOCX, PDF, SRT, VTT, FCPXML | TXT, SRT, VTT | TXT, SRT, VTT, JSON, MD — no DOCX/PDF (Pandoc) |
| Copy to clipboard with toggles | Limited | Yes | Yes | No | Yes — explicit timestamp/speaker toggles |
| History | Yes (paid) | Yes | Yes | No (per-session) | Yes (signed-in only) |
| Anonymous use | No (sign-up required) | Limited | No | Yes (self-hosted) | Yes — first-class |
| Privacy posture | Cloud, retained | Cloud, retained | Cloud, retained | Local-only | Local-GPU, anonymous = ephemeral, signed-in = opt-in persistence |
| Real-time | Yes | No | Limited | No | No (anti-feature) |
| Translation | Yes | Limited | Yes | Yes | No (anti-feature) |
| AI summary | Yes (paid) | Yes (paid) | Yes (paid) | No | No (anti-feature) |
| Cost to user | Freemium, real cap on free tier | Freemium, watermark/cap on free | Paid only (trial) | Free (self-host) | Free (self-host) |

**Where we win:** privacy posture (local GPU, ephemeral anonymous), $0 cost, the unusual combination of "polished editor" + "open-source self-host." Otter has the editor polish but not the privacy story. Whisper-WebUI has the self-host story but a bare-bones editor.

**Where we deliberately lose:** YouTube URLs (legal), real-time (scope), translation (scope), AI summary (cost), team features (scope). These are all conscious anti-features, and the README should briefly say *why* — that's part of the portfolio signal.

## Portfolio-Quality Differentiators (Cheap to Build, High Signal)

Highlighted explicitly because the user asked. These are the features where complexity is small but the perceived-quality lift is outsized — exactly what reviewers notice on a portfolio piece.

1. **Color-coded speakers** (S) — a 30-line change that transforms the visual feel.
2. **Find-in-transcript** (S) — instantly turns a long transcript from "wall of text" to "searchable artifact."
3. **Copy-to-clipboard with toggles** (S) — one button, two checkboxes, ten-fold daily utility for the actual user.
4. **Markdown export** (S) — one extra formatter; the format the friend will actually paste into their notes app.
5. **Honest staged progress** (M) — most demo apps fake this. Doing it right is a clear signal of someone who has read [the NN/G long-wait piece](https://www.nngroup.com/articles/designing-for-waits-and-interruptions/).
6. **Auto-save to localStorage with restore-on-load prompt** (S) — one of those features users only notice when it's missing.
7. **Read mode vs edit mode** (S) — pure CSS toggle, signals product thinking.
8. **Privacy posture statement under the upload control** (S) — one sentence, sets expectations, distinguishes from cloud SaaS in the first 3 seconds.
9. **A real README** with screenshots, a 30-second demo gif, an `.env.example`, and a one-command bootstrap (M) — this is the artifact the reviewer actually reads first.

The pattern across all of these: small implementation, visible immediately, and demonstrates the dev thought about the user, not just the model.

## Sources

### Competitor products
- [Otter.ai — Convert audio to text](https://otter.ai/audio-to-text)
- [Otter.ai — Transcription](https://otter.ai/transcription)
- [Descript — Edit like a doc](https://help.descript.com/hc/en-us/articles/15726742913933-Edit-like-a-doc)
- [Descript — Transcript Correction Wizard](https://www.descript.com/blog/article/transcript-correction-wizard)
- [Sonix — Export formats](https://help.sonix.ai/en/articles/1978923-how-do-i-export-a-transcript)
- [Trint — Export formats](https://info.trint.com/knowledge/export-formats-trint-help-center)
- [Rev — Transcription Editor](https://support.rev.com/hc/en-us/articles/29824992702989-Transcription-Editor)
- [Whisper-WebUI (jhj0517)](https://github.com/jhj0517/Whisper-WebUI)
- [WhisperX-WebUI (chboishabba)](https://github.com/chboishabba/WhisperX-WebUI)

### Diarization & confidence
- [pyannote/speaker-diarization-3.1](https://huggingface.co/pyannote/speaker-diarization-3.1)
- [pyannote — limiting number of speakers (issue #1009)](https://github.com/pyannote/pyannote-audio/issues/1009)
- [pyannote — preset speaker count regression (issue #1405)](https://github.com/pyannote/pyannote-audio/issues/1405)
- [WhisperX (m-bain)](https://github.com/m-bain/whisperx)
- [whisper-timestamped (linto-ai)](https://github.com/linto-ai/whisper-timestamped)
- [Auphonic — automatic speech recognition (confidence shading)](https://auphonic.com/help/algorithms/speech_recognition.html)

### UX patterns
- [Smart Interface Design Patterns — Designing better loading & progress UX](https://smart-interface-design-patterns.com/articles/designing-better-loading-progress-ux/)
- [LogRocket — UI patterns for async workflows](https://blog.logrocket.com/ux-design/ui-patterns-for-async-workflows-background-jobs-and-data-pipelines/)
- [NN/G — Designing for long waits and interruptions](https://www.nngroup.com/articles/designing-for-waits-and-interruptions/)
- [Metaview — Syncing a transcript with audio in React](https://www.metaview.ai/resources/blog/syncing-a-transcript-with-audio-in-react)
- [LogRocket — Virtual scrolling in React](https://blog.logrocket.com/virtual-scrolling-core-principles-and-basic-implementation-in-react/)

### Auth
- [Supabase — Login with Magic Link](https://supabase.com/docs/guides/auth/passwordless-login/auth-magic-link)
- [Supabase — Passwordless email logins](https://supabase.com/docs/guides/auth/auth-email-passwordless)

### Browser audio
- [MDN — Using the MediaStream Recording API](https://developer.mozilla.org/en-US/docs/Web/API/MediaStream_Recording_API/Using_the_MediaStream_Recording_API)
- [Build with Matija — MediaRecorder + iPhone Safari](https://www.buildwithmatija.com/blog/iphone-safari-mediarecorder-audio-recording-transcription)

### Legal
- [Insight7 — YouTube transcription and copyright](https://insight7.io/youtube-transcription-and-copyright-what-you-need-to-know/)

---
*Feature research for: self-hostable Whisper + diarization transcription web app*
*Researched: 2026-04-27*
