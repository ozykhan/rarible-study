import type { Metadata, Viewport } from "next"
import { Inter, JetBrains_Mono } from "next/font/google"
import type { ReactNode } from "react"
import { Providers } from "./providers"
import "./globals.css"

const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" })
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" })

export const metadata: Metadata = {
  title: "Slabwatch",
  description: "A study project: a mock marketplace of graded cards on Solana devnet, with an optional AI agent that watches for the card you want."
}

export const viewport: Viewport = { themeColor: "#080808", colorScheme: "dark" }

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
