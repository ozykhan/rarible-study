import { Grade, hardChecks, money, ParsedWant, passesHardChecks } from "@slabwatch/domain"
import { describe, expect, it } from "@effect/vitest"
import { Schema } from "effect"
import { listing, rule } from "./fixtures.ts"

const decodes = (schema: Schema.Top, value: unknown) =>
  Schema.decodeUnknownExit(schema as Schema.Codec<unknown, unknown>)(value)._tag === "Success"

describe("schemas", () => {
  it("accepts grades in half steps from 1 to 10 only", () => {
    expect(decodes(Grade, 9.5)).toBe(true)
    expect(decodes(Grade, 10)).toBe(true)
    expect(decodes(Grade, 9.3)).toBe(false)
    expect(decodes(Grade, 11)).toBe(false)
    expect(decodes(Grade, 0)).toBe(false)
  })

  it("rejects a parsed want with an unknown grader or a non-positive price", () => {
    const ok = {
      setName: "Origin Set",
      cardName: "Cinderwing Drake",
      edition: "first",
      finish: "holo",
      graders: ["NVG"],
      minGrade: 9,
      maxPrice: 2000,
      currency: "USD",
      softDescription: null,
      unclear: []
    }
    expect(decodes(ParsedWant, ok)).toBe(true)
    expect(decodes(ParsedWant, { ...ok, graders: ["XYZ"] })).toBe(false)
    expect(decodes(ParsedWant, { ...ok, maxPrice: 0 })).toBe(false)
    expect(decodes(ParsedWant, { ...ok, currency: "GBP" })).toBe(false)
  })
})

describe("hardChecks", () => {
  it("passes a listing that meets every criterion", () => {
    expect(passesHardChecks(rule(), listing())).toBe(true)
  })

  it.each([
    ["edition", { edition: "unlimited" as const }],
    ["finish", { finish: "reverse_holo" as const }],
    ["grader", { grader: "QSG" as const }],
    ["grade", { grade: 8.5 }],
    ["set", { setId: "SE" }],
    ["card", { cardId: "SE-010" }],
    ["price", { price: money(200_001, "USD") }],
    ["status", { status: "sold" as const }]
  ])("fails on %s", (field, over) => {
    const checks = hardChecks(rule(), listing(over))
    expect(checks.filter((c) => !c.pass).map((c) => c.field)).toContain(field)
  })

  it("never compares prices across currencies", () => {
    // 1,500 EUR is a smaller number than 2,000 USD, but it is not a USD price.
    const checks = hardChecks(rule(), listing({ price: money(150_000, "EUR") }))
    const failed = checks.filter((c) => !c.pass).map((c) => c.field)
    expect(failed).toEqual(["currency", "price"])
  })

  it("skips criteria the rule leaves open", () => {
    const open = rule({ setId: null, cardId: null, edition: "any", finish: "any", graders: [] })
    const fields = hardChecks(open, listing()).map((c) => c.field)
    expect(fields).toEqual(["status", "currency", "price", "grade"])
  })
})
