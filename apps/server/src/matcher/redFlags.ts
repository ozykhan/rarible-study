import type { ListingView, RedFlag } from "@slabwatch/domain"
import { toUsdCents } from "@slabwatch/seed"
import type { MarketFacts } from "../catalog/CatalogRepo.ts"

/** Price below this share of the recent median sale is "too good to be true". */
export const TOO_CHEAP_RATIO = 0.4

const GRADER_CLAIM = /\b(NVG|QSG|LCA)\s*(10|[1-9](?:\.5)?)\b/gi
const GEM_MINT_CLAIM = /\bgem\s*mint\s*(?:NVG|QSG|LCA)?\s*(10|[1-9](?:\.5)?)\b/gi

/**
 * Grade or grader claims in seller text that disagree with the vault record.
 * "NVG 9" in the text of an NVG 9 item is fine; "Gem mint NVG 10" on an NVG 8
 * is not.
 */
export const gradeClaimMismatch = (l: Pick<ListingView, "title" | "description" | "grade" | "grader">): boolean => {
  const text = `${l.title} ${l.description}`
  for (const m of text.matchAll(GRADER_CLAIM)) {
    const grader = (m[1] ?? "").toUpperCase()
    if (grader !== l.grader || Number(m[2]) !== l.grade) return true
  }
  for (const m of text.matchAll(GEM_MINT_CLAIM)) {
    if (Number(m[1]) !== l.grade) return true
  }
  return false
}

/** Warnings computed by code, before any model sees the listing. */
export const redFlagsFor = (l: ListingView, facts: MarketFacts | undefined): ReadonlyArray<RedFlag> => {
  const flags: Array<RedFlag> = []
  if (facts && facts.activeListingsForVaultItem > 1) flags.push("duplicate_vault_item")
  if (facts && facts.medianSaleUsdCents !== null && toUsdCents(l.price.amountMinor, l.price.currency) < TOO_CHEAP_RATIO * facts.medianSaleUsdCents) {
    flags.push("price_far_below_market")
  }
  if (gradeClaimMismatch(l)) flags.push("grade_claim_mismatch")
  return flags
}

export const describeFlag: Record<RedFlag, string> = {
  duplicate_vault_item: "the same vault item has another active listing",
  price_far_below_market: `the price is under ${TOO_CHEAP_RATIO * 100}% of recent sales for this card, variant and grade`,
  grade_claim_mismatch: "the seller's text claims a grade or grader that differs from the vault record"
}
