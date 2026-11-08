import { Schema } from "effect"
import { Money } from "./money.ts"

/** Print run. First edition cards carry a stamp and are worth more. */
export const Edition = Schema.Literals(["first", "unlimited"])
export type Edition = typeof Edition.Type

export const Finish = Schema.Literals(["holo", "non_holo", "reverse_holo"])
export type Finish = typeof Finish.Type

/**
 * Grading companies. All three are fictional; the 1 to 10 scale with half
 * grades mirrors how real graders work.
 */
export const Grader = Schema.Literals(["NVG", "QSG", "LCA"])
export type Grader = typeof Grader.Type

export const graderNames: Record<Grader, string> = {
  NVG: "Northvale Grading",
  QSG: "Quarry Slab Grading",
  LCA: "Lantern Card Authentication"
}

/** A grade from 1 to 10 in steps of 0.5. */
export const Grade = Schema.Number.check(
  Schema.isBetween({ minimum: 1, maximum: 10 }),
  Schema.isMultipleOf(0.5)
)
export type Grade = typeof Grade.Type

export const ListingStatus = Schema.Literals(["active", "sold", "withdrawn"])
export type ListingStatus = typeof ListingStatus.Type

/**
 * A listing joined with the vault item it sells and the catalog card it is.
 * Fields from the vault item and the catalog are trusted; `title` and
 * `description` are written by the seller and are not.
 */
export const ListingView = Schema.Struct({
  listingId: Schema.String,
  vaultItemId: Schema.String,
  setId: Schema.String,
  setName: Schema.String,
  cardId: Schema.String,
  cardNumber: Schema.String,
  cardName: Schema.String,
  /** Where the web app serves the card's art, or null when the card has none. */
  artPath: Schema.NullOr(Schema.String),
  edition: Edition,
  finish: Finish,
  grader: Grader,
  grade: Grade,
  certNumber: Schema.String,
  price: Money,
  sellerId: Schema.String,
  sellerHandle: Schema.String,
  title: Schema.String,
  description: Schema.String,
  status: ListingStatus,
  listedAt: Schema.String
})
export type ListingView = typeof ListingView.Type
