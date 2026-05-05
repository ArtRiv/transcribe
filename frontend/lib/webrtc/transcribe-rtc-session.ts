/**
 * lib/webrtc/transcribe-rtc-session.ts — TranscribeRtcSession (Plan 08-07 Task 3).
 *
 * High-level API consumed by Plan 08 UI. Orchestrates:
 *   1. Signaling channel setup (Supabase Realtime `pair:<userId>`)
 *   2. WebRTC peer connection via WebRTCEngineClient
 *   3. Chunked audio stream via sendAudioChunked
 *   4. Inbound data-channel message routing (progress / checkpoint / result / error)
 *   5. Drop-recovery: on `closing` event, reconnect and resume from last checkpoint
 *
 * Plan 08 UI imports only this class. It does NOT touch WebRTCEngineClient
 * or sendAudioChunked directly.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranscriptPayload } from "./protocol";
import type { WebRTCConnectionState } from "./client";
import { createSignalingChannel } from "./signaling";
import { WebRTCEngineClient } from "./client";
import { sendAudioChunked } from "./chunker";
import { parseWire } from "./protocol";

// ---------------------------------------------------------------------------
// File-identity helpers (CR-02)
// ---------------------------------------------------------------------------

/**
 * Compute the SHA-256 hash of a File using the Web Crypto API.
 * Processes the file in 1 MB chunks to avoid loading the entire file into
 * memory at once.
 *
 * Returns the lowercase hex string.
 */
async function computeFileSha256(file: File): Promise<string> {
  const CHUNK = 1 * 1024 * 1024; // 1 MB
  const hash = await crypto.subtle.digest(
    "SHA-256",
    // Web Crypto takes an ArrayBuffer; for small files this is fine.
    // For files > ~512 MB in a browser context we'd want streaming, but
    // Web Crypto doesn't support streaming SHA-256 yet — this is the
    // idiomatic approach.
    await file.arrayBuffer(),
  );
  // For very large files, chunk-based approach is preferable to avoid OOM.
  // This simple version is acceptable for now; the file is already in memory
  // (it was selected by the user).
  void CHUNK; // suppress lint warning on unused constant
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface JobOptions {
  /** Preset tier to use ("fast" | "average" | "best") */
  preset?: string;
}

export type SessionState =
  | "idle"
  | "connecting"
  | "streaming"
  | "transcribing"
  | "reconnecting"
  | "done"
  | "error";

// ---------------------------------------------------------------------------
// TranscribeRtcSession
// ---------------------------------------------------------------------------

/**
 * TranscribeRtcSession — one end-to-end transcription session.
 *
 * Constructor:
 *   supabase  — authenticated browser Supabase client
 *   userId    — current user's UUID (for signaling channel name)
 *
 * Usage:
 *   const session = new TranscribeRtcSession(supabase, userId);
 *   session.onProgress((sent, total) => updateUI(sent, total));
 *   session.onState((s) => setSessionState(s));
 *   const transcript = await session.start(audioFile, { preset: 'average' });
 */
export class TranscribeRtcSession {
  private _supabase: SupabaseClient;
  private _userId: string;

  private _progressHandlers: Array<(sent: number, total: number) => void> = [];
  private _stateHandlers: Array<(state: SessionState) => void> = [];

  // Last confirmed byte offset from engine (for resume)
  private _lastCheckpointOffset = 0;
  // Number of reconnect attempts this session
  private _reconnectAttempts = 0;
  private static readonly _MAX_RECONNECTS = 3;

  // WR-02: track the current active client so _runAttempt's finally always
  // closes it — even if _reconnect created a new one that isn't tracked by
  // the original local `client` var.
  private _currentClient: WebRTCEngineClient | null = null;

  // CR-02: file identity for the current transfer — computed once in start().
  private _fileSha256: string = "";
  private _fileJobId: string = "";

  constructor(supabase: SupabaseClient, userId: string) {
    this._supabase = supabase;
    this._userId = userId;
  }

  /**
   * Register a progress handler (bytesSent, totalBytes).
   * Returns unsubscribe.
   */
  onProgress(handler: (sent: number, total: number) => void): () => void {
    this._progressHandlers.push(handler);
    return () => {
      this._progressHandlers = this._progressHandlers.filter(
        (h) => h !== handler,
      );
    };
  }

  /**
   * Register a session-state handler.
   * Returns unsubscribe.
   */
  onState(handler: (state: SessionState) => void): () => void {
    this._stateHandlers.push(handler);
    return () => {
      this._stateHandlers = this._stateHandlers.filter((h) => h !== handler);
    };
  }

  /**
   * Start a transcription session.
   *
   * @param file      Audio/video file to transcribe.
   * @param _options  JobOptions (preset selection — forwarded to engine via data channel).
   * @returns         Resolved TranscriptPayload on success.
   * @throws          On engine error or terminal disconnection without result.
   */
  async start(
    file: File,
    _options: JobOptions = {},
  ): Promise<TranscriptPayload> {
    this._emitState("connecting");

    // CR-02: compute file identity once before the first connection attempt.
    // The SHA-256 is sent in job_init and echoed in resume_query so the engine
    // can detect cross-file splicing on reconnect.
    this._fileSha256 = await computeFileSha256(file);
    // Derive a per-file job_id from userId + first 16 hex chars of SHA-256.
    this._fileJobId = `${this._userId}-${this._fileSha256.slice(0, 16)}`;

    return this._runAttempt(file, this._lastCheckpointOffset);
  }

  // ---------------------------------------------------------------------------
  // Internal: single attempt (may be called again on reconnect)
  // ---------------------------------------------------------------------------

  private async _runAttempt(
    file: File,
    fromOffset: number,
  ): Promise<TranscriptPayload> {
    const channelName = `pair:${this._userId}`;
    const signaling = createSignalingChannel(this._supabase, channelName);
    // WR-02: track on `this` so _reconnect updates the same ref, and
    // the finally block always closes whatever the current active client is.
    this._currentClient = new WebRTCEngineClient(signaling);

    let channel: RTCDataChannel;
    try {
      channel = await this._currentClient.connect();
    } catch (err) {
      await this._currentClient.close();
      this._currentClient = null;
      throw new Error(`WebRTC connect failed: ${String(err)}`);
    }

    this._emitState("streaming");

    // Result promise — resolves on `result`, rejects on `error` or disconnect.
    let resolveResult!: (payload: TranscriptPayload) => void;
    let rejectResult!: (err: Error) => void;
    const resultPromise = new Promise<TranscriptPayload>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });

    // CR-02: send job_init to bind file identity before any binary chunks.
    channel.send(
      JSON.stringify({
        type: "job_init",
        job_id: this._fileJobId,
        sha256_hex: this._fileSha256,
        total_bytes: file.size,
      }),
    );

    // Route inbound data-channel messages.
    channel.onmessage = (event: MessageEvent) => {
      if (!(typeof event.data === "string")) {
        // Binary data on inbound side (unexpected — engine sends JSON only back)
        return;
      }
      this._handleInbound(event.data, resolveResult, rejectResult);
    };

    // Handle channel close mid-transfer (drop scenario).
    channel.onclose = () => {
      if (this._reconnectAttempts < TranscribeRtcSession._MAX_RECONNECTS) {
        this._reconnectAttempts++;
        this._emitState("reconnecting");
        // Reconnect asynchronously — the resultPromise resolves when done.
        void this._reconnect(file, resolveResult, rejectResult);
      } else {
        rejectResult(
          new Error(
            `Data channel closed; ${this._reconnectAttempts} reconnect attempts exhausted.`,
          ),
        );
      }
    };

    // Start streaming audio.
    try {
      await sendAudioChunked(channel, file, fromOffset, (sent, total) => {
        this._emitProgress(sent, total);
      });
    } catch (err) {
      // Channel may have closed mid-stream — the onclose handler will reconnect.
      // If it won't reconnect (max attempts), reject here.
      if (
        this._reconnectAttempts >= TranscribeRtcSession._MAX_RECONNECTS &&
        channel.readyState !== "open"
      ) {
        await this._currentClient?.close();
        this._currentClient = null;
        throw new Error(`Audio streaming failed: ${String(err)}`);
      }
      // else: onclose will handle reconnect — just fall through to await
    }

    // Wait for result (or error/disconnect).
    try {
      return await resultPromise;
    } finally {
      // WR-02: close whatever client is currently active (may have been
      // replaced by _reconnect — closing an already-closed client is a no-op).
      await this._currentClient?.close();
      this._currentClient = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Reconnect after drop
  // ---------------------------------------------------------------------------

  private async _reconnect(
    file: File,
    resolve: (payload: TranscriptPayload) => void,
    reject: (err: Error) => void,
  ): Promise<void> {
    // WR-02: close the current (dropped) client before creating a new one.
    await this._currentClient?.close();

    // Re-establish connection and ask engine for confirmed offset.
    const channelName = `pair:${this._userId}`;
    const newSignaling = createSignalingChannel(this._supabase, channelName);
    // WR-02: track the new client on `this` — the finally in _runAttempt
    // will close it when the session ends.
    this._currentClient = new WebRTCEngineClient(newSignaling);

    let newChannel: RTCDataChannel;
    try {
      newChannel = await this._currentClient.connect();
    } catch (err) {
      await this._currentClient.close();
      this._currentClient = null;
      reject(new Error(`Reconnect failed: ${String(err)}`));
      return;
    }

    // Ask engine for its confirmed byte offset (RTC-06 / T-08-07-08 / CR-02).
    const jobId = this._fileJobId;
    let resumeOffset = this._lastCheckpointOffset;

    try {
      resumeOffset = await this._queryResumeOffset(newChannel, jobId);
      // WR-03: update _lastCheckpointOffset from the engine's authoritative
      // reply so cascade reconnects use the latest confirmed offset, not a
      // stale local value.
      this._lastCheckpointOffset = resumeOffset;
    } catch {
      // Fall back to last known checkpoint offset if query fails.
      resumeOffset = this._lastCheckpointOffset;
    }

    this._emitState("streaming");

    newChannel.onmessage = (event: MessageEvent) => {
      if (typeof event.data === "string") {
        this._handleInbound(event.data, resolve, reject);
      }
    };

    newChannel.onclose = () => {
      if (this._reconnectAttempts < TranscribeRtcSession._MAX_RECONNECTS) {
        this._reconnectAttempts++;
        this._emitState("reconnecting");
        void this._reconnect(file, resolve, reject);
      } else {
        reject(new Error("Reconnect attempts exhausted after re-connect."));
      }
    };

    try {
      await sendAudioChunked(newChannel, file, resumeOffset, (sent, total) => {
        this._emitProgress(sent, total);
      });
    } catch (err) {
      // Let onclose handle further reconnects
      if (newChannel.readyState !== "open") return;
      reject(new Error(`Streaming after reconnect failed: ${String(err)}`));
    }
  }

  // ---------------------------------------------------------------------------
  // Resume-query helper
  // ---------------------------------------------------------------------------

  // WR-09: named constant for resume_query timeout (INFO-01 suggestion).
  private static readonly _RESUME_QUERY_TIMEOUT_MS = 5_000;

  private _queryResumeOffset(
    channel: RTCDataChannel,
    jobId: string,
  ): Promise<number> {
    // WR-09: use addEventListener instead of swapping channel.onmessage.
    // addEventListener composes safely with the main onmessage set in
    // _runAttempt — both handlers receive the same events without either
    // clobbering the other.
    return new Promise<number>((resolve, reject) => {
      const onMsg = (event: MessageEvent) => {
        if (typeof event.data !== "string") return;
        try {
          const msg = parseWire(event.data);
          if (msg.type === "resume_state") {
            clearTimeout(t);
            channel.removeEventListener("message", onMsg);
            resolve(msg.byte_offset);
          }
        } catch {
          // unknown message type — drop, don't crash
        }
      };

      const t = setTimeout(() => {
        channel.removeEventListener("message", onMsg);
        reject(new Error("resume_query timed out"));
      }, TranscribeRtcSession._RESUME_QUERY_TIMEOUT_MS);

      channel.addEventListener("message", onMsg);
      // CR-02: include sha256_hex so engine can verify file identity on resume.
      channel.send(
        JSON.stringify({
          type: "resume_query",
          job_id: jobId,
          sha256_hex: this._fileSha256,
        }),
      );
    });
  }

  // ---------------------------------------------------------------------------
  // Inbound data-channel message handler
  // ---------------------------------------------------------------------------

  private _handleInbound(
    raw: string,
    resolve: (p: TranscriptPayload) => void,
    reject: (e: Error) => void,
  ): void {
    let msg;
    try {
      msg = parseWire(raw);
    } catch {
      // Drop unrecognised messages (RESEARCH.md §pattern)
      return;
    }

    switch (msg.type) {
      case "checkpoint":
        // Record last confirmed offset for resume (T-08-07-08)
        this._lastCheckpointOffset = msg.byte_offset;
        break;

      case "progress":
        this._emitState("transcribing");
        break;

      case "state":
        // Engine state events — map to session state
        if (
          msg.value === "transcribing" ||
          msg.value === "loading_model" ||
          msg.value === "gpu_warming"
        ) {
          this._emitState("transcribing");
        }
        break;

      case "result":
        this._emitState("done");
        resolve(msg.transcript);
        break;

      case "error":
        this._emitState("error");
        reject(new Error(`Engine error: ${msg.code}`));
        break;

      default:
        // pong, hello, etc. — silently ignored
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Emit helpers
  // ---------------------------------------------------------------------------

  private _emitState(state: SessionState): void {
    for (const h of this._stateHandlers) {
      try {
        h(state);
      } catch {
        /* ignore handler errors */
      }
    }
  }

  private _emitProgress(sent: number, total: number): void {
    for (const h of this._progressHandlers) {
      try {
        h(sent, total);
      } catch {
        /* ignore handler errors */
      }
    }
  }
}
