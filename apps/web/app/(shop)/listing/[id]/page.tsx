import type { Metadata } from "next"
import { ListingPage } from "./ListingPage"

export const metadata: Metadata = { title: "Listing · Slabwatch" }

/** /listing/[id]: one listing, read on the client. The tab's title becomes the card's name once it loads. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <ListingPage key={id} id={id} />
}
