// Unit tests for frontend/lib/history/mutations.ts.
// Mutations now operate on the `jobs` row (item 13 of "things to change 2.txt"),
// with a best-effort patch of the matching `transcripts` row when one exists.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: vi.fn(),
}));

import { renameTranscript, deleteTranscript } from "@/lib/history/mutations";
import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";

const mockRevalidatePath = vi.mocked(revalidatePath);
const mockGetSupabaseServerClient = vi.mocked(getSupabaseServerClient);

interface SelectChain {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
}
interface UpdateChain {
  update: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
}
interface DeleteChain {
  delete: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
}

function buildClient(opts: {
  jobRead?: { transcript_id: string | null; options: object | null } | null;
  jobReadError?: { message: string };
  jobUpdateError?: { message: string };
  jobDeleteError?: { message: string };
  transcriptUpdateError?: { message: string };
}) {
  const fromCalls: string[] = [];
  const calls: { update: object[]; eq: [string, string][] } = {
    update: [],
    eq: [],
  };

  // jobs.select(...).eq(...).maybeSingle()
  const jobSelectChain: SelectChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: opts.jobRead ?? null,
      error: opts.jobReadError ?? null,
    }),
  };
  // jobs.update(...).eq(...)
  const jobUpdateChain: UpdateChain = {
    update: vi.fn((p: object) => {
      calls.update.push(p);
      return jobUpdateChain;
    }),
    eq: vi.fn(async (...args: [string, string]) => {
      calls.eq.push(args);
      return { error: opts.jobUpdateError ?? null };
    }),
  };
  // jobs.delete().eq()
  const jobDeleteChain: DeleteChain = {
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({ error: opts.jobDeleteError ?? null }),
  };
  // transcripts.update().eq()
  const transcriptUpdateChain: UpdateChain = {
    update: vi.fn().mockReturnThis(),
    eq: vi
      .fn()
      .mockResolvedValue({ error: opts.transcriptUpdateError ?? null }),
  };

  let jobsFromCount = 0;
  const mockFrom = vi.fn((table: string) => {
    fromCalls.push(table);
    if (table === "jobs") {
      jobsFromCount += 1;
      // Order matters: rename does select-then-update; delete does delete.
      if (jobsFromCount === 1) return jobSelectChain;
      if (jobsFromCount === 2) return jobUpdateChain;
      return jobUpdateChain;
    }
    if (table === "transcripts") return transcriptUpdateChain;
    throw new Error(`unexpected from(${table})`);
  });

  // Override for delete-only test paths: jobs is hit once, with delete().
  // We detect "delete first call" by overriding from() lazily.
  const mockClient = { from: mockFrom };
  mockGetSupabaseServerClient.mockResolvedValue(mockClient as never);

  return {
    fromCalls,
    calls,
    mockFrom,
    jobSelectChain,
    jobUpdateChain,
    jobDeleteChain,
    transcriptUpdateChain,
  };
}

describe("renameTranscript", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns ok:false when title is empty", async () => {
    const result = await renameTranscript("uuid-1", "   ");
    expect(result).toEqual({ ok: false, error: "Title required" });
    expect(mockGetSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("patches jobs.options.title and revalidates on success (no transcripts row)", async () => {
    const harness = buildClient({
      jobRead: { transcript_id: null, options: { language: "en" } },
    });
    const result = await renameTranscript("job-1", "New Title");
    expect(result).toEqual({ ok: true });
    expect(harness.fromCalls).toEqual(["jobs", "jobs"]);
    expect(harness.calls.update[0]).toMatchObject({
      options: { language: "en", title: "New Title" },
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/history");
  });

  it("also updates the transcripts row when one is linked", async () => {
    const harness = buildClient({
      jobRead: { transcript_id: "tr-1", options: {} },
    });
    const result = await renameTranscript("job-1", "Renamed");
    expect(result).toEqual({ ok: true });
    expect(harness.fromCalls).toContain("transcripts");
  });

  it("returns ok:false on jobs read error", async () => {
    buildClient({ jobReadError: { message: "RLS violation" } });
    const result = await renameTranscript("job-1", "New");
    expect(result).toEqual({ ok: false, error: "RLS violation" });
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });
});

describe("deleteTranscript", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes the jobs row and revalidates on success", async () => {
    const deleteChain = {
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null }),
    };
    const mockFrom = vi.fn().mockReturnValue(deleteChain);
    mockGetSupabaseServerClient.mockResolvedValue({
      from: mockFrom,
    } as never);

    const result = await deleteTranscript("job-2");
    expect(mockFrom).toHaveBeenCalledWith("jobs");
    expect(deleteChain.delete).toHaveBeenCalled();
    expect(deleteChain.eq).toHaveBeenCalledWith("id", "job-2");
    expect(result).toEqual({ ok: true });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/history");
  });

  it("returns ok:false on Supabase error", async () => {
    const deleteChain = {
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: { message: "Not found" } }),
    };
    const mockFrom = vi.fn().mockReturnValue(deleteChain);
    mockGetSupabaseServerClient.mockResolvedValue({
      from: mockFrom,
    } as never);

    const result = await deleteTranscript("job-2");
    expect(result).toEqual({ ok: false, error: "Not found" });
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });
});
