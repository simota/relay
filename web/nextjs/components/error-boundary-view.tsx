"use client";

import { ArrowLeft, RefreshCcw, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ErrorBoundaryViewProps {
  error: Error & { digest?: string };
  reset: () => void;
  scope?: string;
}

export function ErrorBoundaryView({ error, reset, scope }: ErrorBoundaryViewProps) {
  const correlationId = error.digest ?? "unavailable";

  return (
    <div className="flex h-full min-h-[360px] items-center justify-center bg-[var(--color-bg)] p-6">
      <section
        role="alert"
        aria-labelledby="error-boundary-title"
        className="w-full max-w-[520px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-5 shadow-[var(--shadow-elev)]"
      >
        <div className="mb-4">
          {scope ? (
            <p className="mb-1 text-[12px] uppercase tracking-[0.08em] text-[var(--color-fg-dim)]">
              {scope}
            </p>
          ) : null}
          <h1 id="error-boundary-title" className="text-[18px] font-semibold text-[var(--color-fg)]">
            Something went wrong
          </h1>
          <p className="mt-2 text-[13px] text-[var(--color-fg-muted)]">
            Correlation id:{" "}
            <span className="font-mono text-[var(--color-fg)]">{correlationId}</span>
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={reset}>
            <RefreshCcw className="h-3.5 w-3.5" />
            Retry
          </Button>
          <Button type="button" variant="ghost" onClick={() => window.history.back()}>
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </Button>
          <Button type="button" variant="ghost" onClick={() => window.location.assign("/sync")}>
            <Terminal className="h-3.5 w-3.5" />
            Sync Console
          </Button>
        </div>
      </section>
    </div>
  );
}
