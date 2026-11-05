"use client"

import { useWalletModal } from "@solana/wallet-adapter-react-ui"
import Link from "next/link"
import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import { useAccount } from "@/lib/account"
import { useAction } from "@/lib/useAction"
import { NewRule } from "./NewRule"
import { Button, CloseIcon, Pill } from "./ui"

/**
 * The optional agent beside the market: New watch rule in a panel at the
 * right edge, with a link to the full agent page. Watch on a tile opens it
 * with that card's want filled in. It is not modal: the market stays usable
 * behind it, and Buy now opens the checkout over it. Signed out, it offers
 * connect and sign in first. Styles: styles/agent-drawer.css.
 */
export function AgentDrawer({ seed, onClose }: { seed: string | null; onClose: () => void }) {
  const { wallet, token, signIn, refresh } = useAccount()
  const { setVisible } = useWalletModal()
  const { busy, error, run } = useAction()
  const [saved, setSaved] = useState<string | null>(null)
  const box = useRef<HTMLElement>(null)
  const full = seed === null ? "/agent" : `/agent?watch=${encodeURIComponent(seed)}`

  // Focus goes back to where it was when the drawer closes.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    return () => before?.focus?.({ preventScroll: true })
  }, [])

  // Focus moves into the drawer: to the want once signed in, otherwise to the sign-in button.
  useEffect(() => {
    const want = box.current?.querySelector<HTMLElement>("#new-rule-want")
    ;(want ?? box.current?.querySelector<HTMLElement>(".agent-drawer-body .btn") ?? box.current)?.focus({ preventScroll: true })
  }, [token])

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation()
      onClose()
    }
  }

  return (
    <aside className="agent-drawer" aria-label="Agent" ref={box} tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="agent-drawer-head">
        <h2>Agent</h2>
        <Pill>optional</Pill>
        <Link className="agent-drawer-full" href={full}>
          Open full screen
        </Link>
        <button type="button" className="btn-close" aria-label="Close the agent" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>
      <div className="agent-drawer-body">
        <p className="muted small">
          Describe the card, the grade and your top price. The agent checks every new listing with code first, and buys only what
          you sign for: each buy, or a budget you approve.
        </p>
        {token === null && (
          <div className="agent-drawer-signin">
            {wallet === null ? (
              <Button size="lg" onClick={() => setVisible(true)}>
                Connect a devnet wallet
              </Button>
            ) : (
              <Button size="lg" onClick={() => void run("signin", signIn)} disabled={busy !== null}>
                {busy === "signin" ? "Waiting for the wallet…" : "Sign in with this wallet"}
              </Button>
            )}
            <p className="muted small">
              {wallet === null
                ? "A watch belongs to a wallet, so the agent needs one first."
                : "Your wallet signs a one-time text that proves you own it. Signing it moves no funds."}
              {seed !== null && " The card you picked is filled in once you are signed in."}
            </p>
            {error && <p className="error">{error}</p>}
          </div>
        )}
        {token !== null && saved !== null && (
          <>
            <p className="note">{saved}</p>
            <div className="row">
              <Link className="btn btn-sm btn-primary" href="/agent">
                See it on the agent page
              </Link>
              <Button variant="secondary" onClick={() => setSaved(null)}>
                Watch another card
              </Button>
            </div>
          </>
        )}
        {token !== null && saved === null && (
          <NewRule
            token={token}
            {...(seed !== null ? { seed } : {})}
            onCreated={(_rule, text) => {
              setSaved(text)
              void refresh()
            }}
          />
        )}
      </div>
    </aside>
  )
}
