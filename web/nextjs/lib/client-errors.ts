type ClientErrorKind = "error" | "unhandledrejection";

interface ClientErrorPayload {
  kind: ClientErrorKind;
  message: string;
  stack?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  href: string;
  userAgent: string;
  timestamp: string;
}

let cleanup: (() => void) | null = null;

export function startClientErrorReporting(): () => void {
  if (typeof window === "undefined") return () => {};
  if (cleanup) return cleanup;

  const onError = (event: ErrorEvent) => {
    reportClientError({
      kind: "error",
      message: event.message || serializeReason(event.error),
      stack: event.error instanceof Error ? event.error.stack : undefined,
      filename: event.filename || undefined,
      lineno: event.lineno || undefined,
      colno: event.colno || undefined,
    });
  };

  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    reportClientError({
      kind: "unhandledrejection",
      message: serializeReason(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  };

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);

  cleanup = () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onUnhandledRejection);
    cleanup = null;
  };

  return cleanup;
}

function reportClientError(input: Omit<ClientErrorPayload, "href" | "userAgent" | "timestamp">) {
  const payload: ClientErrorPayload = {
    ...input,
    href: window.location.href,
    userAgent: window.navigator.userAgent,
    timestamp: new Date().toISOString(),
  };

  void fetch("/api/client-errors", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => {
    // Error reporting must never create a secondary user-visible failure.
  });
}

function serializeReason(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === "string") return reason;
  if (reason === null) return "null";
  if (reason === undefined) return "undefined";

  try {
    return JSON.stringify(reason);
  } catch {
    return String(reason);
  }
}
