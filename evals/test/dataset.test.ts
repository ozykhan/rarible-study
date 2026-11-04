import { hardChecks, money, type ListingView, type MatchDecision } from "@slabwatch/domain"
import { cardById, sellers, setById } from "@slabwatch/seed"
import { describe, expect, it } from "vitest"
import { evalListings, evalRules, type EvalListing, type RuleId } from "../src/dataset.ts"
import { computeMetrics, pairResults } from "../src/metrics.ts"

const view = (e: EvalListing): ListingView => {
  const { listing: l, vaultItem: v } = e.labelled
  const c = cardById(v.cardId)
  return {
    listingId: l.id,
    vaultItemId: v.id,
    setId: c.setId,
    setName: setById(c.setId).name,
    cardId: c.id,
    cardNumber: c.number,
    cardName: c.name,
    edition: v.edition,
    finish: v.finish,
    grader: v.grader,
    grade: v.grade,
    certNumber: v.certNumber,
    price: money(l.priceMinor, l.currency),
    sellerId: l.sellerId,
    sellerHandle: sellers.find((s) => s.id === l.sellerId)?.handle ?? "",
    title: l.title,
    description: l.description,
    status: l.status,
    listedAt: "2026-11-04T00:00:00Z"
  }
}

const byId = new Map(evalListings.map((e) => [e.labelled.listing.id, e]))

describe("eval labels", () => {
  it("has the advertised size and unique ids", () => {
    expect(evalRules).toHaveLength(5)
    expect(byId.size).toBe(evalListings.length)
    expect(evalListings.length).toBeGreaterThanOrEqual(50)
  })

  it("only labels a listing a match when it passes that rule's hard criteria", () => {
    for (const e of evalListings) {
      for (const ruleId of e.matches) {
        const rule = evalRules.find((r) => r.rule.id === ruleId)?.rule
        if (rule === undefined) throw new Error(`unknown rule ${ruleId}`)
        const failed = hardChecks(rule.hard, view(e)).filter((c) => !c.pass)
        expect(failed, `${e.labelled.listing.id} labelled ${ruleId}`).toEqual([])
      }
    }
  })

  it("gives every injected listing a clean twin that differs only in the description", () => {
    const injected = evalListings.filter((e) => e.labelled.trap === "injection")
    expect(injected.length).toBeGreaterThanOrEqual(5)
    for (const e of injected) {
      const twin = e.twin === null ? undefined : byId.get(e.twin)
      expect(twin, e.labelled.listing.id).toBeDefined()
      if (twin === undefined) continue
      const { id: _a, description: da, vaultItemId: _va, ...a } = e.labelled.listing
      const { id: _b, description: db, vaultItemId: _vb, ...b } = twin.labelled.listing
      expect(a).toEqual(b)
      expect(da).not.toEqual(db)
      expect({ ...e.labelled.vaultItem, id: "", certNumber: "" }).toEqual({ ...twin.labelled.vaultItem, id: "", certNumber: "" })
    }
  })
})

describe("computeMetrics", () => {
  const ruleIds: ReadonlyArray<RuleId> = ["R1"]
  const one = (id: string, matches: ReadonlyArray<RuleId>, twin: string | null, trap: "none" | "injection") =>
    ({
      labelled: { trap, vaultItem: {}, listing: { id } },
      matches,
      twin
    }) as unknown as EvalListing
  const decision = (listingId: string, verdict: MatchDecision["verdict"]): MatchDecision => ({
    ruleId: "R1",
    listingId,
    pipelineVersion: "t",
    verdict,
    decidedAt: "judge",
    fieldChecks: [],
    redFlags: [],
    similarity: null,
    judge: null,
    reasons: []
  })

  it("counts an injected listing that does better than its twin as harmful", () => {
    const listings = [one("A", ["R1"], null, "none"), one("B", [], "C", "injection"), one("C", [], null, "none")]
    const decisions = [decision("A", "match"), decision("B", "match"), decision("C", "reject")]
    const m = computeMetrics(ruleIds, listings, pairResults(ruleIds, listings, decisions))
    expect(m).toMatchObject({ truePositives: 1, falsePositives: 1, falseNegatives: 0, precision: 0.5, recall: 1 })
    expect(m.injection).toMatchObject({ pairs: 1, changed: 1, harmful: 1, stoppedByCode: 0 })
    expect(m.trapListingsMatched).toBe(1)
  })

  it("counts an injected listing the hard filter dropped as stopped by code", () => {
    const listings = [one("B", [], "C", "injection"), one("C", [], null, "none")]
    const m = computeMetrics(ruleIds, listings, pairResults(ruleIds, listings, []))
    expect(m.injection).toMatchObject({ pairs: 0, stoppedByCode: 1, harmful: 0 })
  })
})
