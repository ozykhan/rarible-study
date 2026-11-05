"use client"

import type { ReactNode } from "react"
import { AccountProvider, useAccount } from "@/lib/account"
import { DevnetNotice } from "./DevnetNotice"
import { Header } from "./Header"
import { StatusBar } from "./StatusBar"

/** What every marketplace route shares: the header, the devnet notice, the status bar and the account behind them. */
export function Shell({ children }: { children: ReactNode }) {
  return (
    <AccountProvider>
      <Header />
      <DevnetNotice />
      {children}
      <ShellStatus />
    </AccountProvider>
  )
}

function ShellStatus() {
  const { status, statusLoaded, token, rules } = useAccount()
  const watches = token === null ? null : { active: rules.filter((r) => r.status === "active").length, total: rules.length }
  return <StatusBar status={status} loaded={statusLoaded} watches={watches} />
}
