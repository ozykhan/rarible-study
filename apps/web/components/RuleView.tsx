"use client"

import type { CSSProperties, ReactNode } from "react"
import { useCallback, useEffect, useState } from "react"
import { api } from "@/lib/api"
import { cardArt, setTheme } from "@/lib/art"
import { explorerTx, label, money, toMinor } from "@/lib/format"
import type { Decision, ExecuteResult, Purchase, RuleDetail, SigningRequest, Status } from "@/lib/types"
import { useAction } from "@/lib/useAction"

const VERDICT: Record<Decision["verdict"], string> = { match: "Match", needs_review: "Needs your review", reject: "Rejected" }

const outcomeText = (r: ExecuteResult | { status: "refused"; refusals: ReadonlyArray<string> }) => {
  switch (r.status) {
    case "executed":
      return "Paid. The listing is yours (on devnet)."
    case "awaiting_collector_approval":
      return "Waiting for your signature."
    case "refused":
      return `Refused by code: ${r.refusals.join("; ")}`
    case "failed":
      return `The payment failed: ${r.error}`
  }
}

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
    const req = await api<SigningRequest>(`/purchases/${purchaseId}/approve/start`, { token, body: {} })
    const signature = await props.signText(req.message)
    const result = await api<ExecuteResult>(`/purchases/${purchaseId}/approve/finish`, {
      token,
      body: { nonce: req.nonce, signature }
    })
    setNote(outcomeText(result))
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

  if (detail === null) return <section className="panel muted">Loading the rule…</section>
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
    <section className="panel rule">
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
          <span className={`pill ${rule.status === "active" ? "ok" : ""}`}>{rule.status}</span>
          <span className={`pill ${rule.mode === "auto" ? "warn" : ""}`}>{rule.mode === "auto" ? "auto-buy" : "confirm each"}</span>
          <span className="pill">budget {money(rule.budget)}</span>
        </div>
      </header>

      <div className="row">
        {rule.status === "active" ? (
          <button className="secondary" onClick={() => setStatus("paused")} disabled={busy !== null}>
            Pause
          </button>
        ) : (
          <button className="secondary" onClick={() => setStatus("active")} disabled={busy !== null}>
            Resume
          </button>
        )}
      </div>

      {note && <p className="note">{note}</p>}
      {error && <p className="error">{error}</p>}

      {pending.length > 0 && (
        <div className="block">
          <h3>Waiting for your signature</h3>
          {pending.map((p) => (
            <PurchaseRow key={p.id} p={p}>
              <button onClick={() => run(`sign:${p.id}`, () => signPurchase(p.id))} disabled={busy !== null || !canTrade}>
                {busy === `sign:${p.id}` ? "Waiting for the wallet…" : "Sign and pay"}
              </button>
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
                <button className="link" onClick={() => setShowRejected(!showRejected)}>
                  {showRejected ? "hide" : "show why"}
                </button>
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
                    <button onClick={() => buy(d.listingId)} disabled={busy !== null || !canTrade}>
                      {busy === `buy:${d.listingId}` ? "Waiting for the wallet…" : "Buy (sign)"}
                    </button>
                    {props.status.modelConfigured && (
                      <button className="secondary" onClick={() => askAgent(d.listingId)} disabled={busy !== null}>
                        {busy === `agent:${d.listingId}` ? "The agent is checking…" : "Ask the agent"}
                      </button>
                    )}
                  </>
                )}
                {bought.has(d.listingId) && <span className="pill ok">bought</span>}
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
            <button className="secondary" onClick={revoke} disabled={busy !== null}>
              Turn off auto-buy
            </button>
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
              <button onClick={startAuto} disabled={busy !== null || !canTrade || !(toMinor(Number(cap), "USD") > 0)}>
                {busy === "auto" ? "Waiting for the wallet…" : "Sign auto-buy approval"}
              </button>
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
                <span className="pill">{r.outcome ?? r.status}</span> {r.listingId} · {r.trigger} · {r.modelCalls} model calls,{" "}
                {r.toolCalls} tool calls · {new Date(r.startedAt).toLocaleTimeString()}
              </div>
              {r.finalText && <p className="small quote">{r.finalText}</p>}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function DecisionRow({ d, children }: { d: Decision; children?: ReactNode }) {
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

function PurchaseRow({ p, children }: { p: Purchase; children?: ReactNode }) {
  return (
    <div className="purchase small">
      <span className={`pill ${p.status === "executed" ? "ok" : p.status === "refused" || p.status === "failed" ? "bad" : ""}`}>
        {p.status}
      </span>{" "}
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
