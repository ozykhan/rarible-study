"use client"

import { useWalletModal } from "@solana/wallet-adapter-react-ui"
import { useRouter } from "next/navigation"
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { Checkout } from "@/components/Checkout"
import { api, ApiError } from "./api"
import { watchWant } from "./format"
import { useSession } from "./session"
import type { Funds, Listing, MarketStats, MyPurchase, Rule, Status } from "./types"

interface Account {
  /** The connected wallet, and the session token once it signed in. */
  readonly wallet: string | null
  readonly token: string | null
  readonly signIn: () => Promise<void>
  readonly signOut: () => void
  readonly signText: (message: string) => Promise<string>
  /** The backend's /status; null when it is not reachable. */
  readonly status: Status | null
  readonly statusLoaded: boolean
  /** The 40 newest listings, plus what was bought on this visit; null while loading. */
  readonly listings: ReadonlyArray<Listing> | null
  readonly listingsFailed: boolean
  /** Counts and floors for every active listing. */
  readonly stats: MarketStats | null
  readonly rules: ReadonlyArray<Rule>
  readonly funds: Funds | null
  /** Listing ids this wallet bought, and card ids an active watch targets. */
  readonly owned: ReadonlySet<string>
  readonly watching: ReadonlySet<string>
  /** Reloads the wallet's rules, funds and purchases. */
  readonly refresh: () => Promise<void>
  /** Opens the checkout for a listing. */
  readonly buy: (l: Listing) => void
  /** Opens the agent page with a New watch drafted from this listing. */
  readonly watch: (l: Listing) => void
}

const AccountContext = createContext<Account | null>(null)

export function useAccount() {
  const a = useContext(AccountContext)
  if (a === null) throw new Error("useAccount needs an AccountProvider")
  return a
}

/** The newest active listings and the market's counts, refreshed every 20 seconds. */
function useListings() {
  const [listings, setListings] = useState<ReadonlyArray<Listing> | null>(null)
  const [stats, setStats] = useState<MarketStats | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const load = () =>
      void api<{ listings: ReadonlyArray<Listing>; stats: MarketStats }>("/listings")
        .then((r) => {
          setListings(r.listings)
          setStats(r.stats)
          setFailed(false)
        })
        .catch(() => setFailed(true))
    load()
    const t = setInterval(load, 20_000)
    return () => clearInterval(t)
  }, [])
  return { listings, stats, failed }
}

/**
 * Everything every route shares: the wallet session, the backend status, the
 * market list, the signed-in wallet's rules, funds and purchases, and the one
 * checkout dialog. A bought listing leaves /listings, so it stays in the list
 * here for the visit, shown as "In your wallet".
 */
export function AccountProvider({ children }: { children: ReactNode }) {
  const { wallet, token, signIn, signOut, signText } = useSession()
  const [status, setStatus] = useState<Status | null>(null)
  const [statusLoaded, setStatusLoaded] = useState(false)
  const [rules, setRules] = useState<ReadonlyArray<Rule>>([])
  const [funds, setFunds] = useState<Funds | null>(null)
  const [purchases, setPurchases] = useState<ReadonlyArray<MyPurchase>>([])
  const [bought, setBought] = useState<ReadonlyArray<Listing>>([])
  const [buying, setBuying] = useState<Listing | null>(null)
  const market = useListings()
  const { setVisible } = useWalletModal()
  const router = useRouter()

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
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) signOut()
    }
  }, [token, signOut])

  useEffect(() => {
    setRules([])
    setFunds(null)
    setPurchases([])
    setBought([])
    void refresh()
  }, [refresh])

  const owned = useMemo(
    () => new Set([...purchases.filter((p) => p.status === "executed").map((p) => p.listingId), ...bought.map((l) => l.listingId)]),
    [purchases, bought]
  )

  const watching = useMemo(
    () => new Set(rules.filter((r) => r.status === "active" && r.hard.cardId !== null).map((r) => r.hard.cardId as string)),
    [rules]
  )

  const listings = useMemo(() => {
    if (market.listings === null) return null
    const ids = new Set(market.listings.map((l) => l.listingId))
    const kept = bought.filter((l) => !ids.has(l.listingId))
    return kept.length === 0 ? market.listings : [...market.listings, ...kept].sort((a, b) => b.listedAt.localeCompare(a.listedAt))
  }, [market.listings, bought])

  const watch = useCallback(
    (l: Listing) => {
      const params = new URLSearchParams({ watch: watchWant(l) })
      router.push(`/agent?${params.toString()}`)
    },
    [router]
  )

  const value: Account = {
    wallet,
    token,
    signIn,
    signOut,
    signText,
    status,
    statusLoaded,
    listings,
    listingsFailed: market.failed,
    stats: market.stats,
    rules,
    funds,
    owned,
    watching,
    refresh,
    buy: setBuying,
    watch
  }

  return (
    <AccountContext.Provider value={value}>
      {children}
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
    </AccountContext.Provider>
  )
}
