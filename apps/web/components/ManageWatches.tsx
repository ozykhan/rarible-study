"use client"

import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import { api } from "@/lib/api"
import { money } from "@/lib/format"
import type { Rule } from "@/lib/types"
import { useAction } from "@/lib/useAction"
import { NewRule } from "./NewRule"
import { Button, CloseIcon, Led, Pill } from "./ui"

const STATUS_WORD: Record<Rule["status"], string> = { active: "watching", paused: "paused", exhausted: "budget used", draft: "draft" }

/**
 * Manage your watches, a dialog over /agent: the form for a new watch (or for
 * changing one), then every watch with its state, Pause or Resume, and
 * Change. A watch cannot be edited or deleted on the server: Change saves a
 * new watch from the old one's words and pauses the old one, and Pause stops
 * one. `seed` fills the new watch form, for example from a tile's Watch.
 * Esc, the close button, Done or a click outside closes it; Tab stays inside.
 * Styles: styles/desk.css (.manage).
 */
export function ManageWatches(props: {
  token: string
  rules: ReadonlyArray<Rule>
  seed: string | null
  onCreated: (rule: Rule, note: string) => void
  onChanged: () => void
  onClose: () => void
}) {
  const { busy, error, run } = useAction()
  const [changing, setChanging] = useState<Rule | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const on = props.rules.filter((r) => r.status === "active").length

  // Focus moves to the want, the page behind stops scrolling, and focus goes back on close.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    box.current?.querySelector<HTMLElement>("#new-rule-want")?.focus({ preventScroll: true })
    const overflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = overflow
      before?.focus?.({ preventScroll: true })
    }
  }, [])

  const change = (r: Rule) => {
    setChanging(r)
    box.current?.querySelector(".manage-body")?.scrollTo({ top: 0 })
    requestAnimationFrame(() => box.current?.querySelector<HTMLElement>("#new-rule-want")?.focus({ preventScroll: true }))
  }

  const setStatus = (r: Rule, next: "active" | "paused") =>
    run(`status:${r.id}`, async () => {
      await api(`/rules/${r.id}/status`, { token: props.token, body: { status: next } })
      props.onChanged()
    })

  /** Esc closes, and Tab stays inside the dialog. */
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation()
      props.onClose()
    }
    if (e.key !== "Tab" || box.current === null) return
    const focusable = [...box.current.querySelectorAll<HTMLElement>("a[href], button:not(:disabled), input, textarea")]
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (first === undefined || last === undefined) return
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="manage-overlay" onKeyDown={onKeyDown} onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div ref={box} className="manage" role="dialog" aria-modal="true" aria-labelledby="manage-title">
        <div className="manage-head">
          <h2 id="manage-title">Manage your watches</h2>
          <span className="mono muted small">
            {on} of {props.rules.length} on
          </span>
          <button type="button" className="btn-close" aria-label="Close" onClick={props.onClose}>
            <CloseIcon />
          </button>
        </div>

        <div className="manage-body">
          <NewRule
            key={changing?.id ?? "new"}
            token={props.token}
            title={changing ? "Change this watch" : "New watch"}
            {...(changing ? { seed: changing.rawWant, replaces: changing } : props.seed !== null ? { seed: props.seed } : {})}
            onCreated={props.onCreated}
          />
          {changing && (
            <p className="manage-changing muted small">
              Changing &ldquo;{changing.rawWant}&rdquo;.{" "}
              <Button variant="link" size="inline" onClick={() => setChanging(null)}>
                Write a new watch instead
              </Button>
            </p>
          )}

          {error && <p className="error">{error}</p>}

          {props.rules.length === 0 ? (
            <p className="empty small">No watches yet. Describe a card above.</p>
          ) : (
            <ul className="manage-list">
              {props.rules.map((r) => (
                <li key={r.id} className="manage-row">
                  <Led on={r.status === "active"} />
                  <span className="manage-text">
                    <span>{r.rawWant}</span>
                    <span className="mono muted small">
                      up to {money(r.hard.maxPrice)} · budget {money(r.budget)} ·{" "}
                      {r.mode === "auto" ? "buys without asking" : "asks before buying"}
                    </span>
                  </span>
                  <span className="manage-actions">
                    <Pill tone={r.status === "active" ? "ok" : null}>{STATUS_WORD[r.status]}</Pill>
                    {r.status === "active" && (
                      <Button variant="secondary" onClick={() => setStatus(r, "paused")} disabled={busy !== null}>
                        {busy === `status:${r.id}` ? "Pausing…" : "Pause"}
                      </Button>
                    )}
                    {r.status === "paused" && (
                      <Button variant="secondary" onClick={() => setStatus(r, "active")} disabled={busy !== null}>
                        {busy === `status:${r.id}` ? "Resuming…" : "Resume"}
                      </Button>
                    )}
                    <Button variant="link" onClick={() => change(r)} disabled={busy !== null}>
                      Change
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="manage-foot">
          <span className="muted small">
            A watch cannot be edited or deleted. Change saves a new watch and pauses the old one, and Pause stops one.
          </span>
          <Button variant="secondary" onClick={props.onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  )
}
