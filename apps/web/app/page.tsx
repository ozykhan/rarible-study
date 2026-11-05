"use client"

import { useCallback, useEffect, useState } from "react"
import { Header } from "@/components/Header"
import { Hero } from "@/components/Hero"
import { HowItWorks } from "@/components/HowItWorks"
import { Market } from "@/components/Market"
import { NewRule } from "@/components/NewRule"
import { RuleView } from "@/components/RuleView"
import { Sets } from "@/components/Sets"
import { DevnetNotice, StatusBar } from "@/components/StatusBar"
import { WalletPanel } from "@/components/WalletPanel"
import { api, ApiError } from "@/lib/api"
import { money, short } from "@/lib/format"
import { useSession } from "@/lib/session"
import type { Funds, Listing, Rule, Status } from "@/lib/types"
import { useAction } from "@/lib/useAction"

/** The newest active listings, refreshed every 20 seconds. */
function useListings() {
  const [listings, setListings] = useState<ReadonlyArray<Listing> | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const load = () =>
      void api<{ listings: ReadonlyArray<Listing> }>("/listings")
        .then((r) => {
          setListings(r.listings)
          setFailed(false)
        })
        .catch(() => setFailed(true))
    load()
    const t = setInterval(load, 20_000)
    return () => clearInterval(t)
  }, [])
  return { listings, failed }
}

export default function Home() {
  const { wallet, token, signIn, signOut, signText } = useSession()
  const [status, setStatus] = useState<Status | null>(null)
  const [statusLoaded, setStatusLoaded] = useState(false)
  const [rules, setRules] = useState<ReadonlyArray<Rule>>([])
  const [funds, setFunds] = useState<Funds | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [set, setSet] = useState("all")
  const { listings, failed } = useListings()
  const { busy, error, run } = useAction()

  useEffect(() => {
    void api<Status>("/status")
      .then(setStatus)
      .catch(() => setStatus(null))
      .finally(() => setStatusLoaded(true))
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

  const browse = (setId?: string) => {
    if (setId !== undefined) setSet(setId)
    document.getElementById("market")?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  return (
    <>
      <Header signedIn={token !== null} />
      <DevnetNotice />
      <main id="top">
        {!token && (
          <Hero
            wallet={wallet}
            signingIn={busy === "signin"}
            onSignIn={() => void run("signin", signIn)}
            error={error}
            query={query}
            onQuery={setQuery}
            onBrowse={() => browse()}
          />
        )}

        {statusLoaded && status === null && (
          <p className="callout error">The backend is not reachable right now. Listings and sign-in will come back with it.</p>
        )}

        {token && status && (
          <section className="section desk" id="desk">
            <div className="section-head">
              <div>
                <p className="eyebrow">Signed in as {wallet ? short(wallet, 4) : "…"}</p>
                <h2>Your watch rules</h2>
              </div>
            </div>
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
                <section className="panel">
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
                  <RuleView
                    key={selected}
                    token={token}
                    ruleId={selected}
                    status={status}
                    signText={signText}
                    onChange={refresh}
                  />
                ) : (
                  <section className="panel empty-rule">
                    <h2>No rule yet</h2>
                    <p className="muted">
                      Describe a card in <strong>New watch rule</strong>. Its matches, purchases and agent runs show up here.
                    </p>
                  </section>
                )}
              </div>
            </div>
          </section>
        )}

        <Sets listings={listings} active={set} onPick={(id) => browse(id)} />
        <Market listings={listings} failed={failed} query={query} onQuery={setQuery} set={set} onSet={setSet} />
        {!token && <HowItWorks />}
      </main>
      <StatusBar status={status} loaded={statusLoaded} />
    </>
  )
}
