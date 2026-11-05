import { money, type ListingView, type WatchRule } from "@slabwatch/domain"

let ruleCounter = 0

/** A rule that this exact listing satisfies, with a budget of `budgetX` times its price. */
export const ruleFor = (l: ListingView, over: Partial<WatchRule> = {}, budgetX = 2): WatchRule => {
  const n = ++ruleCounter
  return {
    id: `TR${process.pid}-${n}`,
    ownerWallet: over.ownerWallet ?? `wallet-${process.pid}-${n}`,
    rawWant: "test",
    hard: {
      setId: l.setId,
      cardId: l.cardId,
      edition: l.edition,
      finish: l.finish,
      graders: [l.grader],
      minGrade: l.grade,
      maxPrice: money(l.price.amountMinor, l.price.currency)
    },
    softDescription: null,
    budget: money(Math.round(l.price.amountMinor * budgetX), l.price.currency),
    mode: "confirm",
    status: "active",
    ...over
  }
}
