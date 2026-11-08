"use client"

import { useEffect, useState, type CSSProperties, type ReactNode } from "react"
import { CheckoutView, type CheckoutStep } from "@/components/Checkout"
import { AgentBand } from "@/components/AgentBand"
import { AgentStrip } from "@/components/AgentStrip"
import { DevnetNotice } from "@/components/DevnetNotice"
import { Footer } from "@/components/Footer"
import { Graders } from "@/components/Graders"
import { HowItWorks } from "@/components/HowItWorks"
import { ListingDetail } from "@/components/ListingDetail"
import { ListingTile } from "@/components/ListingTile"
import { Logo } from "@/components/Logo"
import { AgentLimits } from "@/components/AgentLimits"
import { RuleList } from "@/components/RuleList"
import { canBuy, FoundCard, foundItems } from "@/components/FoundForYou"
import { type ChatControls, PurchaseRow, RuleChat, SkippedRow } from "@/components/RuleView"
import { Slab, type SlabCard } from "@/components/Slab"
import { SetCard } from "@/components/Sets"
import { StatusBar } from "@/components/StatusBar"
import { Badge, Button, Chip, Panel, Pill, Section } from "@/components/ui"
import { SETS } from "@/lib/art"
import { money } from "@/lib/format"
import type { Decision, Listing, Purchase, Rule, RuleDetail, Status } from "@/lib/types"

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
  ["Lines", ["--line", "--line-strong", "--line-control", "--line-glass", "--line-hover", "--line-active"]],
  ["Text", ["--ink", "--ink-soft", "--muted", "--faint", "--off"]],
  ["Accent and status", ["--accent", "--accent-ink", "--accent-2", "--ok", "--warn", "--bad"]],
  ["Set tones", ["--set-OS", "--set-TW", "--set-EF", "--set-SE", "--set-FV", "--set-HR", "--set-SK", "--set-DS", "--set-unknown"]],
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
const SPACE = [
  "--space-0-5",
  "--space-1",
  "--space-1-5",
  "--space-2",
  "--space-2-5",
  "--space-3",
  "--space-3-5",
  "--space-4",
  "--space-4-5",
  "--space-5",
  "--space-6",
  "--space-8",
  "--space-10",
  "--space-12",
  "--space-14",
  "--space-16",
  "--space-18",
  "--space-22"
]
const RADII = ["--radius-xs", "--radius-thumb", "--radius-sm", "--radius-md", "--radius-lg", "--radius-xl", "--radius-pill"]

/** Reads token values from the document once it is mounted. */
function useTokens(names: ReadonlyArray<string>) {
  const [values, setValues] = useState<Record<string, string>>({})
  useEffect(() => {
    const cs = getComputedStyle(document.documentElement)
    setValues(Object.fromEntries(names.map((n) => [n, cs.getPropertyValue(n).trim()])))
  }, [names])
  return values
}

const GRADIENTS = ["--gradient-ring", "--gradient-holo"]
const VALUE_GROUPS: ReadonlyArray<[string, ReadonlyArray<string>]> = [
  ["Weight", ["--weight-medium", "--weight-semibold", "--weight-bold", "--weight-black"]],
  ["Line height", ["--leading-display", "--leading-body", "--leading-lede", "--leading-relaxed"]],
  ["Tracking", ["--tracking-display", "--tracking-brand", "--tracking-heading", "--tracking-snug", "--tracking-caps"]],
  ["Shadow and focus", ["--focus-ring", "--shadow-focus", "--shadow-card", "--shadow-float", "--glow-ok", "--text-shadow-display", "--text-shadow-lede"]],
  ["Blur", ["--blur-sm", "--blur-md", "--blur-lg"]],
  ["Motion", ["--ease", "--duration-fast", "--duration-base", "--duration-slow", "--duration-slower"]],
  ["Layout", ["--wide", "--gutter", "--header-height", "--statusbar-height", "--scroll-offset", "--rail", "--tile-min", "--z-header", "--z-statusbar"]]
]

const ALL_TOKENS = [
  ...COLOR_GROUPS.flatMap(([, names]) => names),
  ...TEXT,
  ...SPACE,
  ...RADII,
  ...GRADIENTS,
  ...VALUE_GROUPS.flatMap(([, names]) => names)
]

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
  { ...listing(SLABS[0]![0], 1, 84900, "USD", "vaultkeeper"), payUnits: 84900, redFlags: [] },
  { ...listing(SLABS[1]![0], 2, 21500, "EUR", "holo_harbor"), payUnits: 23370, redFlags: [] },
  { ...listing(SLABS[2]![0], 3, 3200000, "JPY", "foilfox"), payUnits: 2133333, redFlags: [] },
  { ...listing(SLABS[3]![0], 4, 7400, "USD", "attic_finds"), payUnits: 7400, redFlags: ["price_far_below_market"] }
]

/** Each checkout state, drawn by CheckoutView with no wallet or API behind it. */
const CHECKOUTS: ReadonlyArray<{
  caption: string
  listing: Listing
  step: CheckoutStep
  busy?: string
  paid?: string
  balance?: number
}> = [
  { caption: "Ready: one signature left", listing: LISTINGS[0]!, step: { kind: "pay" }, balance: 200_000 },
  { caption: "The wallet is open", listing: LISTINGS[0]!, step: { kind: "pay" }, busy: "pay" },
  { caption: "A step still missing", listing: LISTINGS[1]!, step: { kind: "allowance", current: 5000 } },
  {
    caption: "A red-flagged listing",
    listing: LISTINGS[3]!,
    step: { kind: "blocked", why: "Slabwatch does not sell a flagged listing directly. Watches skip it for the same reason." }
  },
  { caption: "Bought", listing: LISTINGS[0]!, step: { kind: "pay" }, paid: "sample" }
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

const rule = (id: string, rawWant: string, status: Rule["status"], mode: Rule["mode"], amountMinor: number): Rule => {
  const budget = { amountMinor, currency: "USD" as const }
  return {
    id,
    ownerWallet: null,
    rawWant,
    hard: { setId: null, cardId: null, edition: "any", finish: "any", graders: [], minGrade: 9, maxPrice: budget },
    softDescription: null,
    budget,
    mode,
    status,
    setName: null,
    cardName: null
  }
}

const RULES: ReadonlyArray<Rule> = [
  rule("r1", "Ashen Wyrm, 1st edition holo, grade 9 or better", "active", "confirm", 180000),
  rule("r2", "any water creature from Tidewild, holo", "paused", "auto", 50000)
]

const SKIPPED: ReadonlyArray<Decision> = [
  { ...DECISION, listingId: "SAMPLE-2", verdict: "reject", decidedAt: minutesAgo(12), reasons: ["Priced in EUR, above the top price."], listing: LISTINGS[1]! },
  { ...DECISION, listingId: "SAMPLE-4", verdict: "reject", decidedAt: minutesAgo(40), reasons: ["Price far below market: a red flag."], listing: LISTINGS[3]! }
]

/** A watch with one agent run and one chat turn, as RuleChat shows them. */
const DETAIL: RuleDetail = {
  rule: RULES[0]!,
  approvals: [],
  decisions: [DECISION, ...SKIPPED],
  purchases: [],
  runs: [
    {
      id: "run1",
      listingId: "SAMPLE-1",
      trigger: "new_match",
      status: "done",
      outcome: "proposed",
      modelCalls: 3,
      toolCalls: 4,
      question: null,
      startedAt: minutesAgo(4),
      finalText: "It matches every condition and the price is under your limit. I proposed the buy; it waits for your signature."
    },
    {
      id: "run2",
      listingId: null,
      trigger: "chat",
      status: "done",
      outcome: "answered",
      modelCalls: 2,
      toolCalls: 1,
      question: "Is that a fair price?",
      startedAt: minutesAgo(2),
      finalText: "Yes. The last five sales of this exact grade had a median of 702.00, so 689.00 is a little under it."
    }
  ]
}

/**
 * Found for you's kinds of card: a purchase waiting for a signature, a listing to review, a match, and
 * last a purchase whose listing left the market, which has no Sign and pay.
 */
const FOUND = foundItems({
  ...DETAIL,
  purchases: [
    {
      ...PURCHASES[0]!,
      id: "P0",
      listingId: "SAMPLE-5",
      price: { amountMinor: 15800, currency: "USD" },
      listing: { ...listing(SLABS[3]![0], 5, 15800, "USD", "foilfox"), status: "withdrawn", payUnits: 15800, redFlags: [] }
    },
    PURCHASES[0]!
  ],
  decisions: [
    DECISION,
    {
      ...DECISION,
      listingId: "SAMPLE-3",
      verdict: "needs_review",
      reasons: ["The seller's text speaks to automated buyers.", "Look at it before you sign."],
      listing: LISTINGS[2]!
    },
    { ...DECISION, listingId: "SAMPLE-2", reasons: ["Every field passes and the judge agrees."], listing: LISTINGS[1]! }
  ]
})

/** The chat box with nothing on its way, as the design page shows it. */
const CHAT: ChatControls = { ask: async () => false, asked: null, error: null }

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
              Every token and component of the marketplace, drawn by the real components with fictional sample data. Tokens live in{" "}
              <code>styles/tokens.css</code>, and <code>apps/web/DESIGN.md</code> says when to use each one.{" "}
              <a href="/">Back to Slabwatch</a>
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
                <span className="price">{money(LISTINGS[0]!.price)}</span>
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

        <Section eyebrow="Tokens" title="Gradients, shadows, motion and layout">
          <Group title="Gradient">
            <div className="ds-rows">
              {GRADIENTS.map((n) => (
                <div className="ds-row" key={n}>
                  <span className="ds-label">
                    <code>{n}</code>
                  </span>
                  <span className="ds-gradient" style={{ background: `var(${n})` }} />
                </div>
              ))}
            </div>
          </Group>
          {VALUE_GROUPS.map(([title, names]) => (
            <Group key={title} title={title}>
              <div className="ds-swatches">
                {names.map((n) => (
                  <div className="ds-swatch" key={n}>
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
          <p className="ds-intro">
            Buy now and Watch show on hover and keyboard focus, and after a tap on the art on touch screens. Here the first two
            tiles hold them open; hover the last one to see them. The third is a listing the collector owns.
          </p>
          <div className="grid">
            {LISTINGS.map((l, i) => (
              <div key={l.listingId} className={i < 2 ? "ds-tile-open" : undefined}>
                <ListingTile l={l} owned={i === 2} watching={i === 1} onBuy={() => {}} onWatch={() => {}} />
              </div>
            ))}
          </div>
        </Section>

        <Section eyebrow="Components" title="Checkout">
          <p className="ds-intro">
            Buy now opens this as a dialog, and as a bottom sheet on a phone. The main button walks through whatever is missing
            (Connect wallet, Sign in, Get test dUSD, Approve) and then reads Sign and pay.
          </p>
          <div className="ds-checkouts">
            {CHECKOUTS.map((c) => (
              <figure key={c.caption}>
                <div className="checkout">
                  <CheckoutView
                    listing={c.listing}
                    step={c.step}
                    as="panel"
                    payments="simulated"
                    faucetUsd={STATUS.faucetUsd}
                    balance={c.balance ?? null}
                    busy={c.busy ?? null}
                    paid={c.paid ?? null}
                    refused={null}
                    error={null}
                    onAct={() => {}}
                    onClose={() => {}}
                  />
                </div>
                <figcaption>{c.caption}</figcaption>
              </figure>
            ))}
          </div>
        </Section>

        <Section eyebrow="Components" title="SetCard">
          <div className="set-grid">
            {SETS.map((s, i) => (
              <SetCard key={s.id} set={s} count={[9, 7, 12, 8][i]} floorUnits={[4_200, 6_850, 3_900, 12_400][i] ?? null} href="#" />
            ))}
          </div>
        </Section>

        <Section
          eyebrow="Components"
          title="Panels on the agent page"
          lede="RuleList with Manage your watches, AgentLimits, the wallet with Sign out, Found for you as FoundCards, Checked and skipped, and RuleChat (a popup on the page)."
        >
          <div className="ds-two">
            <div>
              <RuleList rules={RULES} selected="r1" onSelect={() => {}} onManage={() => {}} />
              <AgentLimits status={STATUS} rules={RULES} />
              <Panel title="Wallet">
                <dl className="facts">
                  <dt>dUSD balance</dt>
                  <dd>2,000.00 dUSD</dd>
                  <dt>Slabwatch may spend</dt>
                  <dd>1,500.00 dUSD</dd>
                </dl>
                <div className="row">
                  <Button>Get 2,000 test dUSD</Button>
                  <Button variant="link">Sign out</Button>
                </div>
                <p className="muted small">Slabwatch pays the network fee, so the wallet needs no SOL.</p>
              </Panel>
            </div>
            <div>
              <Panel className="found">
                <div className="panel-head">
                  <div className="found-heading">
                    <h2>Found for you</h2>
                    <span className="mono muted small">3 to sign</span>
                  </div>
                  <span className="muted small">Matches, and listings the agent wants you to look at. You sign every buy.</span>
                </div>
                <p className="note">3 matches and 1 to review among the listings right now.</p>
                <div className="found-track">
                  {FOUND.map((i) => (
                    <FoundCard key={i.key} item={i} top={RULES[0]!.hard.maxPrice}>
                      {canBuy(i) && (
                        <>
                          <Button>Sign and pay</Button>
                          {i.waiting === null && <Button variant="secondary">Ask the agent</Button>}
                        </>
                      )}
                    </FoundCard>
                  ))}
                </div>
              </Panel>
              <Panel title="Purchases">
                {PURCHASES.slice(1).map((p) => (
                  <PurchaseRow key={p.id} p={p} />
                ))}
              </Panel>
              <Panel className="rule-skipped">
                <div className="panel-head">
                  <h2>Checked and skipped</h2>
                  <span className="muted small">Why each listing did not match</span>
                </div>
                <ul className="skipped">
                  {SKIPPED.map((d) => (
                    <SkippedRow key={d.listingId} d={d} />
                  ))}
                </ul>
              </Panel>
              <RuleChat detail={DETAIL} status={STATUS} chat={CHAT} />
              <Panel title="New watch">
                <div className="questions">
                  <strong>Before you save, the parser asks:</strong>
                  <ul>
                    <li>What is the most you want to pay?</li>
                  </ul>
                </div>
              </Panel>
            </div>
          </div>
        </Section>

        <HowItWorks />
        <Graders />
        <AgentBand />
        <Section eyebrow="Components" title="AgentStrip">
          <AgentStrip onOpen={() => {}} />
        </Section>
        <Section
          eyebrow="Components"
          title="ListingDetail"
          lede="The listing page, here with its price panel open on the last step. On the page, ListingBuy runs that panel."
        />
        <ListingDetail
          l={LISTINGS[0]!}
          onAgent={() => {}}
          buy={
            <section className="panel listing-panel listing-buy" aria-label="Price">
              <h2>Price</h2>
              <p className="listing-price">
                <span className="price">{money(LISTINGS[0]!.price)}</span>
              </p>
              <CheckoutView
                listing={LISTINGS[0]!}
                step={{ kind: "pay" }}
                as="inline"
                payments="simulated"
                faucetUsd={STATUS.faucetUsd}
                balance={200_000}
                busy={null}
                paid={null}
                refused={null}
                error={null}
                onAct={() => {}}
                onClose={() => {}}
              />
            </section>
          }
        />
      </main>
      <Footer />
      <StatusBar status={STATUS} loaded />
    </>
  )
}
