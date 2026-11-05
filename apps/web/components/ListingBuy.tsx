"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { useAccount } from "@/lib/account"
import { cardId } from "@/lib/art"
import { dusd, money } from "@/lib/format"
import type { Listing } from "@/lib/types"
import { CheckoutView, useCheckout } from "./Checkout"
import { Button, Chip } from "./ui"

/**
 * The price panel on a listing page. Buy now is the main action, and the
 * checkout opens right here in the panel: the total, what the wallet holds
 * after, and the same steps as the dialog. Watch opens the agent drawer.
 * A listing that cannot be bought here says why instead of offering Buy now,
 * and one this wallet bought says so. Styles: styles/listing.css (.listing-buy).
 */
export function ListingBuy({ l, onWatch }: { l: Listing; onWatch: () => void }) {
  const a = useAccount()
  const [open, setOpen] = useState(false)
  const { step, busy, view } = useCheckout({
    listing: l,
    status: a.status,
    wallet: a.wallet,
    token: a.token,
    funds: a.funds,
    onConnect: a.connect,
    signIn: a.signIn,
    signText: a.signText,
    onFunds: a.refresh,
    onBought: a.addBought
  })
  const box = useRef<HTMLElement>(null)
  const was = useRef(open)
  const owned = a.owned.has(l.listingId)
  const watching = a.watching.has(cardId(l))
  // Until /status answers, Buy now waits; after that, a blocked step is the reason it is not offered.
  const gate = a.statusLoaded && step.kind === "blocked" ? step.why : null

  // Focus follows the panel: to the checkout's action when it opens, and back to Buy now when it closes.
  useEffect(() => {
    if (was.current === open) return
    was.current = open
    const target = open ? ".checkout-actions .btn-primary:not(:disabled)" : ".listing-buy-now"
    box.current?.querySelector<HTMLElement>(target)?.focus()
  }, [open])

  const close = () => {
    if (busy === null) setOpen(false)
  }

  return (
    <section ref={box} className="panel listing-panel listing-buy" aria-labelledby="listing-price">
      <h2 id="listing-price">Price</h2>
      <p className="listing-price">
        <span className="price">{money(l.price)}</span>
        {l.price.currency !== "USD" && <Chip tone="warn">{l.price.currency}</Chip>}
      </p>
      {l.price.currency !== "USD" && l.payUnits !== undefined && l.status === "active" && (
        <p className="muted small">
          You pay <span className="mono">{dusd(l.payUnits)}</span> at the demo&apos;s fixed rate.
        </p>
      )}

      {open ? (
        <CheckoutView {...view} as="inline" onClose={close} />
      ) : owned ? (
        <>
          <p className="note" role="status">
            In your wallet. This wallet bought cert {l.certNumber} on devnet.
          </p>
          <div className="listing-actions">
            <Link className="btn btn-lg btn-secondary" href="/market">
              Back to the market
            </Link>
          </div>
        </>
      ) : (
        <>
          {gate !== null && <p className="checkout-test">{gate}</p>}
          <div className="listing-actions">
            {gate === null && (
              <Button size="lg" className="listing-buy-now" disabled={!a.statusLoaded} onClick={() => setOpen(true)}>
                Buy now
              </Button>
            )}
            <Button variant="secondary" size="lg" aria-pressed={watching} onClick={onWatch}>
              {watching ? "Watching" : "Watch"}
            </Button>
          </div>
          {gate === null && <p className="muted small">Sign to buy in your wallet. Code checks the listing again before paying.</p>}
        </>
      )}
    </section>
  )
}
