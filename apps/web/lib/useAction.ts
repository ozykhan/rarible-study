"use client"

import { useCallback, useState } from "react"

/** Runs one async step at a time and keeps its error as text for the page. */
export function useAction() {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const run = useCallback(async <T,>(label: string, f: () => Promise<T>): Promise<T | undefined> => {
    setBusy(label)
    setError(null)
    try {
      return await f()
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      // A wallet's own "user rejected" error is not worth alarming anyone over.
      setError(/reject|cancel|denied/i.test(message) ? "Cancelled in the wallet." : message)
      return undefined
    } finally {
      setBusy(null)
    }
  }, [])
  const clearError = useCallback(() => setError(null), [])
  return { busy, error, run, clearError }
}
