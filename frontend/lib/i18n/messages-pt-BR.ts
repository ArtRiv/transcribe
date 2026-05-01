// Portuguese (Brazil) message catalog. Translations review notes:
//
// • "Backend" stays untranslated — it's a domain term in the developer's
//   head; "servidor" alone is ambiguous (could mean the cloud host vs the
//   user's home PC). The error copy uses "seu computador" to make it crystal
//   clear which machine is offline.
// • "GPU", "VRAM", "Vulkan", "pyannote", "whisper.cpp" are product/tech
//   names — not translated.
// • Casual/direct register matching the English ("you do the editing" →
//   "você faz a edição"), since the audience is the developer's friend
//   reading meeting recordings, not enterprise users.

import type { Messages } from "./types";

export const PT_BR_MESSAGES: Messages = {
  // Hero — see types.ts comment for the supported markup tags. The line
  // composition is locale-driven: rearrange the words however reads naturally
  // for your language. <accent>…</accent> is the warm-amber italic; <em>…</em>
  // is plain italic. Anything outside tags renders as regular text.
  hero_status_pill: "GPU local online · pyannote 3.4 · whisper.cpp v1.8",
  hero_line_1: "Áudio longo entra.",
  hero_line_2:
    "Transcrição <accent>editável</accent> <em>com falantes identificados</em> sai.",
  hero_sub:
    "Solte uma gravação de reunião, uma entrevista, um podcast — até cinco horas. O Whisper escreve as palavras, o pyannote separa os falantes, você faz a edição.",

  // Upload zone
  upload_drop_or: "Solte um arquivo aqui, ou ",
  upload_browse: "procure",
  upload_extensions_suffix: " — até 5 horas",
  upload_dropzone_aria:
    "Solte um arquivo de áudio ou vídeo, ou clique para procurar",
  upload_replace: "Trocar",
  upload_replace_aria: "Trocar arquivo",
  upload_estimating: "estimando…",

  // Options panel
  options_label: "Opções",
  options_quality: "Qualidade",
  options_quality_hint: "Velocidade ou precisão",
  options_preset_fast: "Rápido",
  options_preset_balanced: "Equilibrado",
  options_preset_best: "Melhor",
  options_preset_fast_hint: "tiny, ~10× tempo real",
  options_preset_balanced_hint: "small, ~3× tempo real",
  options_preset_best_hint_unlocked: "large-v3",
  options_preset_best_hint_disabled: "~10 GB VRAM · ~1.4× tempo real",
  options_preset_best_disabled_tooltip:
    "Precisa de ~10 GB de VRAM. Esta máquina é uma AMD RX 6600 (8 GB), então o preset Melhor está desativado. Use Equilibrado para resultados de qualidade total.",
  options_language: "Idioma",
  options_language_hint: "Detecção automática funciona para 90+ idiomas.",
  options_language_auto: "Detecção automática",
  options_diarization: "Diarização",
  options_diarization_hint:
    "Divide a transcrição em segmentos de quem-falou-o-quê usando pyannote.",
  options_speakers: "Falantes estimados",
  options_speakers_hint:
    "Deixe em Auto a menos que saiba exatamente quantas pessoas estão na gravação.",
  options_speakers_auto: "Auto",
  options_speakers_one: "1 falante",
  options_speakers_n: "{n} falantes",
  options_advanced: "Avançado",
  options_model_picker_label: "Modelo",
  options_model_picker_hint:
    "Escolha um modelo específico. Sobrescreve a escolha do preset acima.",
  options_summary_diar_on: "diarização ligada",
  options_summary_diar_off: "diarização desligada",

  // Start button + ETA
  start_transcription: "Iniciar transcrição →",
  start_transcription_starting: "Iniciando…",
  start_transcription_aria: "Iniciar transcrição",
  estimated_prefix: "estimado ",
  estimated_suffix: " na GPU local",

  // Pipeline / ProcessingCard
  pipeline_label: "Pipeline",
  pipeline_step_uploading: "Enviando",
  pipeline_step_queued: "Na fila",
  pipeline_step_transcribing: "Transcrevendo",
  pipeline_step_diarizing: "Diarizando",
  pipeline_step_done: "Pronto",
  phase_uploading_title: "Enviando para home-gpu-01",
  phase_uploading_detail:
    "Upload em pedaços resumível via Cloudflare Quick Tunnel",
  phase_queued_title: "Na fila",
  phase_queued_waiting_for_gpu: "Aguardando a GPU",
  phase_queued_jobs_ahead_one: "Aguardando a GPU — 1 trabalho na frente",
  phase_queued_jobs_ahead_n: "Aguardando a GPU — {n} trabalhos na frente",
  phase_transcribing_title: "Transcrevendo com whisper.cpp",
  phase_transcribing_detail: "Fator tempo real — · processado {pct}%",
  phase_diarizing_title: "Diarizando com pyannote 3.4",
  phase_diarizing_detail: "Detectando falantes · agrupando segmentos",
  phase_merging_title: "Mesclando segmentos",
  phase_merging_detail: "Alinhando palavras aos falantes",
  phase_done_title: "Pronto — abrindo editor",
  phase_done_detail: "Carregando transcrição…",
  phase_failed_title: "Falha na transcrição",
  phase_cancelling_title: "Cancelando…",
  phase_cancelling_detail: "Parando o worker; saída parcial descartada",
  upload_chunk_n_of_64: "pedaço {n}/64",
  upload_complete: "envio completo",
  processing_est_remaining: "tempo restante",

  // Errors
  err_backend_unreachable_title: "Não consegui conectar ao seu servidor",
  err_backend_unreachable_body:
    "Não consegui falar com o backend FastAPI no seu computador. Verifique se o backend está rodando e se o túnel Cloudflare está ativo.",
  err_upload_failed_title: "Falha no envio",
  err_upload_failed_body:
    "O upload em pedaços não terminou. Verifique sua rede e tente de novo.",
  err_auth_failed_title: "Sessão expirada",
  err_auth_failed_body:
    "Sua sessão não é mais válida. Recarregue a página e tente de novo.",
  err_validation_failed_title: "O backend rejeitou o trabalho",
  err_pipeline_failed_title: "Falha na transcrição",
  err_unknown_title: "Algo deu errado",
  err_unknown_body: "Erro inesperado — veja detalhes abaixo.",

  // Cancel button
  cancel_job: "Cancelar trabalho",
  cancel_back_to_upload: "Voltar para o envio",
  cancel_aria: "Cancelar trabalho",

  // Editor toolbar
  editor_toggle_speakers_show: "Mostrar falantes",
  editor_toggle_speakers_hide: "Esconder falantes",
  editor_toggle_minimap_show: "Mostrar minimapa",
  editor_toggle_minimap_hide: "Esconder minimapa",
  editor_filter_segments: "Filtrar segmentos…",
  editor_filter_segments_aria: "Filtrar segmentos",
  editor_density_compact: "Compacto",
  editor_density_normal: "Normal",
  editor_density_comfy: "Espaçoso",
  editor_density_aria: "Densidade",
  editor_export: "Exportar",
  editor_export_aria: "Exportar transcrição",
  editor_playback_rate_aria: "Velocidade de reprodução",
  editor_audio_lost:
    "Fonte de áudio perdida ao recarregar — reenvie o arquivo para ativar o controle.",
  editor_audio_upload_again: "Enviar de novo",

  // Speakers rail
  editor_speakers: "Falantes",
  editor_segments_count_one: "1 segmento",
  editor_segments_count_n: "{n} segmentos",
  editor_add_speaker: "Adicionar falante",
  editor_renames_global_title: "Renomeações são globais",
  editor_renames_global_body:
    "Renomear um falante atualiza todos os segmentos.",

  // Segment actions
  editor_reassign_speaker_aria: "Atribuir falante",
  editor_reassign_to_label: "Atribuir a",
  editor_apply_to_every_speaker: "Aplicar a todo segmento de {label}",
  editor_apply_to_every_fallback: "Aplicar a todo segmento do falante",
  editor_split_at_cursor: "Dividir no cursor",
  editor_merge_with_previous: "Mesclar com anterior",
  editor_delete_segment: "Apagar segmento",
  editor_toast_segment_split: "Segmento dividido",
  editor_toast_segment_reassigned: "Segmento reatribuído",
  editor_toast_merged_with_previous: "Mesclado com anterior",
  editor_toast_segment_deleted: "Segmento apagado",
  editor_toast_segment_deleted_undo: "Segmento apagado — desfazer?",
  editor_toast_speaker_added_reassigned:
    "Novo falante adicionado e reatribuído",
  editor_rename_speaker_label: "Renomear {label}",
  editor_rename_speaker_aria: "Novo nome do falante",
  editor_rename_save: "Salvar",
  editor_undo: "Desfazer",
  editor_revert_original: "Voltar ao original",
  editor_revert_confirm:
    "Descartar todas as edições e recarregar a transcrição original?",
  editor_revert_confirm_action: "Voltar",
  editor_revert_cancel: "Cancelar",
  editor_loading_transcript: "Carregando transcrição…",

  // Editor footer
  editor_word_count_words: " palavras",
  editor_word_count_segments_one: "1 segmento",
  editor_word_count_segments_n: "{n} segmentos",
  editor_save_just_now: "agora",
  editor_save_seconds_ago: "{n}s atrás",
  editor_save_minutes_ago: "{n}min atrás",
  editor_save_hours_ago: "{n}h atrás",
  editor_save_last_saved_prefix: "Salvo pela última vez ",
  editor_save_autosave_localstorage: " · salvamento automático no localStorage",
  editor_save_failed:
    "⚠ Falha ao salvar localmente — suas edições não estão persistidas",

  // Minimap / overview
  editor_overview: "Visão geral",

  // History page
  history_signed_out_hint:
    "Entre pelo botão de usuário (canto superior direito) para ver suas transcrições.",
  history_zero_no_transcripts: "Nenhuma transcrição ainda.",
  history_zero_new: "+ Nova transcrição",
  history_kicker: "Suas transcrições",
  history_title: "Histórico",
  history_search_placeholder: "Buscar por título…",
  history_footer:
    "Armazenado no Supabase · sincronizado via Realtime · clique em qualquer linha para abrir",
  history_load_more: "Carregar mais",
  history_rename_failed: "Falha ao renomear",
  history_delete_failed: "Falha ao apagar",
  history_deleted_undo: 'Apagado "{title}".',

  // User button
  user_sign_in: "Entrar",
  user_sign_out: "Sair",
  user_history: "Histórico",

  // Language toggle
  language_toggle_aria: "Switch language / Trocar idioma",
};
