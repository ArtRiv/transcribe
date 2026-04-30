// UUID v7 generator for client-side job_id (D-13).
//
// crypto.randomUUID() only emits v4 (random, not time-ordered).
// Postgres B-tree index performance on v4 PKs is ~30% worse than v7 because
// each random UUID lands in a random index page. v7 has a 48-bit
// Unix-millisecond prefix so new rows append to recent pages.
//
// The same client-generated UUID flows through Phase 4's POST /jobs body and
// is used as the row's primary key (replacing gen_random_uuid() in the
// migration). Phase 3 mock mode uses it for the Realtime stub's job-row events.
//
// [Cited: RESEARCH §Pattern 10; supabase.com/blog/choosing-a-postgres-primary-key]

import { v7 as uuidv7 } from "uuid";

/** Generate a UUID v7 for a new job. */
export function newJobId(): string {
  return uuidv7();
}
