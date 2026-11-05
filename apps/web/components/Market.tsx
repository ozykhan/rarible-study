"use client"

import { useEffect, useState } from "react"
import { api } from "@/lib/api"
import { label, money } from "@/lib/format"
import type { Listing } from "@/lib/types"

/** The newest listings. Seller text is shown as plain text: it is untrusted, and some of it is written to trick the agent. */
export function Market() {
  const [listings, setListings] = useState<ReadonlyArray<Listing> | null>(null)
  useEffect(() => {
    const load = () => void api<{ listings: ReadonlyArray<Listing> }>("/listings").then((r) => setListings(r.listings)).catch(() => {})
    load()
    const t = setInterval(load, 20_000)
    return () => clearInterval(t)
  }, [])
  return (
    <section className="card">
      <h2>On the market now</h2>
      {listings === null && <p className="muted">Loading listings…</p>}
      <div className="grid">
        {listings?.slice(0, 18).map((l) => (
          <article className="slab" key={l.listingId}>
            <div className="slab-label">
              <span>{l.grader}</span>
              <strong>{l.grade}</strong>
            </div>
            <div className="slab-body">
              <strong>{l.cardName}</strong>
              <div className="muted small">
                {l.setName} #{l.cardNumber} · {label(l.edition)} · {label(l.finish)}
              </div>
              <div className="small clamp">{l.title}</div>
              <div className="price">{money(l.price)}</div>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
