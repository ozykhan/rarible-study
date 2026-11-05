"use client"

import { useEffect, useState, type CSSProperties, type ReactNode } from "react"
import { DevnetNotice } from "@/components/DevnetNotice"
import { HowItWorks } from "@/components/HowItWorks"
import { ListingTile } from "@/components/ListingTile"
import { Logo } from "@/components/Logo"
import { DecisionRow, PurchaseRow } from "@/components/RuleView"
import { Slab, type SlabCard } from "@/components/Slab"
import { SetCard } from "@/components/Sets"
import { StatusBar } from "@/components/StatusBar"
import { Badge, Button, Chip, Panel, Pill, Section } from "@/components/ui"
import { SETS } from "@/lib/art"
import type { Decision, Listing, Purchase, Status } from "@/lib/types"

/*
 * Every token and component, rendered with the real components and fictional
 * sample data. Token values are read from styles/tokens.css at run time, so
 * this page never drifts from it.
 */

const COLOR_GROUPS: ReadonlyArray<[string, ReadonlyArray<string>]> = [
  [
    "Canvas and surfaces",
    [
      "--bg",
      "--surface-inset",
      "--surface-sunken",
      "--surface-solid",
      "--surface-raised",
      "--surface-thumb",
      "--surface",
      "--surface-subtle",
      "--surface-shine",
      "--surface-count",
      "--glass-header",
      "--glass-footer",
      "--glass-field"
    ]
  ],
  ["Lines", ["--line", "--line-strong", "--line-glass", "--line-hover", "--line-active"]],
  ["Text", ["--ink", "--ink-soft", "--muted", "--faint", "--off"]],
  ["Accent and status", ["--accent", "--accent-ink", "--accent-2", "--ok", "--warn", "--bad"]],
  ["Set tones", ["--set-OS", "--set-TW", "--set-EF", "--set-SE", "--set-unknown"]],
  [
    "Grader labels",
    [
      "--grader-NVG-stripe",
      "--grader-NVG-label",
      "--grader-NVG-ink",
      "--grader-QSG-stripe",
      "--grader-QSG-label",
      "--grader-QSG-ink",
      "--grader-LCA-stripe",
      "--grader-LCA-label",
      "--grader-LCA-ink"
    ]
  ],
  ["Slab and card", ["--slab-fill", "--slab-edge", "--slab-window", "--card-ink", "--card-badge"]]
]

const TEXT = ["--text-display", "--text-5xl", "--text-4xl", "--text-3xl", "--text-2xl", "--text-xl", "--text-lg", "--text-base", "--text-md", "--text-sm", "--text-xs"]
const SPACE = ["--space-1", "--space-2", "--space-3", "--space-4", "--space-5", "--space-6", "--space-8", "--space-10", "--space-12", "--space-14", "--space-16", "--space-22"]
const RADII = ["--radius-xs", "--radius-sm", "--radius-md", "--radius-lg", "--radius-xl", "--radius-pill"]

/** Reads token values from the document once it is mounted. */
function useTokens(names: ReadonlyArray<string>) {
  const [values, setValues] = useState<Record<string, string>>({})
  useEffect(() => {
    const cs = getComputedStyle(document.documentElement)
    setValues(Object.fromEntries(names.map((n) => [n, cs.getPropertyValue(n).trim()])))
  }, [names])
  return values
}

const ALL_TOKENS = [...COLOR_GROUPS.flatMap(([, names]) => names), ...TEXT, ...SPACE, ...RADII]

const card = (
  cardId: string,
  cardName: string,
  setId: string,
  grader: string,
  grade: number,
  edition: string,
  finish: string
): SlabCard => {
  const set = SETS.find((s) => s.id === setId)
  return { cardId, cardName, setId, setName: set?.name ?? setId, cardNumber: cardId.slice(3), edition, finish, grader, grade }
}

const SLABS: ReadonlyArray<[SlabCard, string]> = [
  [card("EF-001", "Ashen Wyrm", "EF", "NVG", 10, "first", "holo"), "NVG 10, 1st edition holo"],
  [card("TW-007", "Tidewyrm", "TW", "QSG", 9.5, "unlimited", "holo"), "QSG 9.5, holo"],
  [card("SE-001", "Nebula Drake", "SE", "LCA", 9, "first", "reverse_holo"), "LCA 9, reverse holo"],
  [card("OS-004", "Thornmane Lion", "OS", "NVG", 8, "unlimited", "non_holo"), "NVG 8, non-holo"]
]

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()

const listing = (c: SlabCard, n: number, amountMinor: number, currency: Listing["price"]["currency"], seller: string): Listing => ({
  ...c,
  listingId: `SAMPLE-${n}`,
  certNumber: `${c.grader}1234567${n}`,
  price: { amountMinor, currency },
  sellerHandle: seller,
  title: `${c.cardName} ${c.setId} ${c.grader} ${c.grade}`,
  description: `${c.grader} ${c.grade} ${c.cardName}. Sharp corners and strong centering. Cert ${c.grader}1234567${n}.`,
  status: "active",
  listedAt: minutesAgo(n * 37)
})

const LISTINGS: ReadonlyArray<Listing> = [
  listing(SLABS[0]![0], 1, 84900, "USD", "vaultkeeper"),
  listing(SLABS[1]![0], 2, 21500, "EUR", "holo_harbor"),
  listing(SLABS[2]![0], 3, 3200000, "JPY", "foilfox"),
  listing(SLABS[3]![0], 4, 7400, "USD", "attic_finds")
]

const DECISION: Decision = {
  listingId: "SAMPLE-1",
  verdict: "match",
  decidedAt: minutesAgo(5),
  reasons: ["Card, set and grade fit the rule.", "Price is under the limit."],
  redFlags: [],
  similarity: 0.82,
  listing: LISTINGS[0]!
}

const PURCHASES: ReadonlyArray<Purchase> = [
  { id: "P1", listingId: "SAMPLE-1", actor: "collector:demo", price: LISTINGS[0]!.price, status: "proposed", reason: null, refusals: [], txSignature: null },
  { id: "P2", listingId: "SAMPLE-4", actor: "agent:demo", price: LISTINGS[3]!.price, status: "executed", reason: null, refusals: [], txSignature: null },
  { id: "P3", listingId: "SAMPLE-2", actor: "agent:demo", price: LISTINGS[1]!.price, status: "refused", reason: null, refusals: ["priced in EUR"], txSignature: null }
]

const STATUS: Status = {
  network: "devnet",
  payments: "devnet",
  readOnly: true,
  agentEnabled: false,
  modelConfigured: true,
  llm: { model: "sample", dailyCapUsd: 2, spentTodayUsd: 0.37 },
  purchaseDailyCapUsd: 500,
  faucetUsd: 2000,
  devnet: null
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="ds-group">
      <h3>{title}</h3>
      {children}
    </div>
  )
}

export function DesignSystem() {
  const v = useTokens(ALL_TOKENS)
  return (
    <>
      <DevnetNotice />
      <main id="top">
        <Section eyebrow="Slabwatch" title="Design system">
          <div className="ds-inline">
            <Logo size={48} />
            <p className="ds-intro">
              Every token and component of the wallet page, drawn by the real components with fictional sample data. Tokens live in{" "}
              <code>styles/tokens.css</code>, and <code>apps/web/DESIGN.md</code> says when to use each one.{" "}
              <a href="/">Back to the market</a>
            </p>
          </div>
        </Section>

        <Section eyebrow="Tokens" title="Color">
          {COLOR_GROUPS.map(([title, names]) => (
            <Group key={title} title={title}>
              <div className="ds-swatches">
                {names.map((n) => (
                  <div className="ds-swatch" key={n}>
                    <div className="ds-swatch-color" style={{ "--c": `var(${n})` } as CSSProperties} />
                    <div className="ds-label">
                      <code>{n}</code>
                      <span>{v[n] ?? ""}</span>
                    </div>
                  </div>
                ))}
              </div>
            </Group>
          ))}
        </Section>

        <Section eyebrow="Tokens" title="Type, space and radius">
          <Group title="Type scale (Inter; prices and numbers in JetBrains Mono)">
            <div className="ds-rows">
              {TEXT.map((n) => (
                <div className="ds-row" key={n}>
                  <span className="ds-label">
                    <code>{n}</code>
                    <span>{v[n] ?? ""}</span>
                  </span>
                  <span style={{ fontSize: `var(${n})`, fontWeight: n === "--text-display" ? 800 : 600, lineHeight: 1.1 }}>
                    Your grail card, on watch
                  </span>
                </div>
              ))}
              <div className="ds-row">
                <span className="ds-label">
                  <code>.price</code>
                  <span>mono, bold</span>
                </span>
                <span className="price">$849.00</span>
              </div>
              <div className="ds-row">
                <span className="ds-label">
                  <code>.eyebrow</code>
                  <span>caps, tracked</span>
                </span>
                <span className="eyebrow">Live on devnet</span>
              </div>
            </div>
          </Group>
          <Group title="Space (a 4px scale)">
            <div className="ds-rows">
              {SPACE.map((n) => (
                <div className="ds-row" key={n}>
                  <span className="ds-label">
                    <code>{n}</code>
                    <span>{v[n] ?? ""}</span>
                  </span>
                  <span className="ds-bar" style={{ width: `var(${n})` }} />
                </div>
              ))}
            </div>
          </Group>
          <Group title="Radius">
            <div className="ds-inline">
              {RADII.map((n) => (
                <div key={n}>
                  <div className="ds-radius" style={{ borderRadius: `var(${n})` }} />
                  <span className="ds-label">
                    <code>{n}</code>
                    <span>{v[n] ?? ""}</span>
                  </span>
                </div>
              ))}
            </div>
          </Group>
        </Section>

        <Section eyebrow="Components" title="Buttons, tags and status">
          <Group title="Button, large (page-level calls to action)">
            <div className="ds-inline">
              <Button size="lg">Connect a devnet wallet</Button>
              <Button size="lg" variant="ring">
                Browse the market
              </Button>
              <Button size="lg" disabled>
                Waiting for the wallet…
              </Button>
            </div>
          </Group>
          <Group title="Button, small (actions in panels) and link">
            <div className="ds-inline">
              <Button>Buy (sign)</Button>
              <Button variant="secondary">Ask the agent</Button>
              <Button disabled>Save rule</Button>
              <Button variant="link">show why</Button>
              <span>
                A sentence with an{" "}
                <Button variant="link" size="inline">
                  inline link
                </Button>{" "}
                in it.
              </span>
            </div>
          </Group>
          <Group title="Chip, Pill, Badge, count and LED">
            <div className="ds-inline">
              <Chip tone="warn">devnet</Chip>
              <Chip tone="warn">EUR</Chip>
              <Chip>neutral chip</Chip>
              <Pill tone="ok">active</Pill>
              <Pill tone="warn">auto-buy</Pill>
              <Pill tone="bad">refused</Pill>
              <Pill>confirm each</Pill>
              <Badge>NVG 10</Badge>
              <span className="count">36</span>
              <span className="small muted">
                <i className="led on" />
                Agent on
              </span>
              <span className="small muted">
                <i className="led" />
                Agent off
              </span>
            </div>
          </Group>
        </Section>

        <Section eyebrow="Components" title="Slab">
          <div className="ds-slabs">
            {SLABS.map(([c, caption]) => (
              <figure key={c.cardId}>
                <Slab card={c} eager />
                <figcaption>{caption}</figcaption>
              </figure>
            ))}
          </div>
        </Section>

        <Section eyebrow="Components" title="ListingTile">
          <div className="grid">
            {LISTINGS.map((l) => (
              <ListingTile key={l.listingId} l={l} />
            ))}
          </div>
        </Section>

        <Section eyebrow="Components" title="SetCard">
          <div className="set-grid">
            {SETS.map((s, i) => (
              <SetCard key={s.id} set={s} count={[9, 7, 12, 8][i]} onPick={() => {}} />
            ))}
          </div>
        </Section>

        <Section eyebrow="Components" title="Panels on the desk">
          <div className="ds-two">
            <div>
              <Panel title="Wallet">
                <dl className="facts">
                  <dt>dUSD balance</dt>
                  <dd>2,000.00 dUSD</dd>
                  <dt>Slabwatch may spend</dt>
                  <dd>1,500.00 dUSD</dd>
                </dl>
                <div className="row">
                  <Button>Get 2,000 test dUSD</Button>
                </div>
                <p className="muted small">Slabwatch pays the network fee, so the wallet needs no SOL.</p>
              </Panel>
              <Panel title="Your rules">
                <ul className="rule-list">
                  <li>
                    <button className="rule-item active">
                      <span>Ashen Wyrm, 1st edition holo, grade 9 or better</span>
                      <span className="muted small">active · confirm · budget $1,800.00</span>
                    </button>
                  </li>
                  <li>
                    <button className="rule-item">
                      <span>any water creature from Tidewild, holo</span>
                      <span className="muted small">paused · auto-buy · budget $500.00</span>
                    </button>
                  </li>
                </ul>
              </Panel>
            </div>
            <Panel>
              <p className="note">3 matches and 1 to review among the listings right now.</p>
              <div className="questions">
                <strong>Before you save, the parser asks:</strong>
                <ul>
                  <li>What is the most you want to pay?</li>
                </ul>
              </div>
              <div className="block">
                <h3>Match (1)</h3>
                <DecisionRow d={DECISION}>
                  <Button>Buy (sign)</Button>
                  <Button variant="secondary">Ask the agent</Button>
                </DecisionRow>
              </div>
              <div className="block">
                <h3>Purchases</h3>
                {PURCHASES.map((p) => (
                  <PurchaseRow key={p.id} p={p} />
                ))}
              </div>
            </Panel>
          </div>
        </Section>

        <HowItWorks />
      </main>
      <StatusBar status={STATUS} loaded />
    </>
  )
}
