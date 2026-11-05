"use client"

import { useWallet } from "@solana/wallet-adapter-react"
import { useState } from "react"
import { dusd, explorerAddress, explorerTx, short } from "@/lib/format"
import type { Funds, Status } from "@/lib/types"
import { useAction } from "@/lib/useAction"
import { approveAllowance, getTestDusd } from "@/lib/wallet"
import { Button, Panel } from "./ui"

/**
 * The collector's dUSD, what Slabwatch may spend from it, and the address. The allowance is
 * an SPL token approval to Slabwatch's delegate, signed in the wallet; the
 * chain itself stops the delegate from spending more than that.
 * Styles: styles/ui.css (.panel) and styles/desk.css (.facts, .row).
 */
export function WalletPanel(props: { token: string; status: Status; funds: Funds | null; onChange: () => void }) {
  const { signTransaction } = useWallet()
  const { busy, error, run } = useAction()
  const [amount, setAmount] = useState("1000")
  const [lastTx, setLastTx] = useState<string | null>(null)
  const { funds } = props

  if (props.status.payments !== "devnet") {
    return (
      <Panel title="Wallet">
        <p className="muted">This server pays through a simulated ledger, so there is nothing to fund.</p>
      </Panel>
    )
  }

  const faucet = () =>
    run("faucet", async () => {
      setLastTx(await getTestDusd(props.token))
      props.onChange()
    })

  const approve = () =>
    run("allowance", async () => {
      setLastTx(await approveAllowance(props.token, Number(amount), signTransaction))
      props.onChange()
    })

  return (
    <Panel title="Wallet">
      <dl className="facts">
        <dt>dUSD balance</dt>
        <dd>{funds ? dusd(funds.balanceUnits) : "…"}</dd>
        <dt>Slabwatch may spend</dt>
        <dd>{funds ? dusd(funds.allowanceUnits) : "…"}</dd>
        {funds && (
          <>
            <dt>Address</dt>
            <dd>
              <a href={explorerAddress(funds.wallet)} target="_blank" rel="noreferrer">
                {short(funds.wallet, 4)}
              </a>
            </dd>
          </>
        )}
      </dl>
      <div className="row">
        <Button onClick={faucet} disabled={busy !== null || props.status.readOnly}>
          {busy === "faucet" ? "Minting…" : `Get ${props.status.faucetUsd.toLocaleString("en-US")} test dUSD`}
        </Button>
      </div>
      <div className="row">
        <label>
          Allowance
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" size={8} /> dUSD
        </label>
        <Button onClick={approve} disabled={busy !== null || props.status.readOnly}>
          {busy === "allowance" ? "Waiting for the wallet…" : "Approve in wallet"}
        </Button>
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
    </Panel>
  )
}
