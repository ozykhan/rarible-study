import { TAG_IDS } from "@slabwatch/server"
import { describe, expect, it } from "vitest"
import { searchCases } from "../src/searchDataset.ts"

describe("the labelled described searches", () => {
  it("name only real tags, each search once, and route the code cases to code", () => {
    for (const c of searchCases) {
      for (const t of [...(c.tags ?? []), ...(c.alsoOk ?? [])]) expect(TAG_IDS, `${c.q}: ${t}`).toContain(t)
      expect(c.route === "code", c.q).toBe(c.kind === "code")
    }
    expect(new Set(searchCases.map((c) => c.q.toLowerCase())).size).toBe(searchCases.length)
  })
})
