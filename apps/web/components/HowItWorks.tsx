import type { ReactNode } from "react"
import { Section } from "./ui"

const STEPS: ReadonlyArray<{ title: string; text: string; icon: ReactNode }> = [
  {
    title: "Find the slab",
    text: "Search by card, grader or seller, or browse by set. Every listing shows its price, the grade and the seller.",
    icon: (
      <>
        <circle cx="21" cy="21" r="12" />
        <path d="M30 30l10 10" />
      </>
    )
  },
  {
    title: "Check the grade",
    text: "Grade, grader and cert come from the vault record. Code flags a duplicate listing, a price far below market, or a grade claim that does not match.",
    icon: (
      <>
        <path d="M24 6l15 6v10c0 10-6.5 17-15 20-8.5-3-15-10-15-20V12z" />
        <path d="M17 24l5 5 9-10" />
      </>
    )
  },
  {
    title: "Sign and pay",
    text: "Press Buy now and sign the purchase in your wallet. You pay in test dUSD, and Slabwatch pays the network fee.",
    icon: (
      <>
        <path d="M30 8l10 10-20 20H10V28z" />
        <path d="M26 12l10 10M8 42h32" />
      </>
    )
  }
]

/** Three step cards on how buying works. Icons are 48px line drawings in the accent. Styles: styles/how-it-works.css. */
export function HowItWorks() {
  return (
    <Section id="how" title="How buying works">
      <div className="how-grid">
        {STEPS.map((s, i) => (
          <article className="how" key={s.title}>
            <svg
              viewBox="0 0 48 48"
              width="48"
              height="48"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinejoin="round"
              strokeLinecap="round"
              aria-hidden="true"
            >
              {s.icon}
            </svg>
            <span className="how-step">Step {i + 1}</span>
            <h3>{s.title}</h3>
            <p>{s.text}</p>
          </article>
        ))}
      </div>
    </Section>
  )
}
