"use client";
import * as React from "react";
import {
  editorReducer,
  type EditorState,
} from "@/lib/editor/reducer";
import { SAMPLE_PAYLOAD } from "@/lib/mock/data";
import { useAutosave, readSavedEdits, clearSavedEdits } from "@/lib/editor/persist";
import { useEditorStore } from "@/lib/editor/store";
import { subscribeToJob, type JobRow } from "@/lib/supabase/realtime-client";
import { ToastProvider } from "@/components/ui/toast";
import { SpeakerRail } from "@/components/transcribe/editor/speaker-rail";
import { SegmentList } from "@/components/transcribe/editor/segment-list";
import { EditorToolbar } from "@/components/transcribe/editor/editor-toolbar";
import { EditorFooter } from "@/components/transcribe/editor/footer";
import { Minimap } from "@/components/transcribe/editor/minimap";
import { AudioPlayer } from "@/components/transcribe/editor/audio-player";
import { RestorePill } from "@/components/transcribe/restore-pill";
import { AnonPromotionBanner } from "@/components/transcribe/auth/anon-promotion-banner";
import { ExportModal } from "@/components/transcribe/export-modal";
import { env } from "@/lib/env";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { promoteAnonJob } from "@/lib/auth/promote";
import * as Tooltip from "@/components/ui/tooltip";

interface EditorClientProps {
  jobId: string;
  /** True when the job was created anonymously (no transcripts row for current user). D-08 */
  isAnonJob?: boolean;
}

type Density = "compact" | "normal" | "comfortable";

/**
 * Resolve initial transcript payload.
 * Phase 3 mock: SAMPLE_PAYLOAD synchronously (Plan 03-01 fixture).
 * Phase 4 will fetch via TanStack Query against /jobs/{id}/transcript.
 */
function resolveInitial(jobId: string): EditorState {
  // In a real app this would be a useQuery; Phase 3 stays sync for simplicity.
  void jobId;
  return SAMPLE_PAYLOAD;
}

/**
 * Full editor surface — Client Component (UI-SPEC §16).
 *
 * Responsibilities:
 *  - useReducer(editorReducer) — pure transcript state machine (Plan 03-10)
 *  - Realtime subscription for live job status updates (PROG-03)
 *  - useAutosave — debounced localStorage mirror (D-29 / EDIT-06)
 *  - D-30 restore pill — compare local snapshot vs server updated_at
 *  - Keyboard shortcuts: Cmd/Ctrl+F → search, Escape → blur, Space → play/pause (D-28)
 *  - Density preference persisted to localStorage (D-26)
 *  - 3-column gridTemplateAreas layout: toolbar / left+main+right / footer (D-08)
 *
 * [Cited: RESEARCH §Pattern 2; 03-PATTERNS.md §editor-client.tsx]
 */
export function EditorClient({ jobId, isAnonJob = false }: EditorClientProps) {
  const [state, dispatch] = React.useReducer(editorReducer, jobId, resolveInitial);
  const saveStatus = useAutosave(jobId, state);
  const setFileRef = useEditorStore((s) => s.setFile);

  // ── D-08: Anon → signed-in promotion ──────────────────────────────────────
  // Capture the anon JWT BEFORE the magic-link redirect triggers a new session.
  // On mount, if the user is anonymous, we stash their access_token in a ref.
  // After sign-in, the ref still holds the previous (anon) JWT — required by
  // FastAPI's T-04-05 ownership-chain check.
  const previousAnonTokenRef = React.useRef<string>("");
  const [showPromotionBanner, setShowPromotionBanner] = React.useState(false);
  const [promotionSaving, setPromotionSaving] = React.useState(false);

  React.useEffect(() => {
    if (!isAnonJob) return;
    // Capture anon token if currently anonymous; detect sign-in transition.
    const supabase = getSupabaseBrowserClient();

    const captureIfAnon = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const { data: { user } } = await supabase.auth.getUser();
      if (!session || !user) return;

      if (user.is_anonymous) {
        // Stash the anon JWT for later use by the promote call.
        previousAnonTokenRef.current = session.access_token;
      } else if (previousAnonTokenRef.current) {
        // User was previously anonymous and is now signed in — show banner.
        setShowPromotionBanner(true);
      }
    };

    void captureIfAnon();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!session) return;
        if (session.user?.is_anonymous) {
          previousAnonTokenRef.current = session.access_token;
        } else if (previousAnonTokenRef.current) {
          // Transition: anonymous → signed-in
          setShowPromotionBanner(true);
        }
      },
    );

    return () => subscription.unsubscribe();
  }, [isAnonJob]);

  // Density (D-26 — per-user, persisted to localStorage)
  const [density, setDensity] = React.useState<Density>(() => {
    try {
      return (
        (window.localStorage.getItem("transcribe.density") ?? "normal") as Density
      );
    } catch {
      return "normal";
    }
  });
  React.useEffect(() => {
    try {
      window.localStorage.setItem("transcribe.density", density);
    } catch {
      /* Safari private mode / quota exceeded — swallow */
    }
  }, [density]);

  // Search + panel visibility state
  const [searchQuery, setSearchQuery] = React.useState("");
  const searchInputRef = React.useRef<HTMLInputElement | null>(null);
  const [speakersOpen, setSpeakersOpen] = React.useState(true);
  const [minimapOpen, setMinimapOpen] = React.useState(true);
  const [exportOpen, setExportOpen] = React.useState(false);

  // Audio state
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [playT, setPlayT] = React.useState(0);

  // Active segment — derived from playT; segment whose start <= playT < end
  const activeSeg = React.useMemo(() => {
    return (
      state.segments.find((seg) => seg.start <= playT && playT < seg.end) ?? null
    );
  }, [state.segments, playT]);

  // D-30 restore pill — read once on mount, hide after user action
  const [restoreSnapshot] = React.useState(() => readSavedEdits(jobId));
  const [restorePillDismissed, setRestorePillDismissed] = React.useState(false);
  // Phase 3 mock: server payload has no timestamp → any local snapshot is "newer".
  // Phase 4 will compare against the row's updated_at from the backend fetch.
  const serverAt = 0;

  // D-28 keyboard shortcuts
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Cmd/Ctrl + F → focus search input
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }
      // Escape → blur active element (Tooltip + Popover handle their own dismissal)
      if (e.key === "Escape") {
        const ae = document.activeElement;
        if (ae instanceof HTMLElement && ae !== document.body) ae.blur();
        return;
      }
      // Space → play/pause when no input/textarea/contentEditable is focused
      if (e.key === " ") {
        const ae = document.activeElement as HTMLElement | null;
        const tag = ae?.tagName ?? "";
        const editable = ae?.isContentEditable ?? false;
        if (editable || tag === "INPUT" || tag === "TEXTAREA") return;
        e.preventDefault();
        const a = audioRef.current;
        if (!a) return;
        if (a.paused) void a.play();
        else a.pause();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Realtime subscription — listens for job status changes.
  // When status='succeeded' arrives with transcript_payload, dispatch 'restore'
  // to replace state with the completed payload.
  // Mock path uses lib/mock/realtime.ts; real path uses lib/supabase/realtime-client.ts.
  // T-03-53: effect depends only on jobId to avoid accumulating handlers across re-renders.
  React.useEffect(() => {
    if (env.NEXT_PUBLIC_USE_MOCKS === "1") {
      let cleanupFn: (() => void) | null = null;
      void (async () => {
        const mod = await import("@/lib/mock/realtime");
        const client = mod.createMockSupabaseClient();
        const handler = (payload: { new: JobRow }) => {
          const row = payload.new;
          if (row.status === "succeeded" && row.transcript_payload) {
            // T-03-51: Phase 3 trusts SAMPLE_PAYLOAD shape; Phase 4 adds zod validation.
            dispatch({ type: "restore", state: row.transcript_payload as EditorState });
          }
        };
        const sub = client
          .channel(`job-${jobId}`)
          .on(
            "postgres_changes",
            { event: "UPDATE", schema: "public", table: "jobs", filter: `id=eq.${jobId}` },
            handler,
          )
          .subscribe();
        cleanupFn = () => sub.unsubscribe();
      })();
      return () => {
        cleanupFn?.();
      };
    }
    // Real path — subscribeToJob handles Supabase channel lifecycle.
    return subscribeToJob(jobId, (row) => {
      if (row.status === "succeeded" && row.transcript_payload) {
        dispatch({ type: "restore", state: row.transcript_payload as EditorState });
      }
    });
  }, [jobId]);

  // VIEW-05: click-to-seek — set audio.currentTime to segment start
  const onSegmentClick = React.useCallback((seg: { id: string; start: number }) => {
    const a = audioRef.current;
    if (a) a.currentTime = seg.start;
    setPlayT(seg.start);
  }, []);

  const onPlayPause = React.useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) void a.play();
    else a.pause();
  }, []);

  const onScrub = React.useCallback(
    (pct: number) => {
      const a = audioRef.current;
      if (!a || !state.duration_sec) return;
      a.currentTime = (pct / 100) * state.duration_sec;
    },
    [state.duration_sec],
  );

  const onRebindFile = React.useCallback(
    (file: File) => {
      setFileRef(jobId, file);
    },
    [jobId, setFileRef],
  );

  // Scrub position as percentage 0-100 for the toolbar slider
  const scrubPct =
    state.duration_sec > 0 ? (playT / state.duration_sec) * 100 : 0;

  return (
    <ToastProvider>
      <Tooltip.Provider>
        {/* D-30 restore pill — only when local snapshot is newer than server */}
        {restoreSnapshot && !restorePillDismissed ? (
          <RestorePill
            savedAt={restoreSnapshot.updatedAt}
            serverAt={serverAt}
            onRestore={() => {
              dispatch({ type: "restore", state: restoreSnapshot.state });
              clearSavedEdits(jobId);
              setRestorePillDismissed(true);
            }}
            onDiscard={() => {
              clearSavedEdits(jobId);
              setRestorePillDismissed(true);
            }}
          />
        ) : null}

        {/* D-08 anon promotion banner — shown when anon user signs in while editing */}
        {showPromotionBanner ? (
          <AnonPromotionBanner
            saving={promotionSaving}
            onSave={async () => {
              setPromotionSaving(true);
              const result = await promoteAnonJob({
                jobId,
                previousAnonToken: previousAnonTokenRef.current,
                payload: state,
                title: "Transcript",
                source_filename: "",
                duration_sec: state.duration_sec,
                language: state.language ?? null,
              });
              setPromotionSaving(false);
              if (result.ok) {
                setShowPromotionBanner(false);
                // D-09: autosave target switches to Supabase after promotion.
                // localStorage layer remains active as network-failure safety net.
              }
              // On failure, keep the banner visible so the user can retry.
            }}
            onDiscard={() => {
              setShowPromotionBanner(false);
            }}
          />
        ) : null}

        {/* Editor grid — D-08 + D-10 inline style for layout clarity */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `${speakersOpen ? "240px" : "0"} 1fr ${minimapOpen ? "200px" : "0"}`,
            gridTemplateRows: "auto 1fr auto",
            gridTemplateAreas:
              '"toolbar toolbar toolbar" "left main right" "footer footer footer"',
            height: "calc(100dvh - 64px)",
            transition: "grid-template-columns 200ms ease",
            position: "relative",
            zIndex: 2,
          }}
        >
          {/* Toolbar */}
          <div style={{ gridArea: "toolbar" }}>
            <EditorToolbar
              density={density}
              onDensityChange={setDensity}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              searchInputRef={searchInputRef}
              isPlaying={isPlaying}
              onPlayPause={onPlayPause}
              scrubPct={scrubPct}
              onScrub={onScrub}
              speakersOpen={speakersOpen}
              onToggleSpeakers={() => setSpeakersOpen((v) => !v)}
              minimapOpen={minimapOpen}
              onToggleMinimap={() => setMinimapOpen((v) => !v)}
              onExport={() => setExportOpen(true)}
            />
          </div>

          {/* Left — speakers rail */}
          <div
            style={{
              gridArea: "left",
              overflow: "hidden",
              display: speakersOpen ? "block" : "none",
            }}
          >
            <SpeakerRail
              speakers={state.speakers}
              segments={state.segments}
              activeSpeakerId={activeSeg?.speaker ?? null}
              dispatch={dispatch}
            />
          </div>

          {/* Main — scrollable transcript area */}
          <main
            style={{
              gridArea: "main",
              overflow: "auto",
              padding: "28px 28px 40px",
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            {/* Page title strip */}
            <div className="max-w-[820px] mx-auto w-full">
              <h1
                className="font-serif"
                style={{
                  fontSize: 32,
                  lineHeight: 1.1,
                  color: "var(--color-fg-0)",
                  letterSpacing: "-0.01em",
                }}
              >
                Transcript
              </h1>
              {/* OPTS-06 — show detected language when present */}
              {state.language ? (
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11.5,
                    color: "var(--color-fg-3)",
                    marginTop: 8,
                  }}
                >
                  Detected: {state.language}
                </div>
              ) : null}
            </div>

            {/* Audio player — D-14/D-15 Blob URL lifecycle handled inside AudioPlayer */}
            <div className="max-w-[820px] mx-auto w-full">
              <AudioPlayer
                audioRef={audioRef}
                jobId={jobId}
                onTimeUpdate={setPlayT}
                onPlayingChange={setIsPlaying}
                onRebindFile={onRebindFile}
              />
            </div>

            {/* Segment list — filtered + memoized */}
            <div className="max-w-[820px] mx-auto w-full">
              <SegmentList
                segments={state.segments}
                speakers={state.speakers}
                density={density}
                activeSegId={activeSeg?.id ?? null}
                searchQuery={searchQuery}
                dispatch={dispatch}
                onSegmentClick={onSegmentClick}
              />
            </div>
          </main>

          {/* Right — minimap */}
          <div
            style={{
              gridArea: "right",
              overflow: "hidden",
              display: minimapOpen ? "block" : "none",
            }}
          >
            <Minimap
              segments={state.segments}
              speakers={state.speakers}
              playT={playT}
              totalDuration={state.duration_sec}
              activeSegId={activeSeg?.id ?? null}
              onJump={(seg) => {
                onSegmentClick(seg);
              }}
            />
          </div>

          {/* Footer — word count + save status */}
          <div style={{ gridArea: "footer" }}>
            <EditorFooter state={state} saveStatus={saveStatus} />
          </div>
        </div>

        {/* Export modal — mounts/unmounts via open prop */}
        <ExportModal
          open={exportOpen}
          onOpenChange={setExportOpen}
          state={state}
          defaultTitle="Transcript"
        />
      </Tooltip.Provider>
    </ToastProvider>
  );
}
