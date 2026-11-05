"use client"

import dynamic from "next/dynamic"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useAccount } from "@/lib/account"
import { dusd } from "@/lib/format"
import { Logo } from "./Logo"
import { Chip, SearchIcon } from "./ui"

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

/** A four-point spark: the agent's mark. */
export function AgentIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M8 1.5l1.6 3.4 3.4 1.6-3.4 1.6L8 11.5 6.4 8.1 3 6.5l3.4-1.6z" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * The sticky top bar on every route: logo, the market's links, the devnet
 * chip, the optional Agent link, and the wallet button with the dUSD balance
 * once signed in. On a phone the links and the Agent link fold into a
 * search button.
 * Styles: styles/header.css.
 */
export function Header() {
  const path = usePathname()
  const { token, funds } = useAccount()
  const current = (href: string) => (href === path ? "page" : undefined)
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
        <div className="topbar-right">
          <Chip tone="warn">devnet</Chip>
          <Link className="topbar-icon" href="/market" aria-label="Search the market">
            <SearchIcon />
          </Link>
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
