"use client"

import { useWalletModal } from "@solana/wallet-adapter-react-ui"
import type { SlabCard } from "./Slab"
import { Slab } from "./Slab"
import { Button, SearchIcon } from "./ui"

/** Four showcase slabs around the headline. Fixed picks, so nothing shifts while listings load. */
const SHOWCASE: ReadonlyArray<SlabCard & { pos: string }> = [
  {
    pos: "a",
    setId: "EF",
    setName: "Emberfall",
    cardId: "EF-001",
    cardName: "Ashen Wyrm",
    cardNumber: "001",
    edition: "first",
    finish: "holo",
    grader: "NVG",
    grade: 10
  },
  {
    pos: "b",
    setId: "TW",
    setName: "Tidewild",
    cardId: "TW-007",
    cardName: "Tidewyrm",
    cardNumber: "007",
    edition: "unlimited",
    finish: "holo",
    grader: "QSG",
    grade: 9.5
  },
  {
    pos: "c",
    setId: "SE",
    setName: "Starward Expedition",
    cardId: "SE-001",
    cardName: "Nebula Drake",
    cardNumber: "001",
    edition: "first",
    finish: "reverse_holo",
    grader: "LCA",
    grade: 9
  },
  {
    pos: "d",
    setId: "OS",
    setName: "Origin Set",
    cardId: "OS-001",
    cardName: "Cinderwing Drake",
    cardNumber: "001",
    edition: "first",
    finish: "holo",
    grader: "NVG",
    grade: 9
  }
]

/**
 * The signed-out welcome: generated art, four floating slabs, the headline,
 * a market search and the two calls to action. Styles: styles/hero.css.
 */
export function Hero(props: {
  wallet: string | null
  signingIn: boolean
  onSignIn: () => void
  error: string | null
  query: string
  onQuery: (q: string) => void
  onBrowse: () => void
}) {
  const { setVisible } = useWalletModal()
  return (
    <section className="hero">
      <div className="hero-bg" aria-hidden="true" />
      <div className="hero-slabs" aria-hidden="true">
        {SHOWCASE.map(({ pos, ...card }) => (
          <div key={pos} className={`hero-slab hero-slab-${pos}`}>
            <Slab card={card} eager />
          </div>
        ))}
      </div>
      <div className="hero-copy">
        <h1>Your grail card, on watch</h1>
        <p className="lede">
          Describe the graded card you want in plain words. An AI agent watches every new listing, checks it with code first, and
          buys only within limits you signed.{" "}
          <a href="#how" className="strong-link">
            How it works?
          </a>
        </p>
        <form
          className="hero-search"
          onSubmit={(e) => {
            e.preventDefault()
            props.onBrowse()
          }}
        >
          <SearchIcon />
          <input
            value={props.query}
            onChange={(e) => props.onQuery(e.target.value)}
            placeholder="Search cards, sets or graders"
            aria-label="Search the market"
          />
          <kbd aria-hidden="true">↵</kbd>
        </form>
        <div className="hero-actions">
          {props.wallet === null ? (
            <Button size="lg" onClick={() => setVisible(true)}>
              Connect a devnet wallet
            </Button>
          ) : (
            <Button size="lg" onClick={props.onSignIn} disabled={props.signingIn}>
              {props.signingIn ? "Waiting for the wallet…" : "Sign in with this wallet"}
            </Button>
          )}
          <Button size="lg" variant="ring" onClick={props.onBrowse}>
            Browse the market
          </Button>
        </div>
        {props.wallet !== null && (
          <p className="hero-note">Your wallet signs a one-time text that proves you own it. Signing it moves no funds.</p>
        )}
        {props.error && <p className="error">{props.error}</p>}
      </div>
    </section>
  )
}
