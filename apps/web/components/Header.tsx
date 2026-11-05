"use client"

import dynamic from "next/dynamic"
import { Logo } from "./Logo"
import { Chip } from "./ui"

/** The wallet button depends on what the browser has installed, so it renders on the client only. */
const WalletMultiButton = dynamic(() => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton), {
  ssr: false,
  loading: () => <span className="wallet-placeholder" />
})

/** The sticky top bar: logo, section links, a devnet chip and the wallet button. Styles: styles/header.css. */
export function Header({ signedIn }: { signedIn: boolean }) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <a className="brand" href="#top" aria-label="Slabwatch home">
          <Logo />
          <span>Slabwatch</span>
        </a>
        <nav className="nav">
          {signedIn && <a href="#desk">Your rules</a>}
          <a href="#market">Market</a>
          <a href="#sets">Sets</a>
          {!signedIn && <a href="#how">How it works</a>}
        </nav>
        <div className="topbar-right">
          <Chip tone="warn">devnet</Chip>
          <WalletMultiButton />
        </div>
      </div>
    </header>
  )
}
