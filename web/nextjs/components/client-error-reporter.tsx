"use client";

import { useEffect } from "react";
import { startClientErrorReporting } from "@/lib/client-errors";

export function ClientErrorReporter() {
  useEffect(() => startClientErrorReporting(), []);
  return null;
}
