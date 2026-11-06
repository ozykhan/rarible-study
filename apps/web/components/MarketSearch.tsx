"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { cx } from "@/lib/cx"
import { SearchIcon } from "./ui"

/**
 * The market's search field. It writes ?q= on /market a moment after typing
 * stops, so the URL stays the one place the search lives, and it follows the
 * URL when something else changes it (Clear the filters, a chip, a reading).
 * Enter writes the search at once with ?ask=1: a submitted search with words
 * nothing matches may be read by the model (lib/market.ts useUnderstanding).
 * Typing drops ?from and ?ask, so a reading never outlives the search it was for.
 * Styles: styles/market.css (.search).
 */
export function MarketSearch({ id, className }: { id?: string; className?: string }) {
  const params = useSearchParams()
  const router = useRouter()
  const path = usePathname()
  const fromUrl = params.get("q") ?? ""
  const [value, setValue] = useState(fromUrl)
  const written = useRef(fromUrl)

  useEffect(() => {
    if (fromUrl === written.current) return
    written.current = fromUrl
    setValue(fromUrl)
  }, [fromUrl])

  const write = (q: string, ask: boolean) => {
    written.current = q
    const next = new URLSearchParams(params.toString())
    if (q.trim() === "") next.delete("q")
    else next.set("q", q)
    next.delete("from")
    if (ask && q.trim() !== "") next.set("ask", "1")
    else next.delete("ask")
    const qs = next.toString()
    router.replace(qs === "" ? path : `${path}?${qs}`, { scroll: false })
  }
  const writeRef = useRef(write)
  writeRef.current = write

  useEffect(() => {
    if (value === written.current) return
    const t = setTimeout(() => {
      // Enter may have written it already.
      if (value !== written.current) writeRef.current(value, false)
    }, 250)
    return () => clearTimeout(t)
  }, [value])

  return (
    <form
      className={cx("search", className)}
      role="search"
      onSubmit={(e) => {
        e.preventDefault()
        write(value, true)
      }}
    >
      <SearchIcon />
      <input
        id={id}
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search cards, sets, graders, sellers"
        aria-label="Search the market"
        enterKeyHint="search"
      />
    </form>
  )
}
