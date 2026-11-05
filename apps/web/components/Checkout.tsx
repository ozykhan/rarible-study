"use client"

import { useWallet } from "@solana/wallet-adapter-react"
import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import { gradeWord, setTheme } from "@/lib/art"
import { dusd, explorerTx, money, redFlagText, variant } from "@/lib/format"
import { proposeDirect, signAndPay } from "@/lib/purchase"
import type { Funds, Listing, RedFlag, Status } from "@/lib/types"
import { useAction } from "@/lib/useAction"
import { approveAllowance, getTestDusd } from "@/lib/wallet"
import { Slab } from "./Slab"
import { Button, Chip, CloseIcon, Pill } from "./ui"

const FLAG_LABEL: Record<RedFlag, string> = {
  duplicate_vault_item: "Duplicate vault item",
  price_far_below_market: "Far below market",
  grade_claim_mismatch: "Grade claim mismatch"
}

/** What stands between the collector and "Sign and pay", in order. */
export type CheckoutStep =
  | { readonly kind: "blocked"; readonly why: string }
  | { readonly kind: "connect" }
  | { readonly kind: "signin" }
  | { readonly kind: "loading" }
  | { readonly kind: "faucet"; readonly balance: number }
  | { readonly kind: "allowance"; readonly current: number }
  | { readonly kind: "pay" }

export const checkoutStep = (p: {
  listing: Listing
  status: Status | null
  wallet: string | null
  token: string | null
  funds: Funds | null
}): CheckoutStep => {
  const { status, listing } = p
  const units = listing.payUnits ?? 0
  if (status === null) return { kind: "blocked", why: "The backend is not reachable right now, so nothing can be bought." }
  if (status.readOnly) return { kind: "blocked", why: "This demo is read-only: purchases are turned off." }
  if ((listing.redFlags ?? []).length > 0) {
    return { kind: "blocked", why: "Slabwatch does not sell a flagged listing directly. Watches skip it for the same reason." }
  }
  if (units > status.purchaseDailyCapUsd * 100) {
    return { kind: "blocked", why: `This costs more than the demo's daily cap of ${dusd(status.purchaseDailyCapUsd * 100)} per wallet.` }
  }
  if (p.wallet === null) return { kind: "connect" }
  if (p.token === null) return { kind: "signin" }
  if (status.payments !== "devnet") return { kind: "pay" }
  if (p.funds === null) return { kind: "loading" }
  const balance = Number(p.funds.balanceUnits)
  if (balance < units) {
    if (balance + status.faucetUsd * 100 < units) {
      return { kind: "blocked", why: `This costs more than your ${dusd(balance)} plus the day's ${dusd(status.faucetUsd * 100)} of test dUSD.` }
    }
    return { kind: "faucet", balance }
  }
  const allowance = Number(p.funds.allowanceUnits)
  if (allowance < units) return { kind: "allowance", current: allowance }
  return { kind: "pay" }
}

const actionLabel = (step: CheckoutStep, units: number, faucetUsd: number) => {
  switch (step.kind) {
    case "connect":
      return "Connect wallet"
    case "signin":
      return "Sign in with your wallet"
    case "loading":
      return "Checking your wallet…"
    case "faucet":
      return `Get ${faucetUsd.toLocaleString("en-US")} test dUSD`
    case "allowance":
      return `Approve ${dusd(units)}`
    default:
      return "Sign and pay"
  }
}

const hintText = (step: CheckoutStep, units: number) => {
  switch (step.kind) {
    case "blocked":
      return step.why
    case "connect":
      return "Connect a Solana wallet to buy. Slabwatch runs on devnet, with test tokens only."
    case "signin":
      return "Sign a one-time text to sign in. It costs nothing and moves no tokens."
    case "loading":
      return "Reading your dUSD balance on devnet."
    case "faucet":
      return `Your wallet holds ${dusd(step.balance)}. Get the day's free test dUSD first.`
    case "allowance":
      return step.current > 0
        ? `Let Slabwatch spend ${dusd(units)} from your wallet. This replaces the ${dusd(step.current)} it may spend now.`
        : `Let Slabwatch spend ${dusd(units)} from your wallet. Slabwatch pays the network fee.`
    case "pay":
      return "You sign this one purchase in your wallet. Code checks it again before paying."
  }
}

/**
 * What the checkout shows, with no state of its own: the slab and its facts,
 * the code's checks, the total, and the one action for the current step. The
 * /design page draws each state with it; `Checkout` runs it.
 */
export function CheckoutView(props: {
  listing: Listing
  step: CheckoutStep
  /** "dialog" adds the close button and the dialog role; "panel" sits in the page. */
  as: "dialog" | "panel"
  payments: Status["payments"] | null
  faucetUsd: number
  /** The step in progress: "faucet" while minting, anything else while the wallet is open. */
  busy: string | null
  /** The payment's transaction signature once bought. */
  paid: string | null
  refused: ReadonlyArray<string> | null
  error: string | null
  onAct: () => void
  onClose: () => void
}) {
  const { listing: l, step, busy } = props
  const units = l.payUnits ?? 0
  const flags = l.redFlags ?? []
  const theme = setTheme(l)
  const locked = busy !== null
  const blocked = step.kind === "blocked"

  return (
    <>
      <div className="checkout-head">
        <h2 id={props.as === "dialog" ? "checkout-title" : undefined}>Buy {l.cardName}</h2>
        {props.as === "dialog" && (
          <button type="button" className="btn-close" aria-label="Close" onClick={props.onClose} disabled={locked}>
            <CloseIcon />
          </button>
        )}
      </div>

      <div className="checkout-card">
        <div className="checkout-slab">
          <Slab card={l} eager />
        </div>
        <dl className="facts checkout-facts">
          <dt>Card</dt>
          <dd>
            {theme?.year ?? ""} {l.setName} #{l.cardNumber}, {variant(l)}
          </dd>
          <dt>Grade</dt>
          <dd>
            {l.grader} {l.grade}, {gradeWord(l.grade)}
          </dd>
          <dt>Cert</dt>
          <dd>{l.certNumber}</dd>
          <dt>Seller</dt>
          <dd>@{l.sellerHandle}</dd>
        </dl>
      </div>

      <div className="checkout-checks">
        <span className="pills">
          {flags.length === 0 ? (
            <Pill tone="ok">No red flags</Pill>
          ) : (
            flags.map((f) => (
              <Pill key={f} tone="warn">
                {FLAG_LABEL[f]}
              </Pill>
            ))
          )}
        </span>
        <p className="muted small">
          {flags.length === 0
            ? "Grade, grader and cert come from the vault record, and the code checks found no red flags."
            : `${flags.map((f) => redFlagText[f]).join(". ")}.`}
        </p>
      </div>

      <dl className="facts checkout-facts checkout-total">
        <dt>Price</dt>
        <dd>
          {l.price.currency !== "USD" && <Chip tone="warn">{l.price.currency}</Chip>} {money(l.price)}
        </dd>
        <dt>Network fee</dt>
        <dd>paid by Slabwatch</dd>
        <dt className="total">Total</dt>
        <dd className="total">{dusd(units)}</dd>
      </dl>

      {props.paid !== null ? (
        <>
          <p className="note" role="status">
            Bought. You paid {dusd(units)} on devnet for cert {l.certNumber}.
          </p>
          <div className="checkout-actions">
            {props.payments === "devnet" && (
              <a className="btn btn-lg btn-secondary" href={explorerTx(props.paid)} target="_blank" rel="noreferrer">
                View the payment
              </a>
            )}
            <Button size="lg" onClick={props.onClose}>
              Keep browsing
            </Button>
          </div>
        </>
      ) : (
        <>
          {!blocked && <p className="checkout-test">dUSD is a test token with no value.</p>}
          <p className={blocked ? "checkout-test" : "muted small"}>{hintText(step, units)}</p>
          {props.refused && <p className="error">Refused by code: {props.refused.join("; ")}</p>}
          {props.error && <p className="error">{props.error}</p>}
          <div className="checkout-actions">
            <Button variant="secondary" size="lg" onClick={props.onClose} disabled={locked}>
              {blocked ? "Keep browsing" : "Cancel"}
            </Button>
            {!blocked && (
              <Button size="lg" onClick={props.onAct} disabled={locked || step.kind === "loading"}>
                {busy === "faucet" ? "Minting test dUSD…" : locked ? "Waiting for the wallet…" : actionLabel(step, units, props.faucetUsd)}
              </Button>
            )}
          </div>
        </>
      )}
    </>
  )
}

/**
 * Buying one listing straight from the market, with no watch rule and no
 * agent. The main button walks through whatever is still missing: connect a
 * wallet, sign in, get test dUSD, approve what Slabwatch may spend, then sign
 * this one purchase. Code checks it again before paying, and a red-flagged
 * listing cannot be bought here at all.
 *
 * It is a dialog over the page, and a bottom sheet on a phone. It sits under
 * the wallet picker, so Connect wallet opens over it, and it cannot be closed
 * while the wallet is open. Styles: styles/checkout.css.
 */
export function Checkout(props: {
  listing: Listing
  status: Status | null
  wallet: string | null
  token: string | null
  funds: Funds | null
  onConnect: () => void
  signIn: () => Promise<void>
  signText: (message: string) => Promise<string>
  /** Reloads the wallet's funds after the faucet, an allowance or a payment. */
  onFunds: () => Promise<void>
  onBought: (l: Listing) => void
  onClose: () => void
}) {
  const { listing: l, status, token } = props
  const { signTransaction } = useWallet()
  const { busy, error, run } = useAction()
  const [paid, setPaid] = useState<string | null>(null)
  const [refused, setRefused] = useState<ReadonlyArray<string> | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const units = l.payUnits ?? 0
  const step = checkoutStep(props)

  // Focus moves into the dialog, the page behind it stops scrolling, and focus goes back on close.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    const actions = box.current?.querySelector(".checkout-actions")
    ;(actions?.querySelector<HTMLElement>(".btn-primary:not(:disabled)") ?? actions?.querySelector<HTMLElement>(".btn"))?.focus()
    const overflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = overflow
      before?.focus?.()
    }
  }, [])

  const close = () => {
    if (busy === null) props.onClose()
  }

  /** Esc closes, and Tab stays inside. The wallet picker is outside this tree, so its keys never land here. */
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation()
      close()
    }
    if (e.key !== "Tab" || box.current === null) return
    const focusable = [...box.current.querySelectorAll<HTMLElement>("a[href], button:not(:disabled)")]
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (first === undefined || last === undefined) return
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  const pay = () =>
    run("pay", async () => {
      if (token === null) return
      setRefused(null)
      const proposed = await proposeDirect(token, l.listingId)
      if (proposed.status === "refused") return setRefused(proposed.refusals)
      const result = await signAndPay(token, proposed.purchaseId, props.signText)
      if (result.status === "refused") return setRefused(result.refusals)
      if (result.status === "failed") throw new Error(`The payment failed: ${result.error}`)
      if (result.status === "awaiting_collector_approval") throw new Error("The wallet's signature did not arrive. Try again.")
      setPaid(result.txSignature)
      props.onBought(l)
      await props.onFunds()
    })

  const act = () => {
    switch (step.kind) {
      case "connect":
        return props.onConnect()
      case "signin":
        return void run("signin", props.signIn)
      case "faucet":
        return void run("faucet", async () => {
          if (token !== null) await getTestDusd(token)
          await props.onFunds()
        })
      case "allowance":
        return void run("allowance", async () => {
          if (token !== null) await approveAllowance(token, units / 100, signTransaction)
          await props.onFunds()
        })
      case "pay":
        return void pay()
    }
  }

  return (
    <div className="checkout-overlay" onKeyDown={onKeyDown} onClick={(e) => e.target === e.currentTarget && close()}>
      <div ref={box} className="checkout" role="dialog" aria-modal="true" aria-labelledby="checkout-title">
        <CheckoutView
          listing={l}
          step={step}
          as="dialog"
          payments={status?.payments ?? null}
          faucetUsd={status?.faucetUsd ?? 0}
          busy={busy}
          paid={paid}
          refused={refused}
          error={error}
          onAct={act}
          onClose={close}
        />
      </div>
    </div>
  )
}
