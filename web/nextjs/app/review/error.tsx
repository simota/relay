"use client";

import { ErrorBoundaryView } from "@/components/error-boundary-view";

export default function ReviewError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorBoundaryView error={error} reset={reset} scope="Review" />;
}
