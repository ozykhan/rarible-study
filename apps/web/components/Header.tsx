"use client"

import dynamic from "next/dynamic"

/** The wallet button depends on what the browser has installed, so it renders on the client only. */
const WalletMultiButton = dynamic(() => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton), {
  ssr: false,
  loading: () => <span className="wallet-placeholder" />
})

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
          <span className="chip warn">devnet</span>
          <WalletMultiButton />
        </div>
      </div>
    </header>
  )
}

/** A graded case with a lens on its label: the app watches slabs. */
export function Logo() {
  return (
    <svg className="logo" width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="logo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e4ff3a" />
          <stop offset="1" stopColor="#7cf3c9" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#logo-g)" />
      <rect x="9" y="5.5" width="14" height="21" rx="2.5" fill="none" stroke="#0b0b0c" strokeWidth="2" />
      <path d="M9 11.5h14" stroke="#0b0b0c" strokeWidth="2" />
      <circle cx="16" cy="19" r="3" fill="#0b0b0c" />
    </svg>
  )
}
