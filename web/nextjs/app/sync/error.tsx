"use client";

import { ErrorBoundaryView } from "@/components/error-boundary-view";

export default function SyncError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorBoundaryView error={error} reset={reset} scope="Sync" />;
}
