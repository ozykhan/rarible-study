import type { Metadata } from "next"
import { Suspense } from "react"
import { MarketPage } from "./MarketPage"

export const metadata: Metadata = { title: "Market · Slabwatch" }

/** /market: every listing. Its filters live in the URL, read on the client inside Suspense. */
export default function Page() {
  return (
    <Suspense>
      <MarketPage />
    </Suspense>
  )
}
