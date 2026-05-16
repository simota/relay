"use client";

import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { ErrorBoundaryView } from "@/components/error-boundary-view";
import "./globals.css";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <ErrorBoundaryView error={error} reset={reset} scope="Global" />
      </body>
    </html>
  );
}
