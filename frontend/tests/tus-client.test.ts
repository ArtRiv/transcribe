import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock tus-js-client BEFORE importing upload-client.
const tusUploadMock = vi.fn();
vi.mock("tus-js-client", () => {
  class Upload {
    url: string | null = null;
    constructor(public file: unknown, public options: Record<string, unknown>) {
      tusUploadMock(file, options);
    }
    start() { /* no-op in tests */ }
    abort() { return Promise.resolve(); }
  }
  return { Upload };
});

// Import after mock so the wrapper picks up the stub.
const { TUS_CHUNK_SIZE, TUS_RETRY_DELAYS, startTusUpload } = await import(
  "@/lib/tus/upload-client"
);

describe("TUS_CHUNK_SIZE (Pitfall 3 sentinel)", () => {
  it("equals 90 MB exactly", () => {
    expect(TUS_CHUNK_SIZE).toBe(90 * 1024 * 1024);
    expect(TUS_CHUNK_SIZE).toBe(94_371_840);
  });

  it("is strictly less than backend MAX_CHUNK (100 MB)", () => {
    expect(TUS_CHUNK_SIZE).toBeLessThan(100 * 1024 * 1024);
  });
});

describe("TUS_RETRY_DELAYS", () => {
  it("matches RESEARCH §Pattern 3 line 502", () => {
    expect(TUS_RETRY_DELAYS).toEqual([0, 1000, 3000, 5000, 10000]);
  });
});

describe("startTusUpload", () => {
  beforeEach(() => {
    tusUploadMock.mockClear();
  });

  it("constructs tus.Upload with chunkSize: 90 MB and retryDelays", () => {
    const file = new File(["test"], "audio.mp3", { type: "audio/mpeg" });
    startTusUpload(file, "https://example/uploads", {
      onProgress: () => {},
      onSuccess: () => {},
      onError: () => {},
    });
    expect(tusUploadMock).toHaveBeenCalledOnce();
    const [, options] = tusUploadMock.mock.calls[0]! as [unknown, Record<string, unknown>];
    expect(options.chunkSize).toBe(94_371_840);
    expect(options.retryDelays).toEqual([0, 1000, 3000, 5000, 10000]);
    expect(options.endpoint).toBe("https://example/uploads");
  });

  it("includes filename + content-type in metadata", () => {
    const file = new File(["x"], "weekly meeting.m4a", { type: "audio/mp4" });
    startTusUpload(file, "https://example/uploads", {
      onProgress: () => {},
      onSuccess: () => {},
      onError: () => {},
    });
    const [, options] = tusUploadMock.mock.calls[0]! as [unknown, Record<string, unknown>];
    const metadata = options.metadata as Record<string, string>;
    expect(metadata.filename).toBe("weekly meeting.m4a");
    expect(metadata["content-type"]).toBe("audio/mp4");
  });

  it("falls back to application/octet-stream when file.type is empty", () => {
    const file = new File(["x"], "weird.bin", { type: "" });
    startTusUpload(file, "https://example/uploads", {
      onProgress: () => {},
      onSuccess: () => {},
      onError: () => {},
    });
    const [, options] = tusUploadMock.mock.calls[0]! as [unknown, Record<string, unknown>];
    const metadata = options.metadata as Record<string, string>;
    expect(metadata["content-type"]).toBe("application/octet-stream");
  });

  it("merges extra metadata fields without clobbering filename/content-type", () => {
    const file = new File(["x"], "a.mp3", { type: "audio/mpeg" });
    startTusUpload(file, "https://example/uploads", {
      onProgress: () => {},
      onSuccess: () => {},
      onError: () => {},
    }, { job_id: "abc-123", preset: "fast" });
    const [, options] = tusUploadMock.mock.calls[0]! as [unknown, Record<string, unknown>];
    const metadata = options.metadata as Record<string, string>;
    expect(metadata.filename).toBe("a.mp3");
    expect(metadata.job_id).toBe("abc-123");
    expect(metadata.preset).toBe("fast");
  });
});
