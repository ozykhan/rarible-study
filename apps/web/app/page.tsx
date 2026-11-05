"use client"

import { useWalletModal } from "@solana/wallet-adapter-react-ui"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Checkout } from "@/components/Checkout"
import { DevnetNotice } from "@/components/DevnetNotice"
import { Header } from "@/components/Header"
import { Hero } from "@/components/Hero"
import { HowItWorks } from "@/components/HowItWorks"
import { Market } from "@/components/Market"
import { NewRule } from "@/components/NewRule"
import { RuleList } from "@/components/RuleList"
import { RuleView } from "@/components/RuleView"
import { Sets } from "@/components/Sets"
import { StatusBar } from "@/components/StatusBar"
import { Panel, Section } from "@/components/ui"
import { WalletPanel } from "@/components/WalletPanel"
import { api, ApiError } from "@/lib/api"
import { short, watchWant } from "@/lib/format"
import { useSession } from "@/lib/session"
import type { Funds, Listing, MyPurchase, Rule, Status } from "@/lib/types"
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
  const { setVisible } = useWalletModal()
  // A tile's Watch seeds the New watch form; signed out, it waits for the sign-in.
  const [seed, setSeed] = useState<{ text: string; n: number } | null>(null)
  const pendingWatch = useRef<string | null>(null)
  // Buy now opens the checkout. A bought listing leaves /listings, so the grid keeps it for the visit as "In your wallet".
  const [buying, setBuying] = useState<Listing | null>(null)
  const [purchases, setPurchases] = useState<ReadonlyArray<MyPurchase>>([])
  const [bought, setBought] = useState<ReadonlyArray<Listing>>([])

  useEffect(() => {
    void api<Status>("/status")
      .then(setStatus)
      .catch(() => setStatus(null))
      .finally(() => setStatusLoaded(true))
  }, [])

  const refresh = useCallback(async () => {
    if (!token) return
    try {
      const [me, mine] = await Promise.all([
        api<{ wallet: string; funds: Funds | null; rules: ReadonlyArray<Rule> }>("/me", { token }),
        api<{ purchases: ReadonlyArray<MyPurchase> }>("/me/purchases", { token })
      ])
      setRules(me.rules)
      setFunds(me.funds)
      setPurchases(mine.purchases)
      setSelected((s) => s ?? me.rules[0]?.id ?? null)
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) signOut()
    }
  }, [token, signOut])

  useEffect(() => {
    setRules([])
    setFunds(null)
    setPurchases([])
    setBought([])
    setSelected(null)
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (token === null || pendingWatch.current === null) return
    setSeed({ text: pendingWatch.current, n: Date.now() })
    pendingWatch.current = null
  }, [token])

  useEffect(() => {
    if (seed === null) return
    const box = document.getElementById("new-rule-want")
    box?.scrollIntoView({ behavior: "smooth", block: "center" })
    box?.focus({ preventScroll: true })
  }, [seed])

  const watching = useMemo(
    () => new Set(rules.filter((r) => r.status === "active" && r.hard.cardId !== null).map((r) => r.hard.cardId as string)),
    [rules]
  )

  const owned = useMemo(
    () => new Set([...purchases.filter((p) => p.status === "executed").map((p) => p.listingId), ...bought.map((l) => l.listingId)]),
    [purchases, bought]
  )

  /** The market list, plus what was bought on this visit, newest first like the server sends them. */
  const shown = useMemo(() => {
    if (listings === null) return null
    const ids = new Set(listings.map((l) => l.listingId))
    const kept = bought.filter((l) => !ids.has(l.listingId))
    return kept.length === 0 ? listings : [...listings, ...kept].sort((a, b) => b.listedAt.localeCompare(a.listedAt))
  }, [listings, bought])

  const watch = (l: Listing) => {
    const text = watchWant(l)
    if (token !== null) return setSeed({ text, n: Date.now() })
    pendingWatch.current = text
    if (wallet === null) setVisible(true)
    else void run("signin", signIn)
  }

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
          <Section id="desk" className="desk" eyebrow={`Signed in as ${wallet ? short(wallet, 4) : "…"}`} title="Your watch rules">
            <div className="layout">
              <div className="side">
                <WalletPanel token={token} status={status} funds={funds} onChange={refresh} />
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
                    onChange={refresh}
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

        <Sets listings={listings} active={set} onPick={(id) => browse(id)} />
        <Market
          listings={shown}
          failed={failed}
          query={query}
          onQuery={setQuery}
          set={set}
          onSet={setSet}
          watching={watching}
          owned={owned}
          onBuy={setBuying}
          onWatch={watch}
        />
        {!token && <HowItWorks />}
      </main>
      <StatusBar status={status} loaded={statusLoaded} />
      {buying && (
        <Checkout
          listing={buying}
          status={status}
          wallet={wallet}
          token={token}
          funds={funds}
          onConnect={() => setVisible(true)}
          signIn={signIn}
          signText={signText}
          onFunds={refresh}
          onBought={(l) => setBought((b) => [...b, l])}
          onClose={() => setBuying(null)}
        />
      )}
    </>
  )
}
