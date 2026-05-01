"use client";
import * as React from "react";
import { editorReducer, type EditorState } from "@/lib/editor/reducer";
import { SAMPLE_PAYLOAD } from "@/lib/mock/data";
import { useI18n } from "@/lib/i18n/i18n-context";
import {
  useAutosave,
  readSavedEdits,
  clearSavedEdits,
} from "@/lib/editor/persist";
import { useEditorStore } from "@/lib/editor/store";
import { subscribeToJob, type JobRow } from "@/lib/supabase/realtime-client";
import { ToastProvider } from "@/components/ui/toast";
import { SpeakerRail } from "@/components/transcribe/editor/speaker-rail";
import { SegmentList } from "@/components/transcribe/editor/segment-list";
import { EditorToolbar } from "@/components/transcribe/editor/editor-toolbar";
import { EditorFooter } from "@/components/transcribe/editor/footer";
import {
  Minimap,
  type MinimapScale,
} from "@/components/transcribe/editor/minimap";
import { Timeline } from "@/components/transcribe/editor/timeline";
import { AudioPlayer } from "@/components/transcribe/editor/audio-player";
import { RestorePill } from "@/components/transcribe/restore-pill";
import { AnonPromotionBanner } from "@/components/transcribe/auth/anon-promotion-banner";
import { ExportModal } from "@/components/transcribe/export-modal";
import { env } from "@/lib/env";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { promoteAnonJob } from "@/lib/auth/promote";
import * as Tooltip from "@/components/ui/tooltip";
import * as Dialog from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface EditorClientProps {
  jobId: string;
  /** True when the job was created anonymously (no transcripts row for current user). D-08 */
  isAnonJob?: boolean;
}

type Density = "compact" | "normal" | "comfortable";

/**
 * Empty placeholder used while the real transcript loads from Supabase.
 * The mock path keeps SAMPLE_PAYLOAD as its initial seed (so the
 * Storybook-style demo job continues to render without a backend) — the
 * production path stays empty + skeleton-gated until the initial fetch
 * resolves. Item 10 of "things to change 2.txt": users were seeing the
 * Maya demo flash on every reload of a real job because the initial
 * dispatch happened a tick after first paint.
 */
const EMPTY_PAYLOAD: EditorState = {
  version: 1,
  language: "",
  duration_sec: 0,
  speakers: [],
  segments: [],
};

function resolveInitial(jobId: string): EditorState {
  void jobId;
  if (env.NEXT_PUBLIC_USE_MOCKS === "1") return SAMPLE_PAYLOAD;
  return EMPTY_PAYLOAD;
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
  const { t } = useI18n();
  const [state, dispatch] = React.useReducer(
    editorReducer,
    jobId,
    resolveInitial,
  );
  // Item 6 of "things to change 2.txt": back up every mutation so the user
  // can undo accidental deletes / splits / renames, and stash the first
  // hydrated payload so "Revert to original" can roll the whole transcript
  // back. We use refs (not state) for the history stack to avoid re-renders
  // on every dispatch; only the head's existence drives the toolbar's
  // disabled state, which we track in a small piece of state below.
  const historyRef = React.useRef<EditorState[]>([]);
  const originalRef = React.useRef<EditorState | null>(null);
  const [canUndo, setCanUndo] = React.useState(false);

  const wrappedDispatch = React.useCallback(
    (action: import("@/lib/editor/reducer").EditorAction) => {
      // 'restore' actions come from server hydration / the restore pill /
      // undo itself — we don't want them clogging the history stack.
      if (action.type !== "restore") {
        // Cap at 50 entries; older snapshots fall off the front.
        const stack = historyRef.current;
        stack.push(state);
        if (stack.length > 50) stack.shift();
        setCanUndo(true);
      }
      dispatch(action);
    },
    [state],
  );

  const undo = React.useCallback(() => {
    const prev = historyRef.current.pop();
    if (!prev) return;
    dispatch({ type: "restore", state: prev });
    setCanUndo(historyRef.current.length > 0);
  }, []);

  // Stamp the original payload once, the first time the server delivers
  // real data. Mock mode never enters this path (the seed IS the payload),
  // so we cover that case in a separate effect below.
  const stampOriginal = React.useCallback((payload: EditorState) => {
    if (originalRef.current === null) originalRef.current = payload;
  }, []);

  React.useEffect(() => {
    if (env.NEXT_PUBLIC_USE_MOCKS === "1" && originalRef.current === null) {
      // The reducer was seeded with SAMPLE_PAYLOAD in mock mode — stash it
      // as the original so revert still works in the demo build.
      originalRef.current = state;
    }
    // We deliberately want this to run only once on mount; the dependency
    // array stays empty so a later state change doesn't overwrite the
    // captured original.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Revert opens a confirmation modal — Dialog.Root is rendered below, and
  // its open state is owned by editor-client. We snapshot the current
  // state into the undo stack on confirm so the user can still walk the
  // revert back if they regret it.
  const [revertOpen, setRevertOpen] = React.useState(false);
  const revertToOriginal = React.useCallback(() => {
    if (!originalRef.current) return;
    setRevertOpen(true);
  }, []);
  const confirmRevert = React.useCallback(() => {
    const orig = originalRef.current;
    if (!orig) return;
    historyRef.current.push(state);
    setCanUndo(true);
    dispatch({ type: "restore", state: orig });
    setRevertOpen(false);
  }, [state]);
  // Hydration gate — true until the first read of jobs.transcript_payload
  // (or a Realtime UPDATE) completes. The skeleton renders during this
  // window so the user never sees the empty placeholder, and the mock
  // path is hydrated from the start since SAMPLE_PAYLOAD is its seed.
  const [hydrated, setHydrated] = React.useState(
    () => env.NEXT_PUBLIC_USE_MOCKS === "1",
  );
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
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const {
        data: { user },
      } = await supabase.auth.getUser();
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

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) return;
      if (session.user?.is_anonymous) {
        previousAnonTokenRef.current = session.access_token;
      } else if (previousAnonTokenRef.current) {
        // Transition: anonymous → signed-in
        setShowPromotionBanner(true);
      }
    });

    return () => subscription.unsubscribe();
  }, [isAnonJob]);

  // Density (D-26 — per-user, persisted to localStorage)
  const [density, setDensity] = React.useState<Density>(() => {
    try {
      return (window.localStorage.getItem("transcribe.density") ??
        "normal") as Density;
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
  // Lifted minimap scale so the sibling Timeline (single-speaker mode) can
  // use the same density. Persisted by Minimap on every change.
  // Default 2× — see Minimap for the rationale (preview text needs height).
  // Read the persisted scale up here so a user preference still wins. The
  // Minimap below skips its own localStorage read when scale is lifted.
  const [minimapScale, setMinimapScale] = React.useState<MinimapScale>(() => {
    try {
      const stored = window.localStorage.getItem("transcribe.minimapScale");
      if (stored === "1" || stored === "2" || stored === "3") {
        return Number(stored) as MinimapScale;
      }
    } catch {
      /* SSR or private mode — fall through */
    }
    return 2;
  });
  const [exportOpen, setExportOpen] = React.useState(false);

  // Audio state. After Task 6 the toolbar no longer renders a Play/Pause
  // button, so isPlaying isn't read anywhere — but AudioPlayer still calls
  // onPlayingChange, and a future per-segment "currently playing" indicator
  // (deferred) will want this state. Keep the reducer pair, prefix the
  // unused value to silence the noUnusedLocals rule.
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const [, setIsPlaying] = React.useState(false);
  const [playT, setPlayT] = React.useState(0);

  // Active segment — derived from playT; segment whose start <= playT < end
  const activeSeg = React.useMemo(() => {
    return (
      state.segments.find((seg) => seg.start <= playT && playT < seg.end) ??
      null
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
      // Cmd/Ctrl + Z → undo last transcript edit. EditableText stops
      // propagation when its contentEditable is focused, so native browser
      // undo still works for in-flight typing — only edits already
      // committed via the reducer get rolled back here.
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.shiftKey &&
        e.key.toLowerCase() === "z"
      ) {
        const ae = document.activeElement as HTMLElement | null;
        const editable = ae?.isContentEditable ?? false;
        const tag = ae?.tagName ?? "";
        if (editable || tag === "INPUT" || tag === "TEXTAREA") return;
        e.preventDefault();
        undo();
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
  }, [undo]);

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
            const next = row.transcript_payload as EditorState;
            stampOriginal(next);
            // T-03-51: Phase 3 trusts SAMPLE_PAYLOAD shape; Phase 4 adds zod validation.
            dispatch({ type: "restore", state: next });
          }
        };
        const sub = client
          .channel(`job-${jobId}`)
          .on(
            "postgres_changes",
            {
              event: "UPDATE",
              schema: "public",
              table: "jobs",
              filter: `id=eq.${jobId}`,
            },
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
        const next = row.transcript_payload as EditorState;
        stampOriginal(next);
        dispatch({ type: "restore", state: next });
        setHydrated(true);
      }
    });
  }, [jobId, stampOriginal]);

  // One-shot initial transcript hydration (quick task 260430-lr0).
  // The Realtime subscription above only fires on UPDATE events. When the
  // user opens the editor for a job that already settled (status='succeeded'
  // before the page was opened), no UPDATE will ever fire and the editor
  // would stay on SAMPLE_PAYLOAD forever. Read jobs.transcript_payload once
  // on mount and dispatch the same `restore` action the Realtime handler uses.
  // RLS jobs_select_own ensures the browser client (anon key) can only read
  // the user's own rows — no service-role key on the client (CLAUDE.md L8).
  React.useEffect(() => {
    if (env.NEXT_PUBLIC_USE_MOCKS === "1") return;
    let cancelled = false;
    void (async () => {
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase
        .from("jobs")
        .select("transcript_payload")
        .eq("id", jobId)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        // Network / RLS / row-not-found → leave SAMPLE_PAYLOAD in place. The
        // Realtime subscription will hydrate when the row eventually settles.
        // T-03-51 (zod validation) tracked separately.
        console.warn(
          "[editor] initial transcript fetch failed:",
          error.message,
        );
        return;
      }
      if (data?.transcript_payload) {
        const next = data.transcript_payload as EditorState;
        stampOriginal(next);
        dispatch({ type: "restore", state: next });
      }
      // Whether or not a payload was present, the initial read settled —
      // flip the skeleton off. If the row is still processing, the
      // Realtime subscription above will fill in transcript_payload when
      // status flips to 'succeeded'.
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId, stampOriginal]);

  // VIEW-05: click-to-seek — set audio.currentTime to segment start
  const onSegmentClick = React.useCallback(
    (seg: { id: string; start: number }) => {
      const a = audioRef.current;
      if (a) a.currentTime = seg.start;
      setPlayT(seg.start);
    },
    [],
  );

  // Quick task 260501-1e4 Task 6 (item line 33 of Things-to-change.txt):
  // the editor toolbar's duplicate Play/Pause + scrub slider were removed.
  // The bottom <AudioPlayer> already exposes native controls + a speed picker,
  // and the Space-bar keyboard shortcut above drives audio.play()/pause()
  // directly, so deleting onPlayPause/onScrub does not regress UX.

  const onRebindFile = React.useCallback(
    (file: File) => {
      setFileRef(jobId, file);
    },
    [jobId, setFileRef],
  );

  if (!hydrated) {
    // Lightweight skeleton while the initial transcript read settles.
    // Item 10 of "things to change 2.txt" — the prior implementation
    // seeded state with the Maya demo payload and flashed it on every
    // reload before the real transcript arrived a tick later.
    return (
      <div
        role="status"
        aria-live="polite"
        aria-busy="true"
        style={{
          height: "calc(100dvh - 64px)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "flex-start",
          padding: "60px 24px",
          gap: 18,
        }}
      >
        <span className="sr-only">{t.editor_loading_transcript}</span>
        <div
          style={{
            width: "min(820px, 100%)",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div
            style={{
              height: 36,
              width: "40%",
              borderRadius: 6,
              background: "var(--color-bg-2)",
              animation: "fade 600ms ease infinite alternate",
            }}
          />
          <div
            style={{
              height: 32,
              width: "100%",
              borderRadius: 6,
              background: "var(--color-bg-2)",
              animation: "fade 600ms ease infinite alternate",
            }}
          />
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              style={{
                height: 64,
                borderRadius: 8,
                background: "var(--color-bg-2)",
                opacity: 0.6 + (i % 3) * 0.1,
                animation: "fade 600ms ease infinite alternate",
              }}
            />
          ))}
        </div>
      </div>
    );
  }

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
            // Right rail width grows when the single-speaker timeline is
            // visible — it sits next to the minimap at 200px (overview) +
            // 110px (timeline). Item line 47 of Things-to-change.txt.
            gridTemplateColumns: `${speakersOpen ? "240px" : "0"} 1fr ${
              minimapOpen
                ? state.speakers.length === 1
                  ? "310px"
                  : "200px"
                : "0"
            }`,
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
              speakersOpen={speakersOpen}
              onToggleSpeakers={() => setSpeakersOpen((v) => !v)}
              minimapOpen={minimapOpen}
              onToggleMinimap={() => setMinimapOpen((v) => !v)}
              onExport={() => setExportOpen(true)}
              onUndo={undo}
              canUndo={canUndo}
              onRevertToOriginal={revertToOriginal}
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
              dispatch={wrappedDispatch}
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
                dispatch={wrappedDispatch}
                onSegmentClick={onSegmentClick}
              />
            </div>
          </main>

          {/* Right — minimap (+ vertical timeline when only one speaker).
              Item line 47 of Things-to-change.txt: a single-speaker
              transcript renders the colored stripes redundantly, so we
              repurpose the freed visual real estate as a clickable wall
              clock the user can scroll through. */}
          <div
            style={{
              gridArea: "right",
              overflow: "hidden",
              display: minimapOpen ? "flex" : "none",
              flexDirection: "row",
            }}
          >
            <div style={{ width: 200, flexShrink: 0, height: "100%" }}>
              <Minimap
                segments={state.segments}
                speakers={state.speakers}
                playT={playT}
                totalDuration={state.duration_sec}
                activeSegId={activeSeg?.id ?? null}
                onJump={(seg) => {
                  onSegmentClick(seg);
                }}
                scale={minimapScale}
                onScaleChange={setMinimapScale}
              />
            </div>
            {state.speakers.length === 1 ? (
              <div style={{ width: 110, flexShrink: 0, height: "100%" }}>
                <Timeline
                  segments={state.segments}
                  totalDuration={state.duration_sec}
                  playT={playT}
                  scale={minimapScale}
                  onJump={(time) => {
                    const a = audioRef.current;
                    if (a) a.currentTime = time;
                    setPlayT(time);
                  }}
                />
              </div>
            ) : null}
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

        {/* Revert-to-original confirmation. Replaces the native
            window.confirm so the prompt sits in the app's design language
            (focus trap, Escape, animated backdrop) and so the title +
            body can render proper Portuguese punctuation/diacritics
            instead of the OS-default browser dialog. */}
        <Dialog.Root open={revertOpen} onOpenChange={setRevertOpen}>
          <Dialog.Panel
            aria-labelledby="revert-title"
            aria-describedby="revert-body"
            style={{
              width: "min(440px, 100%)",
              padding: 22,
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
          >
            <Dialog.Title
              id="revert-title"
              style={{
                fontSize: 16,
                fontWeight: 600,
                color: "var(--color-fg-0)",
                margin: 0,
              }}
            >
              {t.editor_revert_original}
            </Dialog.Title>
            <Dialog.Description
              id="revert-body"
              style={{
                fontSize: 13.5,
                lineHeight: 1.5,
                color: "var(--color-fg-2)",
                margin: 0,
              }}
            >
              {t.editor_revert_confirm}
            </Dialog.Description>
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
                marginTop: 4,
              }}
            >
              <Dialog.Close
                render={(props) => (
                  <Button {...props} variant="ghost" size="sm">
                    {t.editor_revert_cancel}
                  </Button>
                )}
              />
              <Button variant="primary" size="sm" onClick={confirmRevert}>
                {t.editor_revert_confirm_action}
              </Button>
            </div>
          </Dialog.Panel>
        </Dialog.Root>
      </Tooltip.Provider>
    </ToastProvider>
  );
}
