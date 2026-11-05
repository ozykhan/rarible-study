import type { ReactNode } from "react"
import { Section } from "./ui"

const STEPS: ReadonlyArray<{ title: string; text: string; icon: ReactNode }> = [
  {
    title: "Connect and fund",
    text: "Connect a Solana wallet set to devnet and sign in. Take test dUSD from the faucet and approve an allowance for Slabwatch.",
    icon: (
      <>
        <rect x="6" y="14" width="36" height="24" rx="4" />
        <path d="M6 20h36M32 29h4" />
        <path d="M12 14l18-6 3 6" />
      </>
    )
  },
  {
    title: "Describe your want",
    text: "Write the card you want in plain words. A model turns it into a watch rule; you check every field and set a budget.",
    icon: (
      <>
        <path d="M8 10h32v20H22l-8 7v-7H8z" />
        <path d="M15 18h18M15 24h11" />
      </>
    )
  },
  {
    title: "Code checks first",
    text: "Every new listing passes hard checks and red flags in code before a model reads the seller text, which is never trusted.",
    icon: (
      <>
        <path d="M24 6l15 6v10c0 10-6.5 17-15 20-8.5-3-15-10-15-20V12z" />
        <path d="M17 24l5 5 9-10" />
      </>
    )
  },
  {
    title: "You sign every buy",
    text: "Sign each purchase, or sign one budget approval and let the agent buy within it. Code enforces the limits either way.",
    icon: (
      <>
        <path d="M30 8l10 10-20 20H10V28z" />
        <path d="M26 12l10 10M8 42h32" />
      </>
    )
  }
]

/** Four step cards for signed-out visitors. Icons are 48px line drawings in the accent. Styles: styles/how-it-works.css. */
export function HowItWorks() {
  return (
    <Section id="how" title="How it works">
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
