"use client"

import type { CSSProperties, ReactNode } from "react"
import { useCallback, useEffect, useState } from "react"
import { api } from "@/lib/api"
import { cardArt, setTheme } from "@/lib/art"
import { explorerTx, label, money, toMinor } from "@/lib/format"
import { outcomeText, signAndPay } from "@/lib/purchase"
import type { Decision, Purchase, RuleDetail, SigningRequest, Status } from "@/lib/types"
import { useAction } from "@/lib/useAction"
import { Button, Panel, Pill, type PillTone } from "./ui"

const VERDICT: Record<Decision["verdict"], string> = { match: "Match", needs_review: "Needs your review", reject: "Rejected" }

const PURCHASE_TONE: Partial<Record<Purchase["status"], PillTone>> = { executed: "ok", refused: "bad", failed: "bad" }

/**
 * One watch rule in full: its criteria and status, purchases waiting for a
 * signature, matches, listings to review, rejections, auto-buy, purchases and
 * agent runs. Refreshes every 10 seconds. Styles: styles/desk.css.
 */
export function RuleView(props: {
  token: string
  ruleId: string
  status: Status
  signText: (message: string) => Promise<string>
  onChange: () => void
}) {
  const { token, ruleId } = props
  const [detail, setDetail] = useState<RuleDetail | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [cap, setCap] = useState("200")
  const [hours, setHours] = useState("24")
  const [showRejected, setShowRejected] = useState(false)
  const { busy, error, run } = useAction()

  const load = useCallback(async () => {
    setDetail(await api<RuleDetail>(`/rules/${ruleId}`, { token }))
  }, [ruleId, token])

  useEffect(() => {
    setDetail(null)
    void load().catch(() => {})
    const t = setInterval(() => void load().catch(() => {}), 10_000)
    return () => clearInterval(t)
  }, [load])

  /** Confirm mode: the wallet signs a text naming this one purchase, then the server pays. */
  const signPurchase = async (purchaseId: string) => {
    setNote(outcomeText(await signAndPay(token, purchaseId, props.signText)))
    await load()
    props.onChange()
  }

  const buy = (listingId: string) =>
    run(`buy:${listingId}`, async () => {
      const p = await api<{ status: "proposed"; purchaseId: string } | { status: "refused"; refusals: ReadonlyArray<string> }>(
        "/purchases",
        { token, body: { ruleId, listingId } }
      )
      if (p.status === "refused") {
        setNote(outcomeText(p))
        await load()
        return
      }
      await signPurchase(p.purchaseId)
    })

  const askAgent = (listingId: string) =>
    run(`agent:${listingId}`, async () => {
      const r = await api<{ outcome: string; finalText: string }>(`/rules/${ruleId}/agent`, { token, body: { listingId } })
      setNote(`Agent: ${r.outcome}. ${r.finalText}`)
      await load()
    })

  const startAuto = () =>
    run("auto", async () => {
      const req = await api<SigningRequest>(`/rules/${ruleId}/auto/start`, {
        token,
        body: { dailyCapUsd: Number(cap), hours: Number(hours) }
      })
      const signature = await props.signText(req.message)
      await api(`/rules/${ruleId}/auto/finish`, { token, body: { nonce: req.nonce, signature } })
      setNote("Auto-buy is on. The agent may now pay for matches within these limits, and code checks each purchase.")
      await load()
      props.onChange()
    })

  const revoke = () =>
    run("revoke", async () => {
      await api(`/rules/${ruleId}/auto/revoke`, { token, body: {} })
      setNote("Auto-buy is off. The rule is back in confirm mode.")
      await load()
      props.onChange()
    })

  const setStatus = (next: "active" | "paused") =>
    run("status", async () => {
      await api(`/rules/${ruleId}/status`, { token, body: { status: next } })
      await load()
      props.onChange()
    })

  if (detail === null) return <Panel className="muted">Loading the rule…</Panel>
  const { rule } = detail
  const h = rule.hard
  const bought = new Set(detail.purchases.filter((p) => p.status === "executed").map((p) => p.listingId))
  const groups = (["match", "needs_review", "reject"] as const).map((v) => ({
    verdict: v,
    items: detail.decisions.filter((d) => d.verdict === v)
  }))
  const pending = detail.purchases.filter((p) => p.status === "proposed")
  const canTrade = !props.status.readOnly
  const auto = detail.approvals[0]

  return (
    <Panel className="rule">
      <header className="rule-head">
        <div>
          <h2>{rule.rawWant}</h2>
          <p className="muted small">
            {rule.cardName ?? "any card"} · {rule.setName ?? "any set"} · {label(h.edition)} · {label(h.finish)} · grade{" "}
            {h.minGrade}+ · {h.graders.length ? h.graders.join("/") : "any grader"} · at most {money(h.maxPrice)}
            {rule.softDescription ? ` · also: ${rule.softDescription}` : ""}
          </p>
        </div>
        <div className="pills">
          <Pill tone={rule.status === "active" ? "ok" : null}>{rule.status}</Pill>
          <Pill tone={rule.mode === "auto" ? "warn" : null}>{rule.mode === "auto" ? "auto-buy" : "confirm each"}</Pill>
          <Pill>budget {money(rule.budget)}</Pill>
        </div>
      </header>

      <div className="row">
        {rule.status === "active" ? (
          <Button variant="secondary" onClick={() => setStatus("paused")} disabled={busy !== null}>
            Pause
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => setStatus("active")} disabled={busy !== null}>
            Resume
          </Button>
        )}
      </div>

      {note && <p className="note">{note}</p>}
      {error && <p className="error">{error}</p>}

      {pending.length > 0 && (
        <div className="block">
          <h3>Waiting for your signature</h3>
          {pending.map((p) => (
            <PurchaseRow key={p.id} p={p}>
              <Button onClick={() => run(`sign:${p.id}`, () => signPurchase(p.id))} disabled={busy !== null || !canTrade}>
                {busy === `sign:${p.id}` ? "Waiting for the wallet…" : "Sign and pay"}
              </Button>
            </PurchaseRow>
          ))}
        </div>
      )}

      {groups.map(({ verdict, items }) =>
        verdict === "reject" ? (
          <div className="block" key={verdict}>
            <h3>
              {VERDICT[verdict]} ({items.length}){" "}
              {items.length > 0 && (
                <Button variant="link" onClick={() => setShowRejected(!showRejected)}>
                  {showRejected ? "hide" : "show why"}
                </Button>
              )}
            </h3>
            {showRejected && items.map((d) => <DecisionRow key={d.listingId} d={d} />)}
          </div>
        ) : (
          <div className="block" key={verdict}>
            <h3>
              {VERDICT[verdict]} ({items.length})
            </h3>
            {items.length === 0 && <p className="muted small">None yet. New listings arrive every minute or so.</p>}
            {items.map((d) => (
              <DecisionRow key={d.listingId} d={d}>
                {d.listing?.status === "active" && !bought.has(d.listingId) && (
                  <>
                    <Button onClick={() => buy(d.listingId)} disabled={busy !== null || !canTrade}>
                      {busy === `buy:${d.listingId}` ? "Waiting for the wallet…" : "Buy (sign)"}
                    </Button>
                    {props.status.modelConfigured && (
                      <Button variant="secondary" onClick={() => askAgent(d.listingId)} disabled={busy !== null}>
                        {busy === `agent:${d.listingId}` ? "The agent is checking…" : "Ask the agent"}
                      </Button>
                    )}
                  </>
                )}
                {bought.has(d.listingId) && <Pill tone="ok">bought</Pill>}
              </DecisionRow>
            ))}
          </div>
        )
      )}

      <div className="block">
        <h3>Auto-buy</h3>
        {auto ? (
          <>
            <p className="small">
              On until {new Date(auto.expiresAt).toLocaleString()}, with a daily cap of{" "}
              {money({ amountMinor: auto.dailyCapUsdCents, currency: "USD" })} across your rules.
            </p>
            <Button variant="secondary" onClick={revoke} disabled={busy !== null}>
              Turn off auto-buy
            </Button>
          </>
        ) : (
          <>
            <p className="muted small">
              Sign a budget approval and the agent may pay for matches on its own, within this rule&apos;s budget, the daily cap
              and your dUSD allowance. Code checks every purchase before money moves.
            </p>
            <div className="row">
              <label>
                Daily cap <input value={cap} onChange={(e) => setCap(e.target.value)} size={6} inputMode="decimal" /> USD
              </label>
              <label>
                for <input value={hours} onChange={(e) => setHours(e.target.value)} size={4} inputMode="numeric" /> hours
              </label>
              <Button onClick={startAuto} disabled={busy !== null || !canTrade || !(toMinor(Number(cap), "USD") > 0)}>
                {busy === "auto" ? "Waiting for the wallet…" : "Sign auto-buy approval"}
              </Button>
            </div>
          </>
        )}
      </div>

      {detail.purchases.length > 0 && (
        <div className="block">
          <h3>Purchases</h3>
          {detail.purchases.map((p) => (
            <PurchaseRow key={p.id} p={p} />
          ))}
        </div>
      )}

      {detail.runs.length > 0 && (
        <div className="block">
          <h3>Agent runs</h3>
          {detail.runs.map((r) => (
            <div className="run" key={r.id}>
              <div className="small">
                <Pill>{r.outcome ?? r.status}</Pill> {r.listingId} · {r.trigger} · {r.modelCalls} model calls,{" "}
                {r.toolCalls} tool calls · {new Date(r.startedAt).toLocaleTimeString()}
              </div>
              {r.finalText && <p className="small quote">{r.finalText}</p>}
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}

/** A listing the matcher judged: thumbnail in its set's tone, title, meta, price, the seller's text as plain text, and the reasons. */
export function DecisionRow({ d, children }: { d: Decision; children?: ReactNode }) {
  const l = d.listing
  return (
    <div className="listing" style={l ? ({ "--tone": setTheme(l)?.tone } as CSSProperties) : undefined}>
      {l ? <img className="thumb" src={cardArt(l)} alt="" loading="lazy" width={64} height={89} /> : <span className="thumb" />}
      <div>
        <div className="listing-main">
          <div>
            <strong>{l ? l.title : d.listingId}</strong>
            {l && (
              <div className="muted small">
                {l.cardName} #{l.cardNumber} · {l.setName} · {label(l.edition)} · {label(l.finish)} · {l.grader} {l.grade} · cert{" "}
                {l.certNumber} · by {l.sellerHandle}
                {l.status !== "active" && ` · ${l.status}`}
              </div>
            )}
          </div>
          <div className="price">{l ? money(l.price) : ""}</div>
        </div>
        {l && <p className="seller-text small">{l.description}</p>}
        {d.reasons.length > 0 && (
          <ul className="reasons small">
            {d.reasons.slice(0, 4).map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
        {children && <div className="row">{children}</div>}
      </div>
    </div>
  )
}

/** A purchase: its state as a pill, the listing, price and who asked, and a devnet explorer link once paid. */
export function PurchaseRow({ p, children }: { p: Purchase; children?: ReactNode }) {
  return (
    <div className="purchase small">
      <Pill tone={PURCHASE_TONE[p.status]}>{p.status}</Pill>{" "}
      {p.listingId} · {money(p.price)} · by {p.actor.split(":")[0]}
      {p.txSignature && !p.txSignature.startsWith("simulated:") && (
        <>
          {" "}
          ·{" "}
          <a href={explorerTx(p.txSignature)} target="_blank" rel="noreferrer">
            transfer on devnet
          </a>
        </>
      )}
      {p.refusals.length > 0 && <div className="muted">{p.refusals.join("; ")}</div>}
      {children && <div className="row">{children}</div>}
    </div>
  )
}
