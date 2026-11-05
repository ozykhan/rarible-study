"use client"

import { useWallet } from "@solana/wallet-adapter-react"
import { useCallback, useEffect, useState } from "react"
import { api } from "./api"
import { toBase64 } from "./format"
import type { SigningRequest } from "./types"

const key = (wallet: string) => `slabwatch:session:${wallet}`

const read = (wallet: string) => {
  try {
    const raw = sessionStorage.getItem(key(wallet))
    if (raw === null) return null
    const s = JSON.parse(raw) as { token: string; expiresAt: string }
    return new Date(s.expiresAt) > new Date() ? s.token : null
  } catch {
    return null
  }
}

/**
 * A session is a bearer token the server issues after the wallet signs a
 * one-time sign-in text. It lives in this tab only and expires after 12 hours.
 */
export function useSession() {
  const { publicKey, signMessage } = useWallet()
  const wallet = publicKey?.toBase58() ?? null
  const [token, setToken] = useState<string | null>(null)

  useEffect(() => setToken(wallet === null ? null : read(wallet)), [wallet])

  const signText = useCallback(
    async (message: string) => {
      if (!signMessage) throw new Error("this wallet cannot sign messages")
      return toBase64(await signMessage(new TextEncoder().encode(message)))
    },
    [signMessage]
  )

  const signIn = useCallback(async () => {
    if (wallet === null) return
    const req = await api<SigningRequest>("/auth/start", { body: { wallet } })
    const signature = await signText(req.message)
    const s = await api<{ token: string; expiresAt: string }>("/auth/finish", { body: { nonce: req.nonce, signature } })
    try {
      sessionStorage.setItem(key(wallet), JSON.stringify(s))
    } catch {
      // Private mode: the session simply does not survive a reload.
    }
    setToken(s.token)
  }, [wallet, signText])

  const signOut = useCallback(() => {
    if (wallet !== null) {
      try {
        sessionStorage.removeItem(key(wallet))
      } catch {}
    }
    setToken(null)
  }, [wallet])

  return { wallet, token, signIn, signOut, signText }
}
