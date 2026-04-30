import { EditorClient } from "./editor-client";

/**
 * RSC shell — awaits async params per Next.js 16 dynamic routes.
 * The Client Component below owns all interactivity.
 * [Cited: RESEARCH §Pattern 2; node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/dynamic-routes.md]
 */
export default async function JobPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Validate UUID-ish before passing through (defense in depth — Phase 5 SAFE-04 enforces).
  const looksLikeUuid =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
      id,
    );
  if (!looksLikeUuid) {
    throw new Error(`Invalid job id: ${id}`);
  }
  return <EditorClient jobId={id} />;
}
