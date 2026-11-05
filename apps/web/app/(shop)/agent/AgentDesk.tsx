"use client"

import { useWalletModal } from "@solana/wallet-adapter-react-ui"
import { useSearchParams } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { NewRule } from "@/components/NewRule"
import { RuleList } from "@/components/RuleList"
import { RuleView } from "@/components/RuleView"
import { Button, Panel, Section } from "@/components/ui"
import { WalletPanel } from "@/components/WalletPanel"
import { useAccount } from "@/lib/account"
import { short } from "@/lib/format"
import { useAction } from "@/lib/useAction"

/**
 * The optional agent, on its own page: the wallet, a New watch form, the
 * watches, and the selected watch in full. A tile's Watch lands here with
 * ?watch=<want> and fills the form; signed out, the form waits for the
 * sign-in. Styles: styles/desk.css.
 */
export function AgentDesk() {
  const { wallet, token, signIn, signOut, signText, status, statusLoaded, rules, funds, refresh } = useAccount()
  const [selected, setSelected] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const { busy, error, run } = useAction()
  const { setVisible } = useWalletModal()
  const want = useSearchParams().get("watch")
  const [seed, setSeed] = useState<{ text: string; n: number } | null>(null)
  const seeded = useRef<string | null>(null)

  useEffect(() => setSelected((s) => s ?? rules[0]?.id ?? null), [rules])
  useEffect(() => {
    if (token === null) setSelected(null)
  }, [token])

  // A want from a tile fills the form once the wallet is signed in.
  useEffect(() => {
    if (want === null || token === null || seeded.current === want) return
    seeded.current = want
    setSeed({ text: want, n: Date.now() })
  }, [want, token])

  useEffect(() => {
    if (seed === null) return
    const box = document.getElementById("new-rule-want")
    box?.scrollIntoView({ behavior: "smooth", block: "center" })
    box?.focus({ preventScroll: true })
  }, [seed])

  return (
    <main id="top">
      {statusLoaded && status === null && (
        <p className="callout error">The backend is not reachable right now. Watches and sign-in will come back with it.</p>
      )}

      {token === null && (
        <Section eyebrow="Optional" title="The agent">
          <Panel className="empty-rule" title="Let the agent watch for a card">
            <p className="muted">
              Describe the card, the grade and your top price. The agent checks every new listing with code first and buys only
              what you sign for: each buy, or a budget you approve.
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
        </Section>
      )}

      {token && status && (
        <Section id="desk" className="desk" eyebrow={`Signed in as ${wallet ? short(wallet, 4) : "…"}`} title="Your watch rules">
          <div className="layout">
            <div className="side">
              <WalletPanel token={token} status={status} funds={funds} onChange={() => void refresh()} />
              <NewRule
                key={seed?.n ?? 0}
                token={token}
                {...(seed ? { seed: seed.text } : {})}
                onCreated={(rule, text) => {
                  setSelected(rule.id)
                  setNote(text)
                  void refresh()
                }}
              />
              <RuleList rules={rules} selected={selected} onSelect={setSelected} onSignOut={signOut} />
            </div>
            <div className="main">
              {note && <p className="note">{note}</p>}
              {selected ? (
                <RuleView
                  key={selected}
                  token={token}
                  ruleId={selected}
                  status={status}
                  signText={signText}
                  onChange={() => void refresh()}
                />
              ) : (
                <Panel className="empty-rule" title="No rule yet">
                  <p className="muted">
                    Describe a card in <strong>New watch rule</strong>. Its matches, purchases and agent runs show up here.
                  </p>
                </Panel>
              )}
            </div>
          </div>
        </Section>
      )}
    </main>
  )
}
