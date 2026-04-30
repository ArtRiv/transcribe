import { describe, it, expect } from "vitest";
import { decideUploadPath, SMALL_PATH_LIMIT } from "@/lib/job/submit";
import { newJobId } from "@/lib/job/id";

describe("SMALL_PATH_LIMIT", () => {
  it("equals 90 MB exactly (matches backend/app/routes/jobs.py line 32)", () => {
    expect(SMALL_PATH_LIMIT).toBe(90 * 1024 * 1024);
    expect(SMALL_PATH_LIMIT).toBe(94_371_840);
  });
});

describe("decideUploadPath (CORE-04 routing)", () => {
  it("returns 'multipart' for files just under 90 MB", () => {
    expect(decideUploadPath({ size: SMALL_PATH_LIMIT - 1 })).toBe("multipart");
  });

  it("returns 'tus' for files at exactly 90 MB", () => {
    expect(decideUploadPath({ size: SMALL_PATH_LIMIT })).toBe("tus");
  });

  it("returns 'tus' for files over 90 MB", () => {
    expect(decideUploadPath({ size: SMALL_PATH_LIMIT + 1 })).toBe("tus");
    expect(decideUploadPath({ size: 200 * 1024 * 1024 })).toBe("tus");
  });

  it("returns 'multipart' for tiny files", () => {
    expect(decideUploadPath({ size: 1 })).toBe("multipart");
    expect(decideUploadPath({ size: 0 })).toBe("multipart");
  });
});

describe("newJobId", () => {
  it("returns a 36-char string with hyphens at canonical positions", () => {
    const id = newJobId();
    expect(id).toHaveLength(36);
    expect(id[8]).toBe("-");
    expect(id[13]).toBe("-");
    expect(id[18]).toBe("-");
    expect(id[23]).toBe("-");
  });

  it("returns a UUID v7 (15th hex char === '7')", () => {
    // Per RFC 9562, the version nibble lives at the 15th char (index 14):
    // xxxxxxxx-xxxx-Mxxx-Nxxx-xxxxxxxxxxxx where M=version
    const id = newJobId();
    expect(id[14]).toBe("7");
  });

  it("is monotonically time-ordered (D-13)", () => {
    const a = newJobId();
    const b = newJobId();
    // v7 prefixes with 48-bit unix-ms; same ms => same prefix; later ms => greater prefix.
    // Sequential calls in the same tick are NOT guaranteed strictly increasing
    // (RFC 9562 leaves the random tail), but the prefix-12 chars are non-decreasing.
    expect(a.slice(0, 12) <= b.slice(0, 12)).toBe(true);
  });
});
