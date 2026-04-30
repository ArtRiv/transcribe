// Unit tests for frontend/lib/history/mutations.ts (Plan 04-07 Task 2).
// Tests: renameTranscript, deleteTranscript Server Actions.
// Mocks: @/lib/supabase/server, next/cache.

import { describe, it, expect, vi, beforeEach } from "vitest";

// --- mocks ---
// vi.mock is hoisted — factories must be self-contained (no top-level variable refs).

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: vi.fn(),
}));

// Import after mocks are set up
import {
  renameTranscript,
  deleteTranscript,
} from "@/lib/history/mutations";
import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";

const mockRevalidatePath = vi.mocked(revalidatePath);
const mockGetSupabaseServerClient = vi.mocked(getSupabaseServerClient);

// Supabase query chain mocks (re-created per test via beforeEach)
const mockEq = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockFrom = vi.fn();

describe("renameTranscript", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Chain: from().update().eq()
    mockEq.mockResolvedValue({ error: null });
    mockUpdate.mockReturnValue({ eq: mockEq });
    mockFrom.mockReturnValue({ update: mockUpdate, delete: mockDelete });
    mockGetSupabaseServerClient.mockResolvedValue({ from: mockFrom } as never);
  });

  it("calls supabase update with title and updated_at, returns ok:true on success", async () => {
    const result = await renameTranscript("uuid-1", "New Title");
    expect(mockFrom).toHaveBeenCalledWith("transcripts");
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ title: "New Title" }),
    );
    expect(mockEq).toHaveBeenCalledWith("id", "uuid-1");
    expect(result).toEqual({ ok: true });
  });

  it("calls revalidatePath('/history') on success", async () => {
    await renameTranscript("uuid-1", "New Title");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/history");
  });

  it("returns ok:false with error message on Supabase error", async () => {
    mockEq.mockResolvedValue({ error: { message: "RLS violation" } });
    const result = await renameTranscript("uuid-1", "New Title");
    expect(result).toEqual({ ok: false, error: "RLS violation" });
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("returns ok:false when title is empty (validation guard)", async () => {
    const result = await renameTranscript("uuid-1", "   ");
    expect(result).toEqual({ ok: false, error: "Title required" });
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe("deleteTranscript", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Chain: from().delete().eq()
    mockEq.mockResolvedValue({ error: null });
    mockDelete.mockReturnValue({ eq: mockEq });
    mockFrom.mockReturnValue({ update: mockUpdate, delete: mockDelete });
    mockGetSupabaseServerClient.mockResolvedValue({ from: mockFrom } as never);
  });

  it("calls supabase delete with eq(id) and returns ok:true on success", async () => {
    const result = await deleteTranscript("uuid-2");
    expect(mockFrom).toHaveBeenCalledWith("transcripts");
    expect(mockDelete).toHaveBeenCalled();
    expect(mockEq).toHaveBeenCalledWith("id", "uuid-2");
    expect(result).toEqual({ ok: true });
  });

  it("calls revalidatePath('/history') on success", async () => {
    await deleteTranscript("uuid-2");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/history");
  });

  it("returns ok:false with error message on Supabase error", async () => {
    mockEq.mockResolvedValue({ error: { message: "Not found" } });
    const result = await deleteTranscript("uuid-2");
    expect(result).toEqual({ ok: false, error: "Not found" });
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });
});
