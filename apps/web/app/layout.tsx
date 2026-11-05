import type { Metadata } from "next"
import type { ReactNode } from "react"
import { Providers } from "./providers"
import "./globals.css"

export const metadata: Metadata = {
  title: "Slabwatch",
  description: "A study project: an AI shopping agent for a mock marketplace of graded cards, on Solana devnet."
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
