/** A small seeded PRNG (mulberry32) so seed data is the same on every machine. */
export interface Rng {
  readonly next: () => number
  readonly int: (min: number, max: number) => number
  readonly pick: <A>(items: ReadonlyArray<A>) => A
  readonly weighted: <A>(items: ReadonlyArray<readonly [A, number]>) => A
  readonly chance: (p: number) => boolean
}

export const makeRng = (seed: number): Rng => {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1))
  const pick = <A>(items: ReadonlyArray<A>): A => {
    const item = items[Math.floor(next() * items.length)]
    if (item === undefined) throw new Error("pick from an empty list")
    return item
  }
  const weighted = <A>(items: ReadonlyArray<readonly [A, number]>): A => {
    const total = items.reduce((s, [, w]) => s + w, 0)
    let r = next() * total
    for (const [item, w] of items) {
      r -= w
      if (r < 0) return item
    }
    const last = items[items.length - 1]
    if (last === undefined) throw new Error("weighted pick from an empty list")
    return last[0]
  }
  return { next, int, pick, weighted, chance: (p) => next() < p }
}
