"use client"

import dynamic from "next/dynamic"
import { useCallback, useEffect, useState } from "react"
import { Market } from "@/components/Market"
import { NewRule } from "@/components/NewRule"
import { RuleView } from "@/components/RuleView"
import { StatusBar } from "@/components/StatusBar"
import { WalletPanel } from "@/components/WalletPanel"
import { api, ApiError } from "@/lib/api"
import { money } from "@/lib/format"
import { useSession } from "@/lib/session"
import type { Funds, Rule, Status } from "@/lib/types"
import { useAction } from "@/lib/useAction"

/** The wallet button depends on what the browser has installed, so it renders on the client only. */
const WalletMultiButton = dynamic(() => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton), {
  ssr: false
})

export default function Home() {
  const { wallet, token, signIn, signOut, signText } = useSession()
  const [status, setStatus] = useState<Status | null>(null)
  const [rules, setRules] = useState<ReadonlyArray<Rule>>([])
  const [funds, setFunds] = useState<Funds | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const { busy, error, run } = useAction()

  useEffect(() => {
    void api<Status>("/status").then(setStatus).catch(() => setStatus(null))
  }, [])

  const refresh = useCallback(async () => {
    if (!token) return
    try {
      const me = await api<{ wallet: string; funds: Funds | null; rules: ReadonlyArray<Rule> }>("/me", { token })
      setRules(me.rules)
      setFunds(me.funds)
      setSelected((s) => s ?? me.rules[0]?.id ?? null)
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) signOut()
    }
  }, [token, signOut])

  useEffect(() => {
    setRules([])
    setFunds(null)
    setSelected(null)
    void refresh()
  }, [refresh])

  return (
    <main>
      <header className="top">
        <div>
          <h1>Slabwatch</h1>
          <p className="muted">Tell it the graded card you want. It watches new listings, and buys only what you approved.</p>
        </div>
        <div className="row">
          <span className="pill warn">devnet</span>
          <WalletMultiButton />
        </div>
      </header>

      <StatusBar status={status} />

      {status === null && <p className="error">The backend is not reachable right now.</p>}

      {wallet && !token && (
        <section className="card">
          <h2>Sign in</h2>
          <p className="muted">
            Your wallet signs a one-time text that proves you own it. Signing it moves no funds.
          </p>
          <button onClick={() => run("signin", signIn)} disabled={busy !== null}>
            {busy === "signin" ? "Waiting for the wallet…" : "Sign in with this wallet"}
          </button>
          {error && <p className="error">{error}</p>}
        </section>
      )}

      {!wallet && (
        <section className="card">
          <h2>How it works</h2>
          <ol className="steps">
            <li>Connect a Solana wallet set to devnet and sign in.</li>
            <li>Get test dUSD from the faucet and approve an allowance for Slabwatch.</li>
            <li>Describe what you want. A model turns it into a rule; you check it and set a budget.</li>
            <li>
              Matches pass code checks first (fields, red flags), then a model reads the seller text. You sign each purchase, or
              sign one budget approval and let the agent buy within it.
            </li>
          </ol>
        </section>
      )}

      {token && status && (
        <div className="layout">
          <div className="side">
            <WalletPanel token={token} status={status} funds={funds} onChange={refresh} />
            <NewRule
              token={token}
              onCreated={(rule, text) => {
                setSelected(rule.id)
                setNote(text)
                void refresh()
              }}
            />
            <section className="card">
              <h2>Your rules</h2>
              {rules.length === 0 && <p className="muted small">No rules yet.</p>}
              <ul className="rule-list">
                {rules.map((r) => (
                  <li key={r.id}>
                    <button className={`rule-item ${selected === r.id ? "active" : ""}`} onClick={() => setSelected(r.id)}>
                      <span>{r.rawWant}</span>
                      <span className="muted small">
                        {r.status} · {r.mode === "auto" ? "auto-buy" : "confirm"} · budget {money(r.budget)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <button className="link small" onClick={signOut}>
                Sign out
              </button>
            </section>
          </div>
          <div className="main">
            {note && <p className="note">{note}</p>}
            {selected ? (
              <RuleView key={selected} token={token} ruleId={selected} status={status} signText={signText} onChange={refresh} />
            ) : (
              <Market />
            )}
          </div>
        </div>
      )}

      {!token && status && <Market />}

      <footer className="muted small">
        A study project. Solana devnet only; everything on this page is fictional and the tokens have no value.
      </footer>
    </main>
  )
}
