// frontend/app/page.tsx
// Phase 1 placeholder. Phase 3 replaces this with the upload UI.
import { env, hasBackendUrl } from "@/lib/env";

export default function HomePage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="max-w-xl space-y-4 text-center">
        <h1 className="text-4xl font-semibold tracking-tight">Transcribe</h1>
        <p className="text-base text-muted-foreground">
          Phase 1 alive — scaffolding only. Upload UI ships in Phase 3.
        </p>
        <p className="text-sm text-muted-foreground">
          Backend:{" "}
          <code className="rounded bg-muted px-2 py-1 text-xs">
            {hasBackendUrl ? env.NEXT_PUBLIC_BACKEND_URL : "not configured"}
          </code>
        </p>
      </div>
    </main>
  );
}
