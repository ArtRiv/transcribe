// Catalog shape for the hand-rolled i18n layer.
//
// Single-route app — no Next.js [lang] subpath routing (we picked this over
// next-intl/i18next per the next16_caveat in the plan: 2 locales, ~80 strings,
// zero pluralization complexity). The locale lives in a Client Context with
// localStorage persistence; flag toggle in the AppBar flips it instantly.
//
// Add new keys to BOTH messages-en.ts AND messages-pt-BR.ts in lockstep. The
// `Messages` interface is the contract; TypeScript will refuse to compile if
// either catalog falls behind.

export type Locale = "en" | "pt-BR";

export interface Messages {
  // ── Hero (landing) ─────────────────────────────────────────────────────
  hero_status_pill: string; // "Home GPU online · pyannote 3.4 · whisper.cpp v1.8"
  hero_long_audio_in: string;
  hero_editable: string;
  hero_speaker_labeled: string;
  hero_transcript_out: string;
  hero_sub: string;

  // ── Upload zone ─────────────────────────────────────────────────────────
  upload_drop_or: string; // "Drop a file here, or"
  upload_browse: string; // "browse"
  upload_extensions_suffix: string; // " — up to 5 hours"
  upload_dropzone_aria: string; // aria-label for the dropzone
  upload_replace: string; // "Replace"
  upload_replace_aria: string; // aria-label for the Replace button
  upload_estimating: string; // "estimating…" before duration loads

  // ── Options panel ──────────────────────────────────────────────────────
  options_label: string; // "Options"
  options_quality: string;
  options_quality_hint: string;
  options_preset_fast: string;
  options_preset_balanced: string;
  options_preset_best: string;
  options_preset_fast_hint: string;
  options_preset_balanced_hint: string;
  options_preset_best_hint_unlocked: string;
  options_preset_best_hint_disabled: string;
  options_preset_best_disabled_tooltip: string;
  options_language: string;
  options_language_hint: string;
  options_language_auto: string;
  options_diarization: string;
  options_diarization_hint: string;
  options_speakers: string;
  options_speakers_hint: string;
  options_speakers_auto: string;
  options_speakers_one: string; // "1 speaker"
  options_speakers_n: string; // "{n} speakers"
  options_advanced: string; // "Advanced"
  options_model_picker_label: string;
  options_model_picker_hint: string;
  options_summary_diar_on: string; // "diarization on"
  options_summary_diar_off: string;

  // ── Start button + ETA ─────────────────────────────────────────────────
  start_transcription: string;
  start_transcription_starting: string;
  start_transcription_aria: string;
  estimated_prefix: string; // "estimated "
  estimated_suffix: string; // " on home GPU"

  // ── Pipeline / ProcessingCard ──────────────────────────────────────────
  pipeline_label: string;
  pipeline_step_uploading: string;
  pipeline_step_queued: string;
  pipeline_step_transcribing: string;
  pipeline_step_diarizing: string;
  pipeline_step_done: string;
  phase_uploading_title: string;
  phase_uploading_detail: string;
  phase_queued_title: string;
  phase_queued_waiting_for_gpu: string; // base "Waiting for GPU"
  phase_queued_jobs_ahead_one: string; // "Waiting for GPU — 1 job ahead"
  phase_queued_jobs_ahead_n: string; // "Waiting for GPU — {n} jobs ahead"
  phase_transcribing_title: string;
  phase_transcribing_detail: string; // "Realtime factor — · processed {pct}%"
  phase_diarizing_title: string;
  phase_diarizing_detail: string;
  phase_merging_title: string;
  phase_merging_detail: string;
  phase_done_title: string;
  phase_done_detail: string;
  phase_failed_title: string;
  phase_cancelling_title: string;
  phase_cancelling_detail: string;
  upload_chunk_n_of_64: string; // "chunk {n}/64"
  upload_complete: string;
  processing_est_remaining: string;

  // ── Errors (Task 5) ────────────────────────────────────────────────────
  err_backend_unreachable_title: string;
  err_backend_unreachable_body: string;
  err_upload_failed_title: string;
  err_upload_failed_body: string;
  err_auth_failed_title: string;
  err_auth_failed_body: string;
  err_validation_failed_title: string;
  err_pipeline_failed_title: string; // for backend-reported failures
  err_unknown_title: string;
  err_unknown_body: string;

  // ── Cancel button ──────────────────────────────────────────────────────
  cancel_job: string;
  cancel_back_to_upload: string;
  cancel_aria: string;

  // ── Editor toolbar ─────────────────────────────────────────────────────
  editor_toggle_speakers_show: string;
  editor_toggle_speakers_hide: string;
  editor_toggle_minimap_show: string;
  editor_toggle_minimap_hide: string;
  editor_filter_segments: string; // placeholder
  editor_filter_segments_aria: string;
  editor_density_compact: string;
  editor_density_normal: string;
  editor_density_comfy: string;
  editor_density_aria: string;
  editor_export: string;
  editor_export_aria: string;
  editor_playback_rate_aria: string;
  editor_audio_lost: string;
  editor_audio_upload_again: string;

  // ── Speakers rail ──────────────────────────────────────────────────────
  editor_speakers: string; // "Speakers"
  editor_segments_count_one: string; // "1 segment"
  editor_segments_count_n: string;
  editor_add_speaker: string;
  editor_renames_global_title: string;
  editor_renames_global_body: string;

  // ── Segment actions ────────────────────────────────────────────────────
  editor_reassign_speaker_aria: string;
  editor_reassign_to_label: string;
  editor_apply_to_every_speaker: string; // "Apply to every {speakerLabel} segment"
  editor_apply_to_every_fallback: string; // "Apply to every speaker segment"
  editor_split_at_cursor: string;
  editor_merge_with_previous: string;
  editor_delete_segment: string;
  editor_toast_segment_split: string;
  editor_toast_segment_reassigned: string;
  editor_toast_merged_with_previous: string;
  editor_toast_segment_deleted: string;
  editor_toast_speaker_added_reassigned: string;

  // ── Footer (editor) ────────────────────────────────────────────────────
  editor_word_count_words: string; // " words"
  editor_word_count_segments_one: string; // "1 segment"
  editor_word_count_segments_n: string;
  editor_save_just_now: string;
  editor_save_seconds_ago: string; // "{n}s ago"
  editor_save_minutes_ago: string;
  editor_save_hours_ago: string;
  editor_save_last_saved_prefix: string; // "Last saved "
  editor_save_autosave_localstorage: string; // " · auto-save via localStorage"
  editor_save_failed: string;

  // ── Minimap / overview ─────────────────────────────────────────────────
  editor_overview: string;

  // ── History page ───────────────────────────────────────────────────────
  history_signed_out_hint: string;
  history_zero_no_transcripts: string;
  history_zero_new: string;
  history_kicker: string; // "Your transcripts"
  history_title: string; // "History"
  history_search_placeholder: string;
  history_footer: string;
  history_load_more: string;
  history_rename_failed: string;
  history_delete_failed: string;
  history_deleted_undo: string; // "Deleted \"{title}\"."

  // ── User button ────────────────────────────────────────────────────────
  user_sign_in: string;
  user_sign_out: string;
  user_history: string;

  // ── Language toggle ────────────────────────────────────────────────────
  language_toggle_aria: string;
}
