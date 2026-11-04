import type { HardCriteria, ListingView } from "@slabwatch/domain"
import { money } from "@slabwatch/domain"

/** A clean, active NVG 9 first edition holo listing that tests change one field at a time. */
export const listing = (over: Partial<ListingView> = {}): ListingView => ({
  listingId: "T-00001",
  vaultItemId: "VLT-000001",
  setId: "OS",
  setName: "Origin Set",
  cardId: "OS-001",
  cardNumber: "001",
  cardName: "Cinderwing Drake",
  edition: "first",
  finish: "holo",
  grader: "NVG",
  grade: 9,
  certNumber: "NVG12345678",
  price: money(150_000, "USD"),
  sellerId: "S01",
  sellerHandle: "attic_finds",
  title: "Cinderwing Drake #001 Origin Set 1st Edition Holo NVG 9",
  description: "NVG 9 Cinderwing Drake from Origin Set, first edition holo. Cert NVG12345678.",
  status: "active",
  listedAt: "2026-11-04T10:00:00Z",
  ...over
})

export const rule = (over: Partial<HardCriteria> = {}): HardCriteria => ({
  setId: "OS",
  cardId: "OS-001",
  edition: "first",
  finish: "holo",
  graders: ["NVG"],
  minGrade: 9,
  maxPrice: money(200_000, "USD"),
  ...over
})
