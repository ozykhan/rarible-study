"use client"

import { useWallet } from "@solana/wallet-adapter-react"
import { VersionedTransaction } from "@solana/web3.js"
import { useState } from "react"
import { api } from "@/lib/api"
import { dusd, explorerTx, fromBase64, toBase64 } from "@/lib/format"
import type { Funds, Status } from "@/lib/types"
import { useAction } from "@/lib/useAction"

/**
 * The collector's dUSD and what Slabwatch may spend from it. The allowance is
 * an SPL token approval to Slabwatch's delegate, signed in the wallet; the
 * chain itself stops the delegate from spending more than that.
 */
export function WalletPanel(props: { token: string; status: Status; funds: Funds | null; onChange: () => void }) {
  const { signTransaction } = useWallet()
  const { busy, error, run } = useAction()
  const [amount, setAmount] = useState("1000")
  const [lastTx, setLastTx] = useState<string | null>(null)
  const { funds } = props

  if (props.status.payments !== "devnet") {
    return (
      <section className="card">
        <h2>Wallet</h2>
        <p className="muted">This server pays through a simulated ledger, so there is nothing to fund.</p>
      </section>
    )
  }

  const faucet = () =>
    run("faucet", async () => {
      const r = await api<{ signature: string }>("/wallet/faucet", { token: props.token, body: {} })
      setLastTx(r.signature)
      props.onChange()
    })

  const approve = () =>
    run("allowance", async () => {
      if (!signTransaction) throw new Error("this wallet cannot sign transactions")
      const usd = Number(amount)
      if (!(usd >= 0)) throw new Error("enter an amount in dUSD")
      const { transaction } = await api<{ transaction: string }>("/wallet/allowance", { token: props.token, body: { amountUsd: usd } })
      // The server built this and paid the fee; the wallet only adds its signature.
      const signed = await signTransaction(VersionedTransaction.deserialize(fromBase64(transaction)))
      const r = await api<{ signature: string }>("/wallet/submit", { token: props.token, body: { transaction: toBase64(signed.serialize()) } })
      setLastTx(r.signature)
      props.onChange()
    })

  return (
    <section className="card">
      <h2>Wallet</h2>
      <dl className="facts">
        <dt>dUSD balance</dt>
        <dd>{funds ? dusd(funds.balanceUnits) : "…"}</dd>
        <dt>Slabwatch may spend</dt>
        <dd>{funds ? dusd(funds.allowanceUnits) : "…"}</dd>
      </dl>
      <div className="row">
        <button onClick={faucet} disabled={busy !== null || props.status.readOnly}>
          {busy === "faucet" ? "Minting…" : `Get ${props.status.faucetUsd.toLocaleString("en-US")} test dUSD`}
        </button>
      </div>
      <div className="row">
        <label>
          Allowance
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" size={8} /> dUSD
        </label>
        <button onClick={approve} disabled={busy !== null || props.status.readOnly}>
          {busy === "allowance" ? "Waiting for the wallet…" : "Approve in wallet"}
        </button>
      </div>
      <p className="muted small">
        The allowance replaces any earlier one. Slabwatch pays the network fee, so the wallet needs no SOL. Set it to 0 to
        take it back.
      </p>
      {lastTx && (
        <p className="small">
          Last transaction:{" "}
          <a href={explorerTx(lastTx)} target="_blank" rel="noreferrer">
            view on devnet explorer
          </a>
        </p>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  )
}
