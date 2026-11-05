"use client"

import Link from "next/link"
import type { CSSProperties, ReactNode } from "react"
import { useCallback, useEffect, useState } from "react"
import { api } from "@/lib/api"
import { ago, cardArt, GRADERS, setTheme } from "@/lib/art"
import { explorerTx, label, money, toMinor, variant } from "@/lib/format"
import { outcomeText, signAndPay } from "@/lib/purchase"
import type { Decision, Purchase, RuleDetail, SigningRequest, Status } from "@/lib/types"
import { useAction } from "@/lib/useAction"
import { Badge, Button, Led, Panel, Pill, type PillTone } from "./ui"

const PURCHASE_TONE: Partial<Record<Purchase["status"], PillTone>> = { executed: "ok", refused: "bad", failed: "bad" }

const STATUS_WORD: Record<RuleDetail["rule"]["status"], string> = {
  active: "watching",
  paused: "paused",
  exhausted: "budget used",
  draft: "draft"
}

/** Why an agent run started. */
const TRIGGER: Record<string, string> = { new_match: "new match", manual: "you asked", eval: "test run" }

/** How many skipped listings show before "Show all". */
const SKIPPED_SHOWN = 6

/** When an auto-buy approval ends, as a short date and time. */
const until = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })

/**
 * One watch rule from the server, refreshed every 10 seconds, and what the
 * collector can do with it: sign a waiting purchase, buy a match, ask the
 * agent about one, turn buying without asking on or off, pause or resume.
 * The /agent page shows it in two places, RuleView and RuleChat.
 */
export function useRule(p: { token: string; ruleId: string | null; signText: (message: string) => Promise<string>; onChange: () => void }) {
  const { token, ruleId, signText, onChange } = p
  const [detail, setDetail] = useState<RuleDetail | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const { busy, error, run } = useAction()

  const load = useCallback(async () => {
    if (ruleId !== null) setDetail(await api<RuleDetail>(`/rules/${ruleId}`, { token }))
  }, [ruleId, token])

  useEffect(() => {
    setDetail(null)
    setNote(null)
    if (ruleId === null) return
    void load().catch(() => {})
    const t = setInterval(() => void load().catch(() => {}), 10_000)
    return () => clearInterval(t)
  }, [load, ruleId])

  /** Confirm mode: the wallet signs a text naming this one purchase, then the server pays. */
  const signPurchase = async (purchaseId: string) => {
    setNote(outcomeText(await signAndPay(token, purchaseId, signText)))
    await load()
    onChange()
  }

  const sign = (purchaseId: string) => run(`sign:${purchaseId}`, () => signPurchase(purchaseId))

  const buy = (listingId: string) =>
    run(`buy:${listingId}`, async () => {
      const r = await api<{ status: "proposed"; purchaseId: string } | { status: "refused"; refusals: ReadonlyArray<string> }>(
        "/purchases",
        { token, body: { ruleId, listingId } }
      )
      if (r.status === "refused") {
        setNote(outcomeText(r))
        await load()
        return
      }
      await signPurchase(r.purchaseId)
    })

  const askAgent = (listingId: string) =>
    run(`agent:${listingId}`, async () => {
      const r = await api<{ outcome: string; finalText: string }>(`/rules/${ruleId}/agent`, { token, body: { listingId } })
      setNote(`Agent: ${r.outcome}. ${r.finalText}`)
      await load()
    })

  const startAuto = (dailyCapUsd: number, hours: number) =>
    run("auto", async () => {
      const req = await api<SigningRequest>(`/rules/${ruleId}/auto/start`, { token, body: { dailyCapUsd, hours } })
      const signature = await signText(req.message)
      await api(`/rules/${ruleId}/auto/finish`, { token, body: { nonce: req.nonce, signature } })
      setNote("Buying without asking is on. The agent may now pay for matches within these limits, and code checks each purchase.")
      await load()
      onChange()
    })

  const revoke = () =>
    run("revoke", async () => {
      await api(`/rules/${ruleId}/auto/revoke`, { token, body: {} })
      setNote("Buying without asking is off. The agent asks before every buy again.")
      await load()
      onChange()
    })

  const setStatus = (next: "active" | "paused") =>
    run("status", async () => {
      await api(`/rules/${ruleId}/status`, { token, body: { status: next } })
      await load()
      onChange()
    })

  return { detail, note, busy, error, sign, buy, askAgent, startAuto, revoke, setStatus }
}

export type RuleState = ReturnType<typeof useRule>

/**
 * The selected watch in the middle of /agent: the watch and its conditions
 * with Pause or Resume, Found for you (purchases waiting for a signature,
 * matches, and listings to review), Checked and skipped with the reasons,
 * Buy without asking, and the purchases. Styles: styles/desk.css.
 */
export function RuleView({ state, status }: { state: RuleState; status: Status }) {
  const { detail, busy } = state
  const [allSkipped, setAllSkipped] = useState(false)
  if (detail === null) return <Panel className="muted">Loading the watch…</Panel>

  const { rule } = detail
  const h = rule.hard
  const bought = new Set(detail.purchases.filter((p) => p.status === "executed").map((p) => p.listingId))
  const found = detail.decisions.filter((d) => d.verdict !== "reject")
  const skipped = detail.decisions.filter((d) => d.verdict === "reject")
  const pending = detail.purchases.filter((p) => p.status === "proposed")
  const canTrade = !status.readOnly
  const auto = detail.approvals[0]
  const judged = detail.decisions.length

  return (
    <>
      <Panel className="rule">
        <header className="rule-head">
          <div>
            <p className="eyebrow">Watch</p>
            <h2>{rule.rawWant}</h2>
            <div className="pills">
              <Pill tone={rule.status === "active" ? "ok" : null}>
                <Led on={rule.status === "active"} />
                {STATUS_WORD[rule.status]}
              </Pill>
              <Pill tone={auto ? "warn" : null}>
                {auto
                  ? `buys without asking, up to ${money({ amountMinor: auto.dailyCapUsdCents, currency: "USD" })} a day until ${until(auto.expiresAt)}`
                  : "asks before buying"}
              </Pill>
              <Pill>
                {judged >= 60 ? "60+" : judged} listing{judged === 1 ? "" : "s"} judged
              </Pill>
            </div>
          </div>
          {rule.status === "active" ? (
            <Button variant="secondary" onClick={() => state.setStatus("paused")} disabled={busy !== null}>
              Pause
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => state.setStatus("active")} disabled={busy !== null}>
              Resume
            </Button>
          )}
        </header>
        <dl className="facts rule-facts">
          <dt>Card</dt>
          <dd>{rule.cardName ?? "any card"}</dd>
          <dt>Set</dt>
          <dd>{rule.setName ?? "any set"}</dd>
          <dt>Edition</dt>
          <dd>{label(h.edition)}</dd>
          <dt>Finish</dt>
          <dd>{label(h.finish)}</dd>
          <dt>Grade</dt>
          <dd>
            {h.minGrade} or better, {h.graders.length ? h.graders.map((g) => GRADERS[g] ?? g).join(", ") : "any grader"}
          </dd>
          <dt>Top price</dt>
          <dd>{money(h.maxPrice)}</dd>
          <dt>Budget</dt>
          <dd>{money(rule.budget)}</dd>
          {rule.softDescription && (
            <>
              <dt>Also wants</dt>
              <dd>{rule.softDescription}</dd>
            </>
          )}
        </dl>
        {state.note && <p className="note">{state.note}</p>}
        {state.error && <p className="error">{state.error}</p>}
      </Panel>

      <Panel className="rule-found">
        <div className="panel-head">
          <h2>Found for you</h2>
          <span className="muted small">Matches, and listings the agent wants you to look at</span>
        </div>
        {pending.length > 0 && (
          <div className="pending">
            <h3>Waiting for your signature</h3>
            {pending.map((p) => (
              <PurchaseRow key={p.id} p={p}>
                <Button onClick={() => state.sign(p.id)} disabled={busy !== null || !canTrade}>
                  {busy === `sign:${p.id}` ? "Waiting for the wallet…" : "Sign and pay"}
                </Button>
              </PurchaseRow>
            ))}
          </div>
        )}
        {found.length === 0 && pending.length === 0 && (
          <p className="empty small">Nothing matches yet. New listings arrive about once a minute, and each one is checked as it arrives.</p>
        )}
        {found.map((d) => (
          <DecisionRow key={d.listingId} d={d}>
            {d.verdict === "needs_review" && <Pill tone="warn">needs your review</Pill>}
            {d.listing?.status === "active" && !bought.has(d.listingId) && (
              <>
                <Button onClick={() => state.buy(d.listingId)} disabled={busy !== null || !canTrade}>
                  {busy === `buy:${d.listingId}` ? "Waiting for the wallet…" : "Buy now"}
                </Button>
                {status.modelConfigured && (
                  <Button variant="secondary" onClick={() => state.askAgent(d.listingId)} disabled={busy !== null}>
                    {busy === `agent:${d.listingId}` ? "The agent is checking…" : "Ask the agent"}
                  </Button>
                )}
              </>
            )}
            {bought.has(d.listingId) && <Pill tone="ok">bought</Pill>}
          </DecisionRow>
        ))}
      </Panel>

      <Panel className="rule-skipped">
        <div className="panel-head">
          <h2>Checked and skipped</h2>
          <span className="muted small">Why each listing did not match</span>
        </div>
        {skipped.length === 0 ? (
          <p className="muted small">Nothing skipped yet.</p>
        ) : (
          <ul className="skipped">
            {(allSkipped ? skipped : skipped.slice(0, SKIPPED_SHOWN)).map((d) => (
              <SkippedRow key={d.listingId} d={d} />
            ))}
          </ul>
        )}
        {skipped.length > SKIPPED_SHOWN && (
          <Button variant="link" size="inline" onClick={() => setAllSkipped(!allSkipped)}>
            {allSkipped ? "Show fewer" : `Show all ${skipped.length}`}
          </Button>
        )}
      </Panel>

      <RuleAuto state={state} canTrade={canTrade} />

      {detail.purchases.length > 0 && (
        <Panel title="Purchases">
          {detail.purchases.map((p) => (
            <PurchaseRow key={p.id} p={p} />
          ))}
        </Panel>
      )}
    </>
  )
}

/** Buy without asking: off, with the form to sign a budget approval, or on until it ends, with Turn off. */
function RuleAuto({ state, canTrade }: { state: RuleState; canTrade: boolean }) {
  const [cap, setCap] = useState("200")
  const [hours, setHours] = useState("24")
  const auto = state.detail?.approvals[0]
  const busy = state.busy
  return (
    <Panel title="Buy without asking">
      {auto ? (
        <>
          <p className="small">
            On until {until(auto.expiresAt)}, up to {money({ amountMinor: auto.dailyCapUsdCents, currency: "USD" })} a day across
            your watches. Code checks every purchase before money moves.
          </p>
          <div className="row">
            <Button variant="secondary" onClick={state.revoke} disabled={busy !== null}>
              Turn off
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="muted small">
            Off: the agent asks before every buy. Sign a budget approval and it may pay for matches on its own, within this
            watch&apos;s budget, the daily cap and your dUSD allowance. Code checks every purchase before money moves.
          </p>
          <div className="row">
            <label>
              Daily cap <input value={cap} onChange={(e) => setCap(e.target.value)} size={6} inputMode="decimal" /> USD
            </label>
            <label>
              for <input value={hours} onChange={(e) => setHours(e.target.value)} size={4} inputMode="numeric" /> hours
            </label>
            <Button
              onClick={() => state.startAuto(Number(cap), Number(hours))}
              disabled={busy !== null || !canTrade || !(toMinor(Number(cap), "USD") > 0)}
            >
              {busy === "auto" ? "Waiting for the wallet…" : "Sign the approval"}
            </Button>
          </div>
        </>
      )}
    </Panel>
  )
}

/**
 * The watch as a conversation, with real lines only: what you asked for, then
 * what the agent wrote each time it ran for a match, with how it ran. There
 * are no free-form questions to the model here. Styles: styles/desk.css (.chat).
 */
export function RuleChat({ detail, status }: { detail: RuleDetail | null; status: Status }) {
  const runs = detail === null ? [] : [...detail.runs].reverse()
  return (
    <Panel className="chat">
      <div className="panel-head">
        <h2>Talk to the agent</h2>
        <Pill>this watch</Pill>
      </div>
      {detail === null ? (
        <p className="muted small">Loading…</p>
      ) : (
        <ol className="chat-lines">
          <li className="bubble you">
            <span className="bubble-who">You</span>
            {detail.rule.rawWant}
          </li>
          {runs.map((r) => (
            <li className="bubble agent" key={r.id}>
              <span className="bubble-who">
                Agent · <Pill>{(r.outcome ?? r.status).replaceAll("_", " ")}</Pill>
              </span>
              <span className="quote">{r.finalText || "It ran without a final message."}</span>
              <span className="bubble-meta mono">
                {r.listingId ?? "no listing"} · {TRIGGER[r.trigger] ?? r.trigger} · {r.modelCalls} model calls, {r.toolCalls} tool calls ·{" "}
                {/* Local time: the server's render and the browser's can differ, so React keeps the browser's. */}
                <time dateTime={r.startedAt} suppressHydrationWarning>
                  {new Date(r.startedAt).toLocaleTimeString()}
                </time>
              </span>
            </li>
          ))}
        </ol>
      )}
      {detail !== null && runs.length === 0 && (
        <p className="muted small">
          {status.agentEnabled
            ? "The agent writes here when it runs for a match: what it checked and what it did."
            : "Agent runs are off on this server, so only code checks new listings for this watch."}
        </p>
      )}
    </Panel>
  )
}

/**
 * A listing the matcher judged: thumbnail in its set's tone, the card with its
 * grade and price, the meta line, the seller's own words as plain text in a
 * well, the reasons, and the actions. The card's name opens the listing page.
 */
export function DecisionRow({ d, children }: { d: Decision; children?: ReactNode }) {
  const l = d.listing
  return (
    <div className="listing" style={l ? ({ "--tone": setTheme(l)?.tone } as CSSProperties) : undefined}>
      {l ? <img className="thumb" src={cardArt(l)} alt="" loading="lazy" width={64} height={89} /> : <span className="thumb" />}
      <div>
        <div className="listing-main">
          <div>
            <div className="decision-title">
              {l ? <Link href={`/listing/${encodeURIComponent(l.listingId)}`}>{l.cardName}</Link> : <strong>{d.listingId}</strong>}
              {l && (
                <Badge>
                  {l.grader} {l.grade}
                </Badge>
              )}
            </div>
            {l && (
              <div className="muted small">
                {l.setName} #{l.cardNumber} · {variant(l)} · cert {l.certNumber} · @{l.sellerHandle} · {ago(l.listedAt)}
                {l.status !== "active" && ` · ${l.status}`}
              </div>
            )}
          </div>
          <div className="price">{l ? money(l.price) : ""}</div>
        </div>
        {l && (
          <p className="seller-text small">
            {l.title}
            {"\n"}
            {l.description}
          </p>
        )}
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

/** A skipped listing in one line: a small thumbnail, the card with grade and price, the first reason, and when it was listed. */
export function SkippedRow({ d }: { d: Decision }) {
  const l = d.listing
  return (
    <li className="skip" style={l ? ({ "--tone": setTheme(l)?.tone } as CSSProperties) : undefined}>
      {l ? <img className="thumb thumb-sm" src={cardArt(l)} alt="" loading="lazy" width={28} height={39} /> : <span className="thumb thumb-sm" />}
      <div className="skip-text">
        <span>
          {l ? l.cardName : d.listingId}{" "}
          {l && (
            <span className="mono muted">
              {l.grader} {l.grade} · {money(l.price)}
            </span>
          )}
        </span>
        <span className="muted small">{d.reasons[0] ?? "Did not match."}</span>
      </div>
      <span className="skip-when mono small">{l ? ago(l.listedAt) : ""}</span>
    </li>
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
