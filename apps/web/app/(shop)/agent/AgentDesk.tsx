"use client"

import { useWalletModal } from "@solana/wallet-adapter-react-ui"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { AgentLimits } from "@/components/AgentLimits"
import { NewRule } from "@/components/NewRule"
import { RuleList } from "@/components/RuleList"
import { RuleChat, RuleView, useRule } from "@/components/RuleView"
import { Button, Panel, Pill } from "@/components/ui"
import { WalletPanel } from "@/components/WalletPanel"
import { useAccount } from "@/lib/account"
import { useAction } from "@/lib/useAction"

/**
 * The optional agent, on its own page, in three columns: the rail (the
 * watches, the wallet, what the agent may do), the selected watch with what
 * it found and what it skipped, and the chat column (the watch as a
 * conversation, and the form that changes it). The markup is in phone order
 * (watches, watch, chat, wallet, limits); desk.css places the wallet and the
 * limits in the rail on wider screens. New watch, or a tile's Watch
 * landing here with ?watch=<want>, puts the form for a new watch in the chat
 * column. Signed out, the page offers the sign-in. Styles: styles/desk.css.
 */
export function AgentDesk() {
  const { wallet, token, signIn, signOut, signText, status, statusLoaded, rules, funds, refresh } = useAccount()
  const [selected, setSelected] = useState<string | null>(null)
  // A new watch is being written: nothing is selected, and the chat column holds the empty form.
  const [creating, setCreating] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const { busy, error, run } = useAction()
  const { setVisible } = useWalletModal()
  const want = useSearchParams().get("watch")
  const [seed, setSeed] = useState<{ text: string; n: number } | null>(null)
  const seeded = useRef<string | null>(null)
  const rule = useRule({ token: token ?? "", ruleId: token !== null && !creating ? selected : null, signText, onChange: () => void refresh() })
  const current = rules.find((r) => r.id === selected) ?? null

  useEffect(() => {
    if (!creating) setSelected((s) => s ?? rules[0]?.id ?? null)
  }, [rules, creating])
  useEffect(() => {
    if (token === null) {
      setSelected(null)
      setCreating(false)
    }
  }, [token])

  // A want from a tile fills the new watch form once the wallet is signed in.
  useEffect(() => {
    if (want === null || token === null || seeded.current === want) return
    seeded.current = want
    setCreating(true)
    setSeed({ text: want, n: Date.now() })
  }, [want, token])

  const startNew = () => {
    setCreating(true)
    setNote(null)
    setSeed({ text: "", n: Date.now() })
  }

  // The form takes focus whenever a new watch starts, once the desk is on the page.
  const ready = token !== null && status !== null
  useEffect(() => {
    if (seed === null || !ready) return
    const box = document.getElementById("new-rule-want")
    box?.scrollIntoView({ behavior: "smooth", block: "center" })
    box?.focus({ preventScroll: true })
  }, [seed, ready])

  const select = (id: string) => {
    setCreating(false)
    setNote(null)
    setSelected(id)
  }

  const created = (id: string, text: string) => {
    setCreating(false)
    setSelected(id)
    setNote(text)
    void refresh()
  }

  return (
    <main id="top" className="section agent-page">
      {statusLoaded && status === null && (
        <p className="callout error">The backend is not reachable right now. Watches and sign-in will come back with it.</p>
      )}

      <header className="agent-head">
        <div>
          <h1>
            Agent <Pill>optional</Pill>
          </h1>
          <p className="agent-lede">
            Tell it the card you want and your top price. It checks every new listing with code first, and buys only what you
            sign for: each buy, or a budget you approve.
          </p>
        </div>
        <Link className="btn btn-sm btn-secondary" href="/market">
          Back to the market
        </Link>
      </header>

      {token === null && (
        <Panel className="empty-rule" title="Let the agent watch for a card">
          <p className="muted">
            Describe the card, the grade and your top price. You can buy anything on the market without it.
            {want !== null && " Sign in and the watch you picked is filled in for you."}
          </p>
          <div className="row agent-signin">
            {wallet === null ? (
              <Button size="lg" onClick={() => setVisible(true)}>
                Connect a devnet wallet
              </Button>
            ) : (
              <Button size="lg" onClick={() => void run("signin", signIn)} disabled={busy !== null}>
                {busy === "signin" ? "Waiting for the wallet…" : "Sign in with this wallet"}
              </Button>
            )}
          </div>
          {wallet !== null && <p className="muted small">Your wallet signs a one-time text that proves you own it. Signing it moves no funds.</p>}
          {error && <p className="error">{error}</p>}
        </Panel>
      )}

      {token && status && (
        <div id="desk" className="agent-desk">
          <div className="agent-list">
            <RuleList rules={rules} selected={creating ? null : selected} onSelect={select} onNew={startNew} onSignOut={signOut} />
          </div>

          <div className="agent-center">
            {note && <p className="note">{note}</p>}
            {!creating && current ? (
              <RuleView key={current.id} state={rule} status={status} />
            ) : (
              <Panel className="empty-rule" title={creating ? "A new watch" : "No watch yet"}>
                <p className="muted">
                  Describe a card under <strong>New watch</strong>. What it finds, what it skips and why, and what you buy show up
                  here.
                </p>
              </Panel>
            )}
          </div>

          <div className="agent-chat">
            {!creating && current ? (
              <>
                <RuleChat detail={rule.detail} status={status} />
                <NewRule
                  key={current.id}
                  token={token}
                  title="Change this watch"
                  seed={current.rawWant}
                  replaces={current}
                  onCreated={(r, text) => created(r.id, text)}
                />
              </>
            ) : (
              <NewRule
                key={seed?.n ?? 0}
                token={token}
                title="New watch"
                {...(seed ? { seed: seed.text } : {})}
                onCreated={(r, text) => created(r.id, text)}
              />
            )}
          </div>

          <div className="agent-wallet">
            <WalletPanel token={token} status={status} funds={funds} onChange={() => void refresh()} />
          </div>
          <div className="agent-limits">
            <AgentLimits status={status} rules={rules} />
          </div>
        </div>
      )}
    </main>
  )
}
