// Test fixture re-exports — keeps tests/ files small and lets us swap
// fixtures without touching every test file.
export { SAMPLE_PAYLOAD as transcriptFixture } from "@/lib/mock/data";
export type { TranscriptPayload, Speaker, Segment, Word } from "@/lib/mock/data";
