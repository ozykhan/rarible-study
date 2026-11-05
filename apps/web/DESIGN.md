# Slabwatch design system

Slabwatch is a dark marketplace for graded cards: a near-black canvas, thin 1px borders over faintly lit surfaces, one neon accent, and graded cards drawn in CSS as slabs around generated art. Everything shown is fictional (sets, creatures, graders, sellers) and everything runs on Solana devnet.

This file is the map. The values live in [`styles/tokens.css`](styles/tokens.css), and [`/design`](app/design/DesignSystem.tsx) renders every token and component with sample data, no backend needed (`pnpm --filter @slabwatch/web dev`, then open `http://localhost:3000/design`).

## Where things live

| Path | What it holds |
| --- | --- |
| `styles/tokens.css` | Every design token: color, type, space, radius, shadow, motion, layout |
| `styles/base.css` | Element defaults, text utilities (`.muted`, `.small`, `.mono`, `.error`, `.hide-sm`), form fields |
| `styles/ui.css` | Shared building blocks: button, chip, pill, badge, count, LED, section, panel, note |
| `styles/<area>.css` | One file per page area, named after its component: `header`, `status-bar`, `hero`, `sets`, `market`, `slab`, `how-it-works`, `desk` for `/agent` and its panels, `checkout`, `home` for the home page's own blocks (`Graders`, `AgentBand`, `Footer`), `listing` for the listing page (`ListingDetail`, `ListingBuy`), and `agent-drawer` for the agent on the market (`AgentStrip`, `AgentDrawer`, the phone's Ask the agent button) |
| `app/globals.css` | Only the import order of the files above |
| `components/ui/` | React components for the building blocks: `Button`, `Chip`, `Pill`, `Badge`, `Section`, `Panel`, `Led`, `SearchIcon`, `CloseIcon`, `AgentIcon` |
| `components/` | Page components: `Shell`, `Header`, `Logo`, `DevnetNotice`, `Hero`, `Sets` (and `SetCard`), `Market`, `MarketSearch`, `AgentStrip`, `AgentDrawer`, `ListingTile`, `ListingDetail`, `ListingBuy`, `Checkout`, `Slab`, `HowItWorks`, `Graders`, `AgentBand`, `Footer`, `StatusBar`, and the agent page: `RuleList`, `WalletPanel`, `AgentLimits`, `RuleView` (with `useRule`, `RuleChat`, `DecisionRow`, `SkippedRow`, `PurchaseRow`) and `NewRule` |
| `lib/market.ts` | `useMarket()`: one filtered, paged view of the market from the server, and the filters as the URL holds them |
| `lib/account.tsx` | `AccountProvider` and `useAccount()`: the wallet session, backend status, listings and market stats, the signed-in wallet's rules, funds and purchases, and the one checkout dialog, shared by every route |
| `app/(shop)/` | The marketplace routes, all inside `Shell`: `/` (home), `/market`, `/listing/[id]`, `/agent` |
| `lib/art.ts` | The four sets (name, year, blurb, tone), grade words, grader names, art paths |
| `public/art/` | Generated images: 40 cards, 4 set banners, the hero background |
| `app/design/` | The `/design` reference page, outside the shell |

Plain global CSS, no CSS modules or utility framework. Class names are short and describe the thing (`.tile`, `.slab`, `.panel`, `.pill`), and modifiers are a second class (`.pill.ok`, `.tab.active`, `.btn-secondary`).

### Routes

| Route | What it shows |
| --- | --- |
| `/` | The home page, top to bottom: `Hero` with the market search, `Sets` as links, "On the market now" (the five newest `ListingTile`s), `HowItWorks`, `Graders`, `AgentBand`, `Footer` |
| `/market` | `Market`, with `MarketSearch` in the header. The set, grader, search and sort live in the URL (`?set=`, `?grader=`, `?q=`, `?sort=`), so the hero search and the popular searches land on a filtered market. Watch on a tile, the agent line and the phone's Ask the agent button open `AgentDrawer` |
| `/listing/[id]` | `ListingDetail` with `ListingBuy` in it, then "More from" the set: four `ListingTile`s and "See all N" to the set on `/market`. A tile's art and title link here. A sold or withdrawn listing keeps its page, which says so; an unknown id says it is not on Slabwatch. Watch, a tile's Watch and "Ask the agent" open `AgentDrawer` |
| `/agent` | The optional agent: a title with an "optional" `Pill`, a lede and Back to the market. Signed out, a panel to connect and sign in. Signed in, three columns: the rail (`RuleList`, `WalletPanel`, `AgentLimits`), the selected watch (`RuleView`), and the chat column (`RuleChat`, then `NewRule` as "Change this watch", seeded with the watch's words). New watch, or `?watch=` from Open full screen, puts an empty "New watch" form in the chat column |

`Shell` wraps every route in `app/(shop)/`: `Header`, `DevnetNotice`, the page, then `StatusBar`. Buy now on a tile opens the same `Checkout` dialog from any route; on a listing page, Buy now opens it inline in the price panel.

## Principles

1. **One accent.** `--accent` (a lime neon) marks the thing to do next: primary buttons, links, the active tab, the selected rule, focus states, step icons, tile badges. Nothing else is that color, and there is no second brand color.
2. **Depth from lines, not shadows.** Surfaces are white at 2 to 8% over the canvas, separated by `--line`. Only the slabs (and the hero's floating ones) cast shadows, because they are objects.
3. **Color means something.** A set's tone tints what belongs to that set. Green, yellow and red only ever mean ok, warn and bad.
4. **Numbers in mono.** Prices, counts, wallet amounts, cert numbers, badges, tile sellers and the model spend use `--mono`.
5. **Pills for actions and tags, soft boxes for content.** Buttons, chips, pills and the market search are fully round; the hero search is `--radius-md`, like other fields; tiles and cards are `--radius-lg`, panels `--radius-xl`.
6. **Honest and fictional.** The devnet notice is on every view, and all data is invented (see Content rules).

## Tokens

All names below are CSS custom properties on `:root` in `styles/tokens.css`. Use them by name; if a design needs a value that isn't here, add a token rather than a raw value.

### Color

| Group | Tokens | Use |
| --- | --- | --- |
| Canvas | `--bg` #080808 | The page |
| Solid surfaces, darkest first | `--surface-inset` #0b0b0c, `--surface-sunken` #0d0d0f, `--surface-solid` #0f0f11, `--surface-raised` #101012, `--surface-thumb` #151518 | Bands and wells, the backdrop behind a slab, form fields, the wallet modal, thumbnails before their art loads |
| Translucent surfaces | `--surface` (white 3.5%), `--surface-subtle` (2%), `--surface-shine` (7%), `--surface-count` (8%) | Cards, tiles and panels; rows inside a panel; the skeleton shimmer; tab counts |
| Glass | `--glass-header`, `--glass-footer`, `--glass-field` | Frosted header, status bar and hero search, each with a backdrop blur |
| Lines | `--line` #1f1f1f, `--line-strong` #2b2b2e, `--line-control` #63636b, `--line-glass`, `--line-hover`, `--line-active` | Default borders; chips, pills and rule items; fields and secondary buttons (3:1 on every surface); a field over art (3:1); hovered tile; hovered secondary button |
| Text | `--ink` #fff, `--ink-soft` #d4d4d8, `--muted` #a1a1aa, `--faint` #85858e, `--off` #52525b | Headings and body; nav, lede, seller text; secondary; tertiary, 4.5:1 on every surface; an LED that is off, never text |
| Accent | `--accent` #e4ff3a, `--accent-ink` #0b0b0c, `--accent-2` #7cf3c9 | The one accent; text on it; the second stop of the logo gradient only |
| Status | `--ok` #4ade80, `--warn` #facc15, `--bad` #f87171 | Pills, chips, LEDs, errors. Warn also marks "devnet", "read-only" and prices not in USD |
| Set tones | `--set-OS` #8fd16a, `--set-TW` #3fd0d4, `--set-EF` #ff7a3d, `--set-SE` #a98bff, `--set-unknown` #9aa1ab | Origin Set, Tidewild, Emberfall, Starward Expedition. See Set tone below |
| Grader labels | `--grader-<NVG\|QSG\|LCA>-stripe`, `-label`, `-ink` | The colored stripe, label fill and label text on a slab |
| Slab | `--slab-fill`, `--slab-edge`, `--slab-window`, `--card-ink`, `--card-badge` | The acrylic case, its rim, the card well, text printed on the card, the "1st" stamp |
| Gradients | `--gradient-ring`, `--gradient-holo` | The iridescent rim of the ring button; the holo sheen on cards |

Tints are made with `color-mix` against a token, for example `color-mix(in srgb, var(--warn) 55%, transparent)` for a warn border and 7 to 8% for a warn background.

### Type

Inter for text and JetBrains Mono for numbers, both loaded by `next/font` in `app/layout.tsx` and exposed as `--sans` and `--mono`. Headings h1 to h3 have `--tracking-heading` and no margin.

| Token | Size | Used for |
| --- | --- | --- |
| `--text-display` | clamp(40px, 6.2vw, 68px) | The hero headline (weight 800, `--tracking-display`, `--leading-display`) |
| `--text-title` | clamp(28px, 3.4vw, 44px) | A page title: the market's (23px, `--text-4xl`, on a phone) |
| `--text-heading` | clamp(26px, 2.5vw, 36px) | A listing's card name, in `--weight-black` |
| `--text-5xl` | 28px | Section titles (23px, `--text-4xl`, on a phone) |
| `--text-3xl` | 20px | The brand, tile prices |
| `--text-2xl` | 19px | Step titles, a rule's title |
| `--text-xl` | 17px | The hero lede |
| `--text-lg` | 16px | Panel titles, prices in rows, tile prices on a phone |
| `--text-base` | 15px | Body, nav, tabs, tile titles |
| `--text-md` | 14px | Buttons, fields, panel copy, notes |
| `--text-sm` | 13px | Meta lines, the devnet notice, the status bar |
| `--text-xs` | 12px | Eyebrows, chips, pills, badges, counts, tile sellers |

Weights: `--weight-medium` 500, `--weight-semibold` 600, `--weight-bold` 700, `--weight-black` 800. Line heights: `--leading-body` 1.5 (default), `--leading-lede` 1.55, `--leading-relaxed` 1.6, `--leading-display` 1.02. Tracking: `--tracking-caps` 0.08em for uppercase labels, `--tracking-heading` -0.02em, `--tracking-brand` -0.03em, `--tracking-display` -0.035em, `--tracking-snug` -0.01em.

Uppercase is for labels only: `.eyebrow` above section titles, `h3` inside a panel, step numbers, the slab label.

### Space

A 4px scale named by multiples of 4: `--space-1` 4px, `--space-2` 8px, `--space-3` 12px, `--space-4` 16px, `--space-5` 20px, `--space-6` 24px, `--space-8` 32px, `--space-10` 40px, `--space-12` 48px, `--space-14` 56px, `--space-16` 64px, `--space-18` 72px, `--space-22` 88px, with half steps `--space-0-5`, `-1-5`, `-2-5`, `-3-5`, `-4-5` (2, 6, 10, 14, 18px).

The rhythm: 56px between sections (40px on a phone), 20px under a section title, 12px between tiles (8px on a phone), 8px between set cards, 18px inside a panel, 12px between panels. A few control paddings sit off the scale on purpose (a small button is 7px by 15px, a chip 1px by 9px) and are written out.

### Radius

`--radius-xs` 4px (badges, counts), `--radius-thumb` 5px (decision row thumbnails), `--radius-sm` 6px (seller text), `--radius-md` 8px (fields, notes, rows, rule items, the hero search), `--radius-lg` 10px (tiles, set cards, step cards, listing rows), `--radius-xl` 12px (panels), `--radius-pill` (buttons, chips, pills, the market search). Inside a slab, radii are shares of its width (see Slab).

### Shadow, blur and motion

- `--focus-ring`: the 2px accent outline on a link or button under keyboard focus, set in `styles/base.css`.
- `--shadow-focus`: the 3px accent glow on a focused field, with a 70% accent border. Both search fields use it through `:focus-within`.
- `--shadow-card`: the card inside a slab. `--shadow-float`: a drop-shadow filter for the hero slabs. `--glow-ok`: an LED that is on.
- `--text-shadow-display`, `--text-shadow-lede`: keep hero copy readable over art.
- `--blur-sm` 6px (hero search), `--blur-md` 12px (status bar), `--blur-lg` 14px (header).
- `--duration-fast` 0.15s (buttons, chips), `--duration-base` 0.2s (tile and card borders), `--duration-slow` 0.3s (a slab lifting 4px in a hovered tile), `--duration-slower` 0.5s (a set banner zooming to 104%), all with `--ease`.
- Loops: hero slabs float 14px over 10s, the holo sheen drifts over 7s, skeletons shimmer over 1.6s. All three stop under `prefers-reduced-motion`, and smooth scrolling turns off.

### Layout

`--wide` 1376px of content, centered, with `--gutter` 32px each side (16px on a phone). `--header-height` 72px (64px on a phone) and a fixed `--statusbar-height` 40px bar at the bottom; the body pads for it. Anchors land `--scroll-offset` 88px down. The market grid fills rows with tiles of at least `--tile-min` 230px. The agent page's rail is 280 to 340px and its chat column 300 to 360px, with the watch between them; `--rail` (300 to 380px) is the design page's two-column sample. Header z-index `--z-header` 50, status bar `--z-statusbar` 40, the agent drawer `--z-drawer` 55, and the checkout dialog `--z-dialog` 60. The wallet picker belongs to the wallet adapter (z-index 1040), so it opens over the checkout.

Breakpoints (max-width, written in each stylesheet; the listing page's is a min-width): **1000px** and wider, the listing page sets its slab beside the panels, where it stays in view while they scroll, and More from shows four in a row; **1200px** the agent page's chat column moves under the watch; **1240px** the five newest on the home page wrap like the market grid; **1100px** the hero slabs shrink, How it works goes two up, and the market search moves from the header onto the page; **900px** the header links hide, the agent page stacks (watches, the watch, the chat, then the wallet and the limits) and a watch's conditions go one pair to a line, set cards go two up, graders stack; **700px** phone: smaller gutter, header and wordmark, the header chip and the Agent link hide, a round search button shows, the market goes two up (four of the five newest on the home page) with a smaller title and no lede or numbers, the agent drawer goes full width and Ask the agent floats over the market, the listing page's slab shrinks to 168px, the agent page's title and lede shrink, How it works one up; **460px** set blurbs and the model spend hide.

## Components

### Building blocks (`components/ui/`)

| Component | Props | Looks like | Use for |
| --- | --- | --- | --- |
| `Button` | `variant`: `primary` (default), `secondary`, `ring`, `link`. `size`: `sm` (default), `lg`, `inline` | Pills. `primary` is accent with dark text; `secondary` an outline that brightens on hover; `ring` a dark pill with an iridescent rim; `link` underlined accent text | `lg` for page-level calls to action (the hero: one `primary`, one `ring`). `sm` for actions inside panels. `link` for small asides ("show why", "Sign out"), with `size="inline"` when it sits in a sentence. Disabled is 45% opacity. Busy labels end in an ellipsis: "Waiting for the wallet…" |
| `Chip` | `tone`: `warn` or none | A small pill with a tinted fill | Flagging a condition: "devnet", "read-only demo", a price in EUR or JPY |
| `Pill` | `tone`: `ok`, `warn`, `bad` or none | A small outlined pill | A status: a watch "watching" (ok, with a `Led`), "buys without asking" (warn), purchase "executed" (ok), "refused" or "failed" (bad), anything neutral without a tone |
| `Badge` | children | Mono, uppercase, accent outline, square-ish | The grader and grade on a tile ("NVG 10") |
| `Section` | `id`, `eyebrow`, `title`, `lede`, `aside`, `className` | A full-width band with an optional uppercase eyebrow over a 28px title, an optional muted line under it, and an optional `aside` at the right of the title row | Each band of the page; `id` is the header's anchor. `aside` holds a `.section-link` ("All sets", "See all listings") |
| `Panel` | `title`, `className` | A bordered box on `--surface`, 18px padding, 16px bold title | Everything on the agent page. An `h3` inside renders as an uppercase label. For a title with a count or a line at its right, leave out `title` and put a `.panel-head` (an `h2` and a muted span) first |
| `Led` | `on` | A 7px dot, `--off`, or `--ok` with a glow when on | Whether something is running: a watch in `RuleList` and its status `Pill`, each line of `AgentLimits`, the status bar |
| `SearchIcon` | none | 16px magnifier in the current color | Search fields |
| `CloseIcon` | none | 14px cross in the current color | Inside a `.btn-close`: a round 36px button (44px on a phone), muted until hovered. The checkout's and the agent drawer's Close |
| `AgentIcon` | `size` (16) | A four-point spark in the current color | The agent's mark: the header's Agent link, the agent band and strip, Ask the agent |

Single-class blocks with no component: `.count` (a number in a tab), `.note` (an accent-tinted message after an action), `.eyebrow`, `.empty` (centered muted message), `.callout.error` (a page-level error), `.facts` (label and mono value pairs), `.row` (a wrapping line of controls), `.block` (a titled block inside a panel, with a top border), `.panel-head` (a panel title with something at its right), `.pending` (warn-tinted box of purchases waiting for a signature), `.questions` (warn-tinted box).

### Page components

| Component | What it is |
| --- | --- |
| `Shell` | Every marketplace route: `AccountProvider` around `Header`, `DevnetNotice`, the page and `StatusBar` |
| `Header` | Sticky glass bar on every route: `Logo` and wordmark, the links (Market, Sets, Graders, How buying works; the current one in `--ink`, and Market stays current on a listing page), a warn `Chip` "devnet", the optional Agent link with its spark icon, the dUSD balance in mono once signed in, and the wallet adapter's button restyled as an accent pill. On `/market` (wider than 1100px) `MarketSearch` sits after the links. On a phone the links, the chip and the Agent link fold away and a 44px round search button goes to `/market`, or to the page's search field when already there |
| `DevnetNotice` | The line under the header on every view: "Solana devnet only." in warn, then the fictional data and no-real-funds warning |
| `Hero` | The home page's opening. Hero art faded into the canvas behind two columns: an eyebrow "Live on devnet", the headline "Graded cards, ready to buy.", a lede, a glass search field with a primary Search `Button`, popular searches as outlined `.chip-link`s, and three live numbers in mono (listings now, sets, lowest price). On the right, two tilted floating `Slab`s |
| `Sets` and `SetCard` | Browse by set on the home page: four banner cards (16:9 art, name, year, "N listed · from X dUSD", blurb), each a link to its set on `/market`, with "All sets" at the right. Hover tints the border with the tone and zooms the art |
| `Market` | The whole market. A head with an eyebrow, the title in `--text-title`, a lede and two live numbers in mono (listings now, lowest price). Then set tabs (a dot in the set's tone, the name, a `.count` of what the search and grader match), Grader and Sort selects, a count line ("3 of 194 listings match"), the grid of `ListingTile`s with skeletons while loading, a large secondary "Show 40 more" with "80 of 194 shown", and `AgentStrip`. Filtering, search, sort and paging run on the server over every active listing; search matches the vault record word by word (card, set, number, edition, finish, grader, grade, seller), never the seller's title |
| `MarketSearch` | The pill search field, bound to `?q=` with a short pause after typing. In the header on `/market`, and on the page itself at 1100px and below |
| `AgentStrip` | One quiet row that offers the optional agent: the spark in the accent, a title, a muted sentence and a small secondary button that opens `AgentDrawer`. Under the market's grid it reads "Not listed yet? Let the agent watch for it." and "Set up a watch"; on a listing page, "Want it cheaper?" and "Ask the agent" |
| `AgentDrawer` | The optional agent at the right edge of the market (420px, full width on a phone), on `--surface-raised` with a `--line-strong` edge: "Agent", a neutral "optional" `Pill`, "Open full screen" to `/agent`, and Close. Signed out, a large primary connect or sign-in button; signed in, `NewRule` (seeded by Watch on a tile), then a `.note` and a link to `/agent` once saved. Not modal: the market stays usable and the checkout opens over it. Esc closes it |
| `ListingTile` | A `Slab` on a sunken backdrop with a radial glow in the set's tone, then the card name with its `Badge`, meta line (year, set, number, edition, finish), and the mono price (with a warn `Chip` when not in USD) beside the seller in faint mono. Buy now and Watch sit over the art: shown on hover and on keyboard focus (`:focus-within`), and on touch screens after a tap on the art. The art and the title link to the listing page; on touch screens a tap on the art shows the buttons, and the title opens the page. Phones show Buy now only. A listing the collector owns shows an ok `Pill`, "In your wallet", instead |
| `Checkout` | Buying one listing directly, with no rule or agent. A dialog on `--surface-raised` over a `--glass-header` backdrop; a bottom sheet under 700px. The `Slab` beside `.facts` for card, grade and grade word, cert and seller; the code's checks as pills (ok "No red flags", or a warn pill per flag); price, "Network fee: paid by Slabwatch" and the dUSD total. The test-token line sits in a warn tint. One large primary `Button` walks through what is missing (Connect wallet, Sign in, Get test dUSD, Approve, Sign and pay), reads "Waiting for the wallet…" while the wallet is open, and ends in a `.note`, "Bought.", with the explorer link and Keep browsing. Esc and Close are off while the wallet is open. A flagged, over-cap or read-only listing shows why in the warn tint, with no pay button. Once the wallet's balance is read, the total adds "Wallet after". `CheckoutView` draws it with no state (`as`: `dialog`, `panel` on `/design`, or `inline` in `ListingBuy`, which leaves out the slab and the checks because the page shows them); `useCheckout` runs the steps for both |
| `ListingDetail` | One listing in full. A breadcrumb (Market / the set / the card), the `Slab` at 300px on a sunken backdrop with a glow in the set's tone, and beside it a dot in the tone with set, year and number, the card's name and variant in `--text-heading`, and `.pills`: the grader `Badge`, the grade word, and the code's checks. Then the page's price panel, The slab (a `Panel` with `.facts` for grader, grade, cert, seller and listed, the checks in words, and From the seller as plain text in a sunken well), and `AgentStrip` |
| `ListingBuy` | The price panel on a listing page: an uppercase "Price", the price in mono at `--text-5xl` (a warn `Chip` and "You pay N dUSD" when not in USD), then a large primary Buy now with a secondary Watch (`aria-pressed`, "Watching" when a watch targets the card). Buy now opens `CheckoutView` inline, its action first; Cancel goes back. A listing that cannot be bought here shows why in the warn tint and offers Watch only; one this wallet bought shows a `.note`, "In your wallet", and Back to the market |
| `Slab` | The graded card in its case. See below |
| `HowItWorks` | "How buying works": three step cards (Find the slab, Check the grade, Sign and pay), each a 48px line icon in the accent, "Step n" in mono caps, a title and a sentence |
| `Graders` | "Graders we list": three cards, each a small slab label in that grader's colors (the `.grader-<code>` label colors from `slab.css`) beside its name and a line on its label |
| `AgentBand` | A quiet band near the bottom of the home page: the agent's spark in the accent, "Can't find it? Let the agent watch for it." with a neutral `Pill` "optional", a sentence, and a large secondary "Set up a watch" link to `/agent`. No accent fill: buying never needs the agent |
| `Footer` | The home page's last band: the wordmark and a line on what Slabwatch is, two link columns under eyebrows (Market; Slabwatch, with "Devnet notes" to the README), and the fictional-data line |
| `StatusBar` | Fixed glass bar at the bottom: wordmark, "A study project", LEDs for payments and the agent (with "N of M watches active" once signed in), the model spend in mono, a warn chip in read-only mode |
| `WalletPanel` | Panel: dUSD balance, allowance and the address (to the devnet explorer) as `.facts`, faucet and allowance buttons, the last transaction link |
| `AgentLimits` | Panel "What the agent may do", read from the server's status and the watches: a `Led`, the permission and a `Pill` per line (check new listings, show matches, run the agent on a match, buy without asking, warn when approved), then the per-wallet daily cap in mono |
| `NewRule` | Panel: a textarea for the want, "Draft the rule", an example link, then the drafted rule as `.facts` with editable price and budget, the parser's questions in `.questions`, and "Save rule". `title` names the panel; with `replaces` (Change this watch) saving adds the new watch and pauses the old one, since a watch cannot be edited, and the button reads "Save and pause the old one" |
| `RuleList` | Panel "Your watches" with "N of M on" in mono: each watch as a full-width outlined item (a `Led`, the want, "up to $X · watching" in mono; the selected one in an accent border and tint), then New watch and Sign out |
| `RuleView` | The selected watch, from `useRule` (which loads it every 10 seconds and holds its actions): a panel with the want, status pills (watching or paused, buys without asking or asks before buying, how many listings passed its field checks and were judged), Pause or Resume, and the conditions as `.rule-facts`; Found for you (`.pending` purchases to sign, then matches and needs your review as `DecisionRow`s); Checked and skipped (`SkippedRow`s, six then Show all); Buy without asking; Purchases |
| `RuleChat` | Panel "Talk to the agent": the watch as a conversation with real lines only. Your want in a `.bubble.you` on the right; each agent run in a `.bubble.agent` on the left with its outcome `Pill`, its final text and a mono meta line. No free-form questions to the model |
| `DecisionRow` | A judged listing: 64px thumbnail framed in the set's tone, the card's name linking to its listing page with a grade `Badge`, meta, price, the seller's text in a sunken well (always plain text), reasons, and action buttons |
| `SkippedRow` | A skipped listing in one line: a 28px thumbnail, the card with grade and price in mono, the first reason, and when it was listed in `--faint` |
| `PurchaseRow` | A purchase: a status `Pill`, the listing, price, who asked, and a devnet explorer link once paid |
| `Logo` | A rounded square in the accent to `--accent-2` gradient with a slab and a lens drawn in `--accent-ink` |

## Patterns

### Slab

A graded card in its acrylic case, drawn entirely in CSS ([`styles/slab.css`](styles/slab.css)). The outer `.slab` is a size container, so every length inside is a share of its width (`cqw`) and the same slab works from a 130px hero slab to a full tile. Give it a width through its parent; its aspect ratio is fixed at 0.62.

- **Case:** a glass gradient over `--slab-fill`, a 1px `--slab-edge` rim, an inner bevel, a drop shadow and a diagonal glare.
- **Label:** a stripe on top and a fill in the grader's colors (`.grader-NVG` red on white, `.grader-QSG` gold on black, `.grader-LCA` teal on cream). Left: grader code, year and set, card name and number, edition and finish, uppercase. Right: the grade word ("GEM MINT" for 10, "MINT" for 9, from `gradeWord` in `lib/art.ts`) over the grade number.
- **Window:** a dark well holding the card at trading card proportions (63:88).
- **Card:** a frame in a gradient of the set's tone, the art, the name across the top and set code and number along the bottom over dark fades, a round "1st" stamp on 1st edition cards.
- **Finish:** holo cards get the `--gradient-holo` sheen over the whole card; reverse holo shows it on the frame only; non-holo has none.

### Set tone

Each set has one tone token. `lib/art.ts` maps a set to `var(--set-XX)`, and a component passes it down as the `--tone` custom property (`style={{ "--tone": theme.tone }}`). The stylesheets then use `--tone` for the card frame, the tile backdrop glow, the thumbnail border, the set chip dot and glow, and the set card's hover border and banner fallback. To restyle a set, change its token.

### Status language

| Meaning | Shown as |
| --- | --- |
| Good, done, on | `--ok`: `Pill tone="ok"`, a lit LED |
| Needs attention, test-only, not USD | `--warn`: `Chip tone="warn"`, `Pill tone="warn"`, `.questions`, the devnet notice |
| Refused, failed, error | `--bad`: `Pill tone="bad"`, `.error` text |
| The result of your action | `.note` in an accent tint |
| Neutral state | a `Pill` with no tone |

### States

Loading: skeleton tiles in the market, "…" in counts and wallet amounts, "Loading the watch…" in a muted panel. Empty: a centered `.empty` line with a way out ("Clear the filters"). Unreachable backend: a centered `.callout.error` under the hero, and "Backend not reachable" in the status bar. Busy: the clicked button's label changes ("Reading…", "Waiting for the wallet…") and the other actions in that panel disable until it finishes.

## Art

All art is generated and fictional, in `public/art/` as WebP:

- `cards/<card id>.webp`, 384x528 (63:88), for the 40 cards in `packages/seed` (`OS-001` to `SE-010`). `cardArt()` in `lib/art.ts` builds the path.
- `sets/<set id>.webp`, 768x432 (16:9), one banner per set. `setArt()` builds the path.
- `hero.webp`, 1600x914, the hero background, darkened by gradients in `styles/hero.css`.

The images were made on CPU with [LCM Dreamshaper v7](https://huggingface.co/SimianLuo/LCM_Dreamshaper_v7) (MIT license) by [`scripts/generate_art.py`](scripts/generate_art.py), one fixed seed per image. Each set has a style line (Origin Set: meadows and old forests in golden light; Tidewild: reefs and moonlit lagoons in teal; Emberfall: lava and embers in orange and crimson; Starward Expedition: nebulae in violet and blue) and each card a one-line prompt from its lore. Art is decorative (`alt=""`), and a card image that fails to load hides, leaving the tone-colored frame.

## Content rules

- **Fictional only.** Sets, creatures, graders (Northvale Grading, Quarry Slab Grading, Lantern Card Authentication), sellers and cert numbers are invented. No real brands, games, companies, logos or wording.
- **Devnet only.** The devnet notice stays on every view, the header carries a "devnet" chip, and dUSD is always called a test token. Never suggest mainnet or real funds.
- **Plain words, sentence case.** Buttons say what happens ("Sign and pay", "Approve in wallet"). Explanations are one or two short sentences in `.muted.small`.
- **No em dashes** in any user-facing text. Use a colon, a comma or a new sentence.
- **Seller text is untrusted.** Show it as plain preformatted text in its well, never as markup, and never style it to look like the app's own copy.

## Using this with Claude Design

Point Claude Design at the `apps/web` folder of the repo (`https://github.com/ozykhan/rarible-study/tree/main/apps/web`), not the whole monorepo: the backend and evals are not part of the design system. The files that carry the system are `styles/tokens.css`, the other `styles/*.css`, `components/ui/`, the page components, this file and `app/design/DesignSystem.tsx`; the art is in `public/art/`.

When asking for a design, name the parts: "a `Panel` with a `.facts` list and a small secondary `Button`", "a row of `ListingTile`s", "a `Slab` for an LCA 9.5 reverse holo". New screens should use the existing tokens and components, keep the one accent, and follow the content rules above. When a design needs something new, add it as a token or a component here first, then build with it.

## Known quirks

Kept on purpose, because changing them would change how the page looks today:

- The large primary button has a dark 1px edge and brightens on hover; the small one has an accent edge and does not.
- `Chip` and `Pill` are near twins: a chip has a tinted fill and is used for conditions, a pill is outline only and is used for states.
- A few values sit off the scales and are written out: the small button padding (7px by 15px), chip and pill padding, the 9px rule item padding, the 22px gap in the hero copy and the step card padding (34px, 30px). Slab internals are shares of its width.
- Control heights differ: a large button is 42px, the wallet button, select and market search 40px, the hero search 46px. The wallet button's side padding is 18px against 20px on a large button.
- A few more values are written out: the devnet notice's 9px padding and the ring button's 1.5px border.
- Only fields and secondary buttons use `--line-control`. Chips, pills and rule items keep the quieter `--line-strong` (about 1.4:1), because a word or their fill carries the meaning.
- The logo's SVG uses the accent colors as hex, so it still works when copied out on its own.
