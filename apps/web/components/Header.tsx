"use client"

import dynamic from "next/dynamic"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Suspense } from "react"
import { useAccount } from "@/lib/account"
import { dusd } from "@/lib/format"
import { Logo } from "./Logo"
import { MarketSearch } from "./MarketSearch"
import { AgentIcon, Chip, SearchIcon } from "./ui"

/** The wallet button depends on what the browser has installed, so it renders on the client only. */
const WalletMultiButton = dynamic(() => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton), {
  ssr: false,
  loading: () => <span className="wallet-placeholder" />
})

const NAV: ReadonlyArray<[href: string, label: string]> = [
  ["/market", "Market"],
  ["/#sets", "Sets"],
  ["/#graders", "Graders"],
  ["/#how", "How buying works"]
]

/**
 * The sticky top bar on every route: logo, the market's links, the market
 * search on /market, the devnet chip, the optional Agent link, and the wallet
 * button with the dUSD balance once signed in. On a phone the links and the
 * Agent link fold into a search button.
 * Styles: styles/header.css.
 */
export function Header() {
  const path = usePathname()
  const { token, funds } = useAccount()
  // A listing page belongs to the market, so Market stays marked there.
  const current = (href: string) => (href === path ? "page" : href === "/market" && path.startsWith("/listing/") ? "true" : undefined)
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link className="brand" href="/" aria-label="Slabwatch home">
          <Logo />
          <span>Slabwatch</span>
        </Link>
        <nav className="nav" aria-label="Main">
          {NAV.map(([href, label]) => (
            <Link key={href} href={href} aria-current={current(href)}>
              {label}
            </Link>
          ))}
        </nav>
        {path === "/market" && (
          <Suspense fallback={null}>
            <MarketSearch className="topbar-search" />
          </Suspense>
        )}
        <div className="topbar-right">
          <Chip tone="warn">devnet</Chip>
          {path === "/market" ? (
            // On the market the field is on the page already; the button takes you to it.
            <button
              type="button"
              className="topbar-icon"
              aria-label="Search the market"
              onClick={() => document.getElementById("market-search")?.focus()}
            >
              <SearchIcon />
            </button>
          ) : (
            <Link className="topbar-icon" href="/market" aria-label="Search the market">
              <SearchIcon />
            </Link>
          )}
          <Link className="topbar-agent" href="/agent" aria-current={current("/agent")}>
            <AgentIcon />
            <span>Agent</span>
          </Link>
          {token !== null && funds !== null && <span className="topbar-balance mono hide-sm">{dusd(funds.balanceUnits)}</span>}
          <WalletMultiButton />
        </div>
      </div>
    </header>
  )
}
