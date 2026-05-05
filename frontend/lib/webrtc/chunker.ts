/**
 * lib/webrtc/chunker.ts — Audio chunked transfer with backpressure (Plan 08-07 Task 3).
 *
 * Sends a File (or Blob) over an RTCDataChannel in ≤64 KB binary frames.
 * Implements the RTCDataChannel backpressure pattern from RESEARCH.md §Pattern 2.
 *
 * Constants:
 *   CHUNK_SIZE       — 64 KB hard cap per channel.send() (SCTP limit, Pitfall #3)
 *   HIGH_WATER_MARK  — pause sending above 1 MB buffered
 *   LOW_WATER_MARK   — resume when buffered drops below 256 KB
 *
 * T-08-07-01 mitigation: CHUNK_SIZE is strictly < 64 KB SCTP limit.
 */

export const CHUNK_SIZE = 64 * 1024; // 64 KB (SCTP Pitfall #3 — never exceed this)
export const HIGH_WATER_MARK = 1 * 1024 * 1024; // 1 MB
export const LOW_WATER_MARK = 256 * 1024; // 256 KB

/**
 * sendAudioChunked — stream a file over an RTCDataChannel in ≤64 KB binary frames.
 *
 * @param channel      Open RTCDataChannel (readyState must be 'open').
 * @param file         The audio file to send.
 * @param fromOffset   Byte offset to start from (0 for fresh send; >0 for resume).
 * @param onProgress   Called after each chunk with (bytesSent, totalBytes).
 *
 * After all chunks are sent, emits a JSON `audio_eof` control message.
 *
 * Throws if the channel closes mid-transfer (readyState !== 'open').
 */
export async function sendAudioChunked(
  channel: RTCDataChannel,
  file: File | Blob,
  fromOffset: number,
  onProgress: (bytesSent: number, totalBytes: number) => void,
): Promise<void> {
  // Set the low-water mark once (idempotent on repeated calls on same channel).
  channel.bufferedAmountLowThreshold = LOW_WATER_MARK;

  /**
   * Wait for bufferedAmount to drop below HIGH_WATER_MARK.
   * Uses the `bufferedamountlow` event to avoid a polling loop.
   */
  function waitForLow(): Promise<void> {
    return new Promise<void>((resolve) => {
      const onLow = () => {
        channel.removeEventListener("bufferedamountlow", onLow);
        resolve();
      };
      channel.addEventListener("bufferedamountlow", onLow);
    });
  }

  let bytesSent = fromOffset;
  const totalBytes = file.size;

  for (let offset = fromOffset; offset < totalBytes; offset += CHUNK_SIZE) {
    // Check channel is still open on each iteration.
    if (channel.readyState !== "open") {
      throw new Error(
        `sendAudioChunked: channel closed mid-transfer at offset ${offset}/${totalBytes}`,
      );
    }

    // Backpressure: pause when send buffer is above high-water mark.
    if (channel.bufferedAmount > HIGH_WATER_MARK) {
      await waitForLow();
    }

    // Recheck after awaiting (channel may have closed while we waited).
    if (channel.readyState !== "open") {
      throw new Error(
        `sendAudioChunked: channel closed during backpressure wait at offset ${offset}`,
      );
    }

    const slice = file.slice(offset, offset + CHUNK_SIZE);
    const buf = await slice.arrayBuffer();
    channel.send(buf);

    bytesSent = offset + buf.byteLength;
    onProgress(bytesSent, totalBytes);
  }

  // Signal end-of-stream with a JSON control message.
  channel.send(JSON.stringify({ type: "audio_eof", total_bytes: totalBytes }));
}
