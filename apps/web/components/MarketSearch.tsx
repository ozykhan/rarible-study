"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { cx } from "@/lib/cx"
import { SearchIcon } from "./ui"

/**
 * The market's search field. It writes ?q= on /market a moment after typing
 * stops, so the URL stays the one place the search lives, and it follows the
 * URL when something else changes it (Clear the filters, another field).
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

  useEffect(() => {
    if (value === written.current) return
    const t = setTimeout(() => {
      written.current = value
      const next = new URLSearchParams(params.toString())
      if (value.trim() === "") next.delete("q")
      else next.set("q", value)
      const qs = next.toString()
      router.replace(qs === "" ? path : `${path}?${qs}`, { scroll: false })
    }, 250)
    return () => clearTimeout(t)
  }, [value, params, router, path])

  return (
    <label className={cx("search", className)}>
      <SearchIcon />
      <input
        id={id}
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search cards, sets, graders, sellers"
        aria-label="Search the market"
      />
    </label>
  )
}
