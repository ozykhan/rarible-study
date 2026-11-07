"use client"

import Link from "next/link"
import type { CSSProperties, FormEvent, ReactNode } from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import { api } from "@/lib/api"
import { ago, cardArt, GRADERS, setTheme } from "@/lib/art"
import { explorerTx, label, money, toMinor, variant } from "@/lib/format"
import { outcomeText, signAndPay } from "@/lib/purchase"
import type { AgentRun, Decision, Purchase, RuleDetail, SigningRequest, Status } from "@/lib/types"
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

/** The longest chat message the server takes. */
const CHAT_MAX_CHARS = 500

/** "1 model call", "3 model calls". */
const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

/** How a run went, for its meta line. */
const effort = (r: AgentRun) => `${count(r.modelCalls, "model call")}, ${count(r.toolCalls, "tool call")}`

/** A run's outcome as a short word for its pill: "llm_error: ..." reads "llm error". */
const outcomeWord = (r: AgentRun) => (r.outcome ?? r.status).split(":")[0]!.replaceAll("_", " ")

/** What a run that ended without a final message says instead, by why it ended. */
const silentRun = (r: AgentRun) =>
  r.outcome === "spend_cap"
    ? "The demo's daily model budget is used up, so the agent stopped. It resets at midnight UTC."
    : r.outcome === "llm_not_configured"
      ? "This server has no model key, so the agent did not run."
      : r.outcome?.startsWith("llm_error")
        ? "The model call failed, so there is no answer. Try again in a minute."
        : "It ran without a final message."

/** How many skipped listings show before "Show all". */
const SKIPPED_SHOWN = 6

/** When an auto-buy approval ends, as a short date and time. */
const until = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })

/**
 * One watch rule from the server, refreshed every 10 seconds, and what the
 * collector can do with it: sign a waiting purchase, buy a match, ask the
 * agent about one, chat with the agent about the watch, turn buying without
 * asking on or off, pause or resume. The /agent page shows it in two places,
 * RuleView and RuleChat. The chat has its own busy state and error, so a
 * question on its way does not hold up the buttons on the watch.
 */
export function useRule(p: { token: string; ruleId: string | null; signText: (message: string) => Promise<string>; onChange: () => void }) {
  const { token, ruleId, signText, onChange } = p
  const [detail, setDetail] = useState<RuleDetail | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const { busy, error, run } = useAction()
  const talk = useAction()
  const clearTalk = talk.clearError
  const [asked, setAsked] = useState<string | null>(null)
  // The watch on screen now: an answer that arrives after a switch must not reload the old one over it.
  const shown = useRef(ruleId)
  shown.current = ruleId

  const load = useCallback(async () => {
    if (ruleId !== null) setDetail(await api<RuleDetail>(`/rules/${ruleId}`, { token }))
  }, [ruleId, token])

  useEffect(() => {
    setDetail(null)
    setNote(null)
    setAsked(null)
    clearTalk()
    if (ruleId === null) return
    void load().catch(() => {})
    const t = setInterval(() => void load().catch(() => {}), 10_000)
    return () => clearInterval(t)
  }, [load, ruleId, clearTalk])

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

  /** One chat message. The answer is stored as a run on the watch, so it shows once the watch reloads. */
  const ask = async (message: string) => {
    const sentFor = ruleId
    setAsked(message)
    const sent = await talk.run("chat", async () => {
      await api(`/rules/${sentFor}/chat`, { token, body: { message } })
      if (shown.current === sentFor) await load()
      return true
    })
    if (shown.current === sentFor) setAsked(null)
    return sent === true
  }

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

  const chat: ChatControls = { ask, asked, error: talk.error }
  return { detail, note, busy, error, sign, buy, askAgent, chat, startAuto, revoke, setStatus }
}

/** The chat box's side of useRule. */
export interface ChatControls {
  /** Sends a message. True once the agent's turn is stored, answered or not; false when the request failed. */
  readonly ask: (message: string) => Promise<boolean>
  /** The message on its way, shown in the log until the answer arrives. */
  readonly asked: string | null
  readonly error: string | null
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
 * The watch as a conversation: what you asked for, what the agent wrote each
 * time it ran for a match, and the chat, where you ask about the watch and
 * the agent answers. In the chat the agent has read tools only (listings and
 * past sales): it cannot buy or change the watch. Each turn is stored as an
 * agent run, so the log is the server's record, not the page's. The log
 * scrolls on its own and keeps the newest line in view. Styles:
 * styles/desk.css (.chat).
 */
export function RuleChat({ detail, status, chat }: { detail: RuleDetail | null; status: Status; chat: ChatControls }) {
  const runs = detail === null ? [] : [...detail.runs].reverse()
  const [text, setText] = useState("")
  const log = useRef<HTMLDivElement>(null)
  const sending = chat.asked !== null
  const loaded = detail !== null
  const canAsk = loaded && status.modelConfigured
  const newest = runs[runs.length - 1]?.id
  // A reload during the request can bring the turn in as running; then the log already shows the question.
  const pending = chat.asked !== null && !runs.some((r) => r.trigger === "chat" && r.status === "running")

  useEffect(() => {
    const el = log.current
    if (el) el.scrollTop = el.scrollHeight
  }, [newest, pending, loaded])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const message = text.trim()
    if (message.length === 0 || sending) return
    if (await chat.ask(message)) setText("")
  }

  return (
    <Panel className="chat">
      <div className="panel-head">
        <h2>Talk to the agent</h2>
        <Pill>this watch</Pill>
      </div>
      {detail === null ? (
        <p className="muted small">Loading…</p>
      ) : (
        <div className="chat-log" ref={log} role="log" aria-label="Conversation with the agent" tabIndex={0}>
          <ol className="chat-lines">
            <li className="bubble you">
              <span className="bubble-who">You</span>
              {detail.rule.rawWant}
            </li>
            {runs.map((r) => (r.trigger === "chat" ? <ChatTurn key={r.id} r={r} /> : <RunLine key={r.id} r={r} />))}
            {pending && (
              <>
                <li className="bubble you">
                  <span className="bubble-who">You</span>
                  <span className="quote">{chat.asked}</span>
                </li>
                <li className="bubble agent" aria-busy="true">
                  <span className="bubble-who">Agent</span>
                  <span className="quote muted">Looking into it…</span>
                </li>
              </>
            )}
          </ol>
          {runs.length === 0 && !pending && (
            <p className="muted small">
              {!status.modelConfigured
                ? "Only code checks new listings on this server: it has no model key."
                : status.agentEnabled
                  ? "The agent writes here each time it runs for a match. Ask it about this watch below."
                  : "On this server the agent does not run on new matches by itself. Ask it about this watch below."}
            </p>
          )}
        </div>
      )}
      <form className="chat-ask" onSubmit={submit}>
        <label htmlFor="chat-ask">Ask about this watch, a listing or a price</label>
        <div className="chat-ask-row">
          <input
            id="chat-ask"
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={CHAT_MAX_CHARS}
            autoComplete="off"
            placeholder="Why was the last one skipped?"
            disabled={!canAsk}
          />
          <Button type="submit" disabled={!canAsk || sending || text.trim().length === 0}>
            {sending ? "Sending…" : "Send"}
          </Button>
        </div>
        <span className="muted small">
          {status.modelConfigured
            ? "It looks up listings and past sales. It cannot buy or change this watch from here."
            : "This server has no model key, so the agent cannot answer."}
        </span>
        {chat.error && <p className="error small">{chat.error}</p>}
      </form>
    </Panel>
  )
}

/** The time a run started, in the browser's own clock. */
function RunTime({ r }: { r: AgentRun }) {
  /* Local time: the server's render and the browser's can differ, so React keeps the browser's. */
  return (
    <time dateTime={r.startedAt} suppressHydrationWarning>
      {new Date(r.startedAt).toLocaleTimeString()}
    </time>
  )
}

/** A run the agent made for a listing: its outcome, what it wrote, and how it ran. */
function RunLine({ r }: { r: AgentRun }) {
  return (
    <li className="bubble agent">
      <span className="bubble-who">
        Agent · <Pill>{outcomeWord(r)}</Pill>
      </span>
      <span className="quote">{r.finalText || silentRun(r)}</span>
      <span className="bubble-meta mono">
        {r.listingId ?? "no listing"} · {TRIGGER[r.trigger] ?? r.trigger} · {effort(r)} · <RunTime r={r} />
      </span>
    </li>
  )
}

/** A chat turn still running after this long has stopped without an answer (the server restarted, say). */
const CHAT_STALE_MS = 3 * 60_000

/**
 * A chat turn: your message, then the agent's answer, with a pill only when
 * there is no answer. A turn the server is still working on reads as busy.
 */
function ChatTurn({ r }: { r: AgentRun }) {
  const working = r.status === "running" && Date.now() - Date.parse(r.startedAt) < CHAT_STALE_MS
  return (
    <>
      <li className="bubble you">
        <span className="bubble-who">You</span>
        <span className="quote">{r.question}</span>
      </li>
      {working ? (
        <li className="bubble agent" aria-busy="true">
          <span className="bubble-who">Agent</span>
          <span className="quote muted">Looking into it…</span>
        </li>
      ) : (
        <li className="bubble agent">
          <span className="bubble-who">
            Agent
            {r.outcome !== "answered" && (
              <>
                {" "}
                · <Pill>{r.status === "running" ? "stopped" : outcomeWord(r)}</Pill>
              </>
            )}
          </span>
          <span className="quote">{r.finalText || (r.status === "running" ? "It stopped before it answered." : silentRun(r))}</span>
          <span className="bubble-meta mono">
            {effort(r)} · <RunTime r={r} />
          </span>
        </li>
      )}
    </>
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
