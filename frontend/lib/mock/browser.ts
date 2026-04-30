// MSW Service Worker bootstrap (D-17).
//
// Imported dynamically by app/(mock-init)/msw-init.tsx ONLY in dev when
// NEXT_PUBLIC_USE_MOCKS=1. The dynamic gate keeps msw out of the
// production bundle.

import { setupWorker } from "msw/browser";
import { handlers } from "./handlers";

export const worker = setupWorker(...handlers);
