// English message catalog. The DEFAULT locale — every other catalog must
// keep parity (TypeScript enforces this via the Messages contract).
//
// Style notes:
//  • Sentence case for body copy, Title Case only for proper nouns / button
//    labels that match shadcn defaults.
//  • Keep ASCII-safe: em dashes "—" and "·" are fine (rendered everywhere we
//    care about); avoid smart quotes that the linter sometimes mangles.

import type { Messages } from "./types";

export const EN_MESSAGES: Messages = {
  // Hero — see types.ts comment for the supported markup tags.
  hero_status_pill: "Home GPU online · pyannote 3.4 · whisper.cpp v1.8",
  hero_line_1: "Long audio in.",
  hero_line_2:
    "<accent>Editable</accent>, <em>speaker-labeled</em> transcript out.",
  hero_sub:
    "Drop a meeting recording, an interview, a podcast — up to five hours. Whisper does the words, pyannote splits the speakers, you do the editing.",

  // Upload zone
  upload_drop_or: "Drop a file here, or ",
  upload_browse: "browse",
  upload_extensions_suffix: " — up to 5 hours",
  upload_dropzone_aria: "Drop audio or video file or click to browse",
  upload_replace: "Replace",
  upload_replace_aria: "Replace file",
  upload_estimating: "estimating…",

  // Options panel
  options_label: "Options",
  options_quality: "Quality",
  options_quality_hint: "Choose speed vs accuracy",
  options_preset_fast: "Fast",
  options_preset_balanced: "Balanced",
  options_preset_best: "Best",
  options_preset_fast_hint: "tiny, ~10× realtime",
  options_preset_balanced_hint: "small, ~3× realtime",
  options_preset_best_hint_unlocked: "large-v3",
  options_preset_best_hint_disabled: "~10 GB VRAM · ~1.4× realtime",
  options_preset_best_disabled_tooltip:
    "Requires ~10 GB VRAM. This host is an AMD RX 6600 (8 GB), so the slow preset is gated off. Use Balanced for full-quality results.",
  options_language: "Language",
  options_language_hint: "Auto-detect works for 90+ languages.",
  options_language_auto: "Auto-detect",
  options_diarization: "Diarization",
  options_diarization_hint:
    "Splits the transcript into who-said-what segments using pyannote.",
  options_speakers: "Estimated speakers",
  options_speakers_hint:
    "Leave on Auto unless you know exactly how many people are on the recording.",
  options_speakers_auto: "Auto",
  options_speakers_one: "1 speaker",
  options_speakers_n: "{n} speakers",
  options_advanced: "Advanced",
  options_model_picker_label: "Model",
  options_model_picker_hint:
    "Pick a specific model. Overrides the preset choice above.",
  options_summary_diar_on: "diarization on",
  options_summary_diar_off: "diarization off",

  // Start button + ETA
  start_transcription: "Start transcription →",
  start_transcription_starting: "Starting…",
  start_transcription_aria: "Start transcription",
  estimated_prefix: "estimated ",
  estimated_suffix: " on home GPU",

  // Pipeline / ProcessingCard
  pipeline_label: "Pipeline",
  pipeline_step_uploading: "Uploading",
  pipeline_step_queued: "Queued",
  pipeline_step_transcribing: "Transcribing",
  pipeline_step_diarizing: "Diarizing",
  pipeline_step_done: "Done",
  phase_uploading_title: "Uploading to home-gpu-01",
  phase_uploading_detail:
    "Resumable chunked upload via Cloudflare Quick Tunnel",
  phase_queued_title: "Queued",
  phase_queued_waiting_for_gpu: "Waiting for GPU",
  phase_queued_jobs_ahead_one: "Waiting for GPU — 1 job ahead",
  phase_queued_jobs_ahead_n: "Waiting for GPU — {n} jobs ahead",
  phase_transcribing_title: "Transcribing with whisper.cpp",
  phase_transcribing_detail: "Realtime factor — · processed {pct}%",
  phase_diarizing_title: "Diarizing with pyannote 3.4",
  phase_diarizing_detail: "Detected speakers · clustering segments",
  phase_merging_title: "Merging segments",
  phase_merging_detail: "Aligning words to speakers",
  phase_done_title: "Done — opening editor",
  phase_done_detail: "Loading transcript…",
  phase_failed_title: "Transcription failed",
  phase_cancelling_title: "Cancelling…",
  phase_cancelling_detail: "Stopping the worker; partial output discarded",
  upload_chunk_n_of_64: "chunk {n}/64",
  upload_complete: "upload complete",
  processing_est_remaining: "est. remaining",

  // Errors
  err_backend_unreachable_title: "Could not reach your home server",
  err_backend_unreachable_body:
    "I could not reach the FastAPI backend on your machine. Check that the backend is running and the Cloudflare tunnel is up.",
  err_upload_failed_title: "Upload failed",
  err_upload_failed_body:
    "The chunked upload could not finish. Check your network and try again.",
  err_auth_failed_title: "Sign-in expired",
  err_auth_failed_body:
    "Your session is no longer valid. Refresh the page and try again.",
  err_validation_failed_title: "Backend rejected the job",
  err_pipeline_failed_title: "Transcription failed",
  err_unknown_title: "Something went wrong",
  err_unknown_body: "Unexpected error — see details below.",

  // Cancel button
  cancel_job: "Cancel job",
  cancel_back_to_upload: "Back to upload",
  cancel_aria: "Cancel job",

  // Editor toolbar
  editor_toggle_speakers_show: "Show speakers",
  editor_toggle_speakers_hide: "Hide speakers",
  editor_toggle_minimap_show: "Show minimap",
  editor_toggle_minimap_hide: "Hide minimap",
  editor_filter_segments: "Filter segments…",
  editor_filter_segments_aria: "Filter segments",
  editor_density_compact: "Compact",
  editor_density_normal: "Normal",
  editor_density_comfy: "Comfy",
  editor_density_aria: "Density",
  editor_export: "Export",
  editor_export_aria: "Export transcript",
  editor_playback_rate_aria: "Playback rate",
  editor_audio_lost:
    "Audio source lost on reload — re-upload to enable scrubbing.",
  editor_audio_upload_again: "Upload again",

  // Speakers rail
  editor_speakers: "Speakers",
  editor_segments_count_one: "1 segment",
  editor_segments_count_n: "{n} segments",
  editor_add_speaker: "Add speaker",
  editor_renames_global_title: "Renames are global",
  editor_renames_global_body: "Editing a speaker name updates every segment.",

  // Segment actions
  editor_reassign_speaker_aria: "Reassign speaker",
  editor_reassign_to_label: "Reassign to",
  editor_apply_to_every_speaker: "Apply to every {label} segment",
  editor_apply_to_every_fallback: "Apply to every speaker segment",
  editor_split_at_cursor: "Split at cursor",
  editor_merge_with_previous: "Merge with previous",
  editor_delete_segment: "Delete segment",
  editor_toast_segment_split: "Segment split",
  editor_toast_segment_reassigned: "Segment reassigned",
  editor_toast_merged_with_previous: "Merged with previous",
  editor_toast_segment_deleted: "Segment deleted",
  editor_toast_segment_deleted_undo: "Segment deleted — undo?",
  editor_toast_speaker_added_reassigned: "Added new speaker and reassigned",
  editor_rename_speaker_label: "Rename {label}",
  editor_rename_speaker_aria: "New speaker name",
  editor_rename_save: "Save",
  editor_undo: "Undo",
  editor_revert_original: "Revert to original",
  editor_revert_confirm:
    "Discard every edit and reload the original transcript?",
  editor_revert_confirm_action: "Revert",
  editor_revert_cancel: "Cancel",
  editor_loading_transcript: "Loading transcript…",

  // Editor footer
  editor_word_count_words: " words",
  editor_word_count_segments_one: "1 segment",
  editor_word_count_segments_n: "{n} segments",
  editor_save_just_now: "just now",
  editor_save_seconds_ago: "{n}s ago",
  editor_save_minutes_ago: "{n}m ago",
  editor_save_hours_ago: "{n}h ago",
  editor_save_last_saved_prefix: "Last saved ",
  editor_save_autosave_localstorage: " · auto-save via localStorage",
  editor_save_failed: "⚠ Saving locally failed — your edits are not persisted",

  // Minimap / overview
  editor_overview: "Overview",

  // History page
  history_signed_out_hint:
    "Sign in via the user button (top right) to see your transcripts.",
  history_zero_no_transcripts: "No transcripts yet.",
  history_zero_new: "+ New transcript",
  history_kicker: "Your transcripts",
  history_title: "History",
  history_search_placeholder: "Search by title…",
  history_footer:
    "Stored in Supabase · synced via Realtime · click any row to open",
  history_load_more: "Load more",
  history_rename_failed: "Rename failed",
  history_delete_failed: "Delete failed",
  history_deleted_undo: 'Deleted "{title}".',

  // User button
  user_sign_in: "Sign in",
  user_sign_out: "Sign out",
  user_history: "History",

  // Language toggle
  language_toggle_aria: "Switch language / Trocar idioma",

  // Phase 8: Pairing (/pair?code=…) — UI-SPEC §"Copywriting Contract"
  // Headings (verbatim from 08-UI-SPEC.md §"Pair card headings")
  pair_heading_default: "Engine running on your computer",
  pair_heading_signed_out: "Engine running on your computer",
  pair_heading_success: "You're all set.",
  pair_heading_expired: "Pairing code expired.",
  pair_heading_network: "Can't reach the server.",
  pair_heading_offline: "Engine not detected.",
  pair_heading_generic: "Pairing failed.",
  pair_heading_conflict: "You already have an engine paired.",

  // Sub-copy (verbatim from 08-UI-SPEC.md §"Sub-copy")
  pair_body_default:
    "Pair it to your account so this site can route jobs to it.",
  pair_body_signed_out: "You'll be taken back to this page after signing in.",
  pair_body_success:
    "Your engine is paired. Drop a file on the transcribe page and it'll run on your machine.",
  pair_body_expired:
    "Restart the engine to get a new code, then come back to this page.",
  pair_body_network: "Check your internet connection.",
  pair_body_offline:
    "We don't see your engine online. Make sure the tray icon is visible.",
  pair_body_generic:
    "Something went wrong. Copy the error code below and try again.",
  pair_body_conflict: "Pairing this engine will replace the one below.",
  pair_body_not_your_engine: "Not your engine?",

  // CTAs (verbatim from 08-UI-SPEC.md §"Primary CTAs")
  pair_cta_pair: "Pair this engine",
  pair_cta_pairing: "Pairing…",
  pair_cta_replace: "Replace this engine",
  pair_cta_cancel: "Cancel",
  pair_cta_signin: "Sign in with email →",
  pair_cta_try_again: "Try again",
  pair_cta_go_to_transcribe: "Go to transcribe →",
  pair_cta_manage_devices: "Manage devices",

  // Phase 8: Devices (/account/devices) — 08-UI-SPEC.md §"`/account/devices`"
  devices_heading: "Devices",
  devices_subheading: "Engines paired to your account.",
  devices_unpair: "Unpair",
  devices_unpair_confirm: "Are you sure? Unpair",
  devices_unpair_cancel: "Cancel",
  devices_empty_heading: "No engine paired yet.",
  devices_empty_body:
    "Install and run the engine, then visit the pair link it generates.",
  devices_empty_cta: "Learn how to install →",

  // Phase 8: Engine update prompt (VERSION-02/03)
  engine_update_heading: "Engine update available",
  engine_update_body:
    "Your engine is at v{engineVersion}. The minimum supported version is v{minVersion}. Update to continue.",
  engine_update_cta: "Download latest",
};
