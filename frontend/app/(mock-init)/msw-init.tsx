// MSW worker bootstrap — Client Component (D-17, RESEARCH §Pattern 5).
//
// Activation: process.env.NODE_ENV === "development"
//          AND env.NEXT_PUBLIC_USE_MOCKS === "1"
//
// The check uses a dynamic import of @/lib/mock/browser so the production
// bundle does not include MSW or any handlers. Verify after build:
//   `pnpm build && grep -r "setupWorker" .next/server` should return 0.

"use client";

import * as React from "react";
import { env } from "@/lib/env";

interface MswInitProps {
  children: React.ReactNode;
}

export function MswInit({ children }: MswInitProps) {
  // Pre-initialize ready=true in non-mock environments so we don't gate render.
  const enabled =
    process.env.NODE_ENV === "development" && env.NEXT_PUBLIC_USE_MOCKS === "1";
  const [ready, setReady] = React.useState(!enabled);

  React.useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      // Dynamic import keeps msw out of the production chunk.
      const { worker } = await import("@/lib/mock/browser");
      await worker.start({
        // Let non-mocked requests (Vercel telemetry, fonts, real Supabase)
        // pass through. Without this, MSW logs warnings every request.
        onUnhandledRequest: "bypass",
      });
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  // Gate render until handlers are registered — without this, the editor
  // mounts and fires fetch BEFORE MSW intercepts. Half the requests slip
  // through to the real network. (RESEARCH §Pitfall line 682)
  if (!ready) return null;
  return <>{children}</>;
}
