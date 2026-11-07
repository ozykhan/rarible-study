"use client"

import { useWalletModal } from "@solana/wallet-adapter-react-ui"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { AgentLimits } from "@/components/AgentLimits"
import { ManageWatches } from "@/components/ManageWatches"
import { RuleList } from "@/components/RuleList"
import { RuleBody, RuleChat, RuleHead, useRule } from "@/components/RuleView"
import { AgentIcon, Button, Panel, Pill } from "@/components/ui"
import { WalletPanel } from "@/components/WalletPanel"
import { useAccount } from "@/lib/account"
import type { Rule } from "@/lib/types"
import { useAction } from "@/lib/useAction"

/**
 * The optional agent, on its own page. The top row holds the watches
 * (RuleList) beside the selected watch (RuleHead), the same height: the
 * watch is as tall as its text and the list scrolls inside that height.
 * Under them, the rail (AgentLimits, then WalletPanel with Sign out) beside
 * what the watch found, skipped and bought (RuleBody). Talk to the agent
 * (RuleChat) starts as a button at the bottom right; it opens a popup that
 * stays over the page and shrinks back to the button. Manage your watches
 * opens ManageWatches, which holds the form for a new watch; a tile's Watch
 * landing here with ?watch=<want> opens it with the want filled in. Under
 * 900px everything stacks: watches, watch, found, then the rail. Signed out,
 * the page offers the sign-in. Styles: styles/desk.css.
 */
export function AgentDesk() {
  const { wallet, token, signIn, signOut, signText, status, statusLoaded, rules, funds, refresh } = useAccount()
  const [selected, setSelected] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  // Manage your watches is open, with the want to fill in its new watch form, if any.
  const [managing, setManaging] = useState<{ seed: string | null } | null>(null)
  // The chat starts as its button, so it does not cover the watch; you open it when you want it.
  const [chatOpen, setChatOpen] = useState(false)
  const { busy, error, run } = useAction()
  const { setVisible } = useWalletModal()
  const want = useSearchParams().get("watch")
  const seeded = useRef<string | null>(null)
  const rule = useRule({ token: token ?? "", ruleId: token !== null ? selected : null, signText, onChange: () => void refresh() })
  const current = rules.find((r) => r.id === selected) ?? null

  useEffect(() => {
    setSelected((s) => (s !== null && rules.some((r) => r.id === s) ? s : (rules[0]?.id ?? null)))
  }, [rules])
  useEffect(() => {
    if (token === null) {
      setSelected(null)
      setManaging(null)
    }
  }, [token])

  // A want from a tile opens the new watch form, filled in, once the wallet is signed in.
  useEffect(() => {
    if (want === null || token === null || seeded.current === want) return
    seeded.current = want
    setManaging({ seed: want })
  }, [want, token])

  const select = (id: string) => {
    setNote(null)
    setSelected(id)
  }

  const created = (r: Rule, text: string) => {
    setManaging(null)
    setSelected(r.id)
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
            <RuleList rules={rules} selected={selected} onSelect={select} onManage={() => setManaging({ seed: null })} />
          </div>

          <div className="agent-watch">
            {current ? (
              <RuleHead key={current.id} state={rule} />
            ) : (
              <Panel className="empty-rule" title="No watch yet">
                <p className="muted">
                  Describe a card and the agent checks every new listing for it. What it finds, what it skips and why, and what
                  you buy show up here.
                </p>
                <div className="row">
                  <Button onClick={() => setManaging({ seed: null })}>New watch</Button>
                </div>
              </Panel>
            )}
          </div>

          <div className="agent-rail">
            <AgentLimits status={status} rules={rules} />
            <WalletPanel token={token} status={status} funds={funds} onChange={() => void refresh()} onSignOut={signOut} />
          </div>

          <div className="agent-center">
            {note && <p className="note">{note}</p>}
            {current && <RuleBody key={current.id} state={rule} status={status} />}
          </div>
        </div>
      )}

      {token && status && current && (
        <>
          {chatOpen ? (
            <aside className="chat-popup" aria-labelledby="chat-title">
              <RuleChat key={current.id} detail={rule.detail} status={status} chat={rule.chat} onMinimize={() => setChatOpen(false)} />
            </aside>
          ) : (
            <button type="button" className="chat-launcher" aria-expanded="false" onClick={() => setChatOpen(true)}>
              <AgentIcon />
              Talk to the agent
            </button>
          )}
        </>
      )}

      {token && managing && (
        <ManageWatches
          token={token}
          rules={rules}
          seed={managing.seed}
          onCreated={created}
          onChanged={() => void refresh()}
          onClose={() => setManaging(null)}
        />
      )}
    </main>
  )
}
