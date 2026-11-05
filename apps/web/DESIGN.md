# Slabwatch design system

The wallet page is a dark collectibles marketplace: a near-black canvas, thin 1px borders over faintly lit surfaces, one neon accent, and graded cards drawn in CSS as slabs around generated art. Everything shown is fictional (sets, creatures, graders, sellers) and everything runs on Solana devnet.

This file is the map. The values live in [`styles/tokens.css`](styles/tokens.css), and [`/design`](app/design/DesignSystem.tsx) renders every token and component with sample data, no backend needed (`pnpm --filter @slabwatch/web dev`, then open `http://localhost:3000/design`).

## Where things live

| Path | What it holds |
| --- | --- |
| `styles/tokens.css` | Every design token: color, type, space, radius, shadow, motion, layout |
| `styles/base.css` | Element defaults, text utilities (`.muted`, `.small`, `.mono`, `.error`, `.hide-sm`), form fields |
| `styles/ui.css` | Shared building blocks: button, chip, pill, badge, count, LED, section, panel, note |
| `styles/<area>.css` | One file per page area, named after its component: `header`, `status-bar`, `hero`, `sets`, `market`, `slab`, `how-it-works`, `desk` |
| `app/globals.css` | Only the import order of the files above |
| `components/ui/` | React components for the building blocks: `Button`, `Chip`, `Pill`, `Badge`, `Section`, `Panel`, `SearchIcon` |
| `components/` | Page components: `Header`, `DevnetNotice`, `Hero`, `Sets` (and `SetCard`), `Market`, `ListingTile`, `Slab`, `HowItWorks`, `StatusBar`, and the signed-in desk: `WalletPanel`, `NewRule`, `RuleList`, `RuleView` (with `DecisionRow`, `PurchaseRow`) |
| `lib/art.ts` | The four sets (name, year, blurb, tone), grade words, grader names, art paths |
| `public/art/` | Generated images: 40 cards, 4 set banners, the hero background |
| `app/design/` | The `/design` reference page |

Plain global CSS, no CSS modules or utility framework. Class names are short and describe the thing (`.tile`, `.slab`, `.panel`, `.pill`), and modifiers are a second class (`.pill.ok`, `.tab.active`, `.btn-secondary`).

## Principles

1. **One accent.** `--accent` (a lime neon) marks the thing to do next: primary buttons, links, the active tab, the selected rule, focus rings, step icons, tile badges. Nothing else is that color, and there is no second brand color.
2. **Depth from lines, not shadows.** Surfaces are white at 2 to 8% over the canvas, separated by `--line`. Only the slabs (and the hero's floating ones) cast shadows, because they are objects.
3. **Color means something.** A set's tone tints what belongs to that set. Green, yellow and red only ever mean ok, warn and bad.
4. **Numbers in mono.** Prices, counts, wallet amounts, cert numbers, badges, tile footers and the model spend use `--mono`.
5. **Pills for actions and tags, soft boxes for content.** Buttons, chips, pills and the search field are fully round; tiles and cards are `--radius-lg`, panels `--radius-xl`.
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
| Lines | `--line` #1f1f1f, `--line-strong` #2b2b2e, `--line-glass`, `--line-hover`, `--line-active` | Default borders; fields, chips and secondary buttons; a field over art; hovered tile; hovered secondary button |
| Text | `--ink` #fff, `--ink-soft` #d4d4d8, `--muted` #a1a1aa, `--faint` #71717a, `--off` #52525b | Headings and body; nav, lede, seller text; secondary; tertiary; an LED that is off |
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
| `--text-5xl` | 28px | Section titles (23px, `--text-4xl`, on a phone) |
| `--text-3xl` | 20px | The brand, tile prices |
| `--text-2xl` | 19px | Step titles, a rule's title |
| `--text-xl` | 17px | The hero lede |
| `--text-lg` | 16px | Panel titles, prices in rows, tile prices on a phone |
| `--text-base` | 15px | Body, nav, tabs, tile titles |
| `--text-md` | 14px | Buttons, fields, panel copy |
| `--text-sm` | 13px | Meta lines, notes, the devnet notice, the status bar |
| `--text-xs` | 12px | Eyebrows, chips, pills, badges, counts, tile footers |

Weights: `--weight-medium` 500, `--weight-semibold` 600, `--weight-bold` 700, `--weight-black` 800. Line heights: `--leading-body` 1.5 (default), `--leading-lede` 1.55, `--leading-relaxed` 1.6, `--leading-display` 1.02. Tracking: `--tracking-caps` 0.08em for uppercase labels, `--tracking-heading` -0.02em, `--tracking-brand` -0.03em, `--tracking-display` -0.035em, `--tracking-snug` -0.01em.

Uppercase is for labels only: `.eyebrow` above section titles, `h3` inside a panel, step numbers, the slab label.

### Space

A 4px scale named by multiples of 4: `--space-1` 4px, `--space-2` 8px, `--space-3` 12px, `--space-4` 16px, `--space-5` 20px, `--space-6` 24px, `--space-8` 32px, `--space-10` 40px, `--space-12` 48px, `--space-14` 56px, `--space-16` 64px, `--space-18` 72px, `--space-22` 88px, with half steps `--space-0-5`, `-1-5`, `-2-5`, `-3-5`, `-4-5` (2, 6, 10, 14, 18px).

The rhythm: 56px between sections (40px on a phone), 20px under a section title, 12px between tiles (8px on a phone), 8px between set cards, 18px inside a panel, 12px between panels. A few control paddings sit off the scale on purpose (a small button is 7px by 15px, a chip 1px by 9px) and are written out.

### Radius

`--radius-xs` 4px (badges, counts), `--radius-sm` 6px (seller text), `--radius-md` 8px (fields, notes, rows, rule items, the hero search), `--radius-lg` 10px (tiles, set cards, step cards, listing rows), `--radius-xl` 12px (panels), `--radius-pill` (buttons, chips, pills, the market search). Inside a slab, radii are shares of its width (see Slab).

### Shadow, blur and motion

- `--shadow-focus`: the 3px accent ring on a focused field.
- `--shadow-card`: the card inside a slab. `--shadow-float`: a drop-shadow filter for the hero slabs. `--glow-ok`: an LED that is on.
- `--text-shadow-display`, `--text-shadow-lede`: keep hero copy readable over art.
- `--blur-sm` 6px (hero search), `--blur-md` 12px (status bar), `--blur-lg` 14px (header).
- `--duration-fast` 0.15s (buttons, chips), `--duration-base` 0.2s (tile and card borders), `--duration-slow` 0.3s (a slab lifting 4px in a hovered tile), `--duration-slower` 0.5s (a set banner zooming to 104%), all with `--ease`.
- Loops: hero slabs float 14px over 10s, the holo sheen drifts over 7s, skeletons shimmer over 1.6s. All three stop under `prefers-reduced-motion`, and smooth scrolling turns off.

### Layout

`--wide` 1376px of content, centered, with `--gutter` 32px each side (16px on a phone). `--header-height` 72px (64px on a phone) and a fixed `--statusbar-height` 40px bar at the bottom; the body pads for it. Anchors land `--scroll-offset` 88px down. The market grid fills rows with tiles of at least `--tile-min` 230px. The signed-in desk is a `--rail` column (300 to 380px) of panels beside the selected rule. Header z-index `--z-header` 50, status bar `--z-statusbar` 40.

Breakpoints (max-width, written in each stylesheet): **1100px** the hero keeps two of its four slabs and How it works goes two up; **900px** the desk stacks, set cards go two up, hero slabs fade to 35%; **700px** phone: smaller gutter and header, nav and the header chip hide, the market goes two up, How it works one up; **460px** set blurbs and the model spend hide.

## Components

### Building blocks (`components/ui/`)

| Component | Props | Looks like | Use for |
| --- | --- | --- | --- |
| `Button` | `variant`: `primary` (default), `secondary`, `ring`, `link`. `size`: `sm` (default), `lg`, `inline` | Pills. `primary` is accent with dark text; `secondary` an outline that brightens on hover; `ring` a dark pill with an iridescent rim; `link` underlined accent text | `lg` for page-level calls to action (the hero: one `primary`, one `ring`). `sm` for actions inside panels. `link` for small asides ("show why", "Sign out"), with `size="inline"` when it sits in a sentence. Disabled is 45% opacity. Busy labels end in an ellipsis: "Waiting for the wallet…" |
| `Chip` | `tone`: `warn` or none | A small pill with a tinted fill | Flagging a condition: "devnet", "read-only demo", a price in EUR or JPY |
| `Pill` | `tone`: `ok`, `warn`, `bad` or none | A small outlined pill | A status: rule "active" (ok), "auto-buy" (warn), purchase "executed" (ok), "refused" or "failed" (bad), anything neutral without a tone |
| `Badge` | children | Mono, uppercase, accent outline, square-ish | The grader and grade on a tile ("NVG 10") |
| `Section` | `id`, `eyebrow`, `title`, `className` | A full-width band with an optional uppercase eyebrow over a 28px title | Each band of the page; `id` is the header's anchor |
| `Panel` | `title`, `className` | A bordered box on `--surface`, 18px padding, 16px bold title | Everything on the signed-in desk. An `h3` inside renders as an uppercase label |
| `SearchIcon` | none | 16px magnifier in the current color | Search fields |

Single-class blocks with no component: `.count` (a number in a tab), `.led` / `.led.on` (status dots), `.note` (an accent-tinted message after an action), `.eyebrow`, `.empty` (centered muted message), `.callout.error` (a page-level error), `.facts` (label and mono value pairs), `.row` (a wrapping line of controls), `.block` (a titled block inside a panel, with a top border), `.questions` (warn-tinted box).

### Page components

| Component | What it is |
| --- | --- |
| `Header` | Sticky glass bar: `Logo` and wordmark, section links, a warn `Chip` "devnet", and the wallet adapter's button restyled as an accent pill |
| `DevnetNotice` | The line under the header on every view: "Solana devnet only." in warn, then the fictional data and no-real-funds warning |
| `Hero` | Signed out only. Hero art faded into the canvas, four tilted floating `Slab`s, the headline "Your grail card, on watch", a lede, a glass search field, a large primary and a large ring `Button` |
| `Sets` and `SetCard` | Set filter chips (a glowing dot in the set's tone) and four banner cards (16:9 art, name, year and count, blurb). Hover tints the border with the tone and zooms the art |
| `Market` | Set tabs with counts, a pill search and a sort select, then a grid of `ListingTile`s, skeleton tiles while loading |
| `ListingTile` | A `Slab` on a sunken backdrop with a radial glow in the set's tone, then `Badge`, card name, meta line (year, set, number, edition, finish), mono price with a warn `Chip` when not in USD, and seller and age in faint mono |
| `Slab` | The graded card in its case. See below |
| `HowItWorks` | Signed out only. Four step cards: a 48px line icon in the accent, "Step n" in mono caps, a title and a sentence |
| `StatusBar` | Fixed glass bar at the bottom: wordmark, "A study project", LEDs for payments and the agent, the model spend in mono, a warn chip in read-only mode |
| `WalletPanel` | Panel: dUSD balance and allowance as `.facts`, faucet and allowance buttons, the last transaction link |
| `NewRule` | Panel: a textarea for the want, "Draft the rule", an example link, then the drafted rule as `.facts` with editable price and budget, the parser's questions in `.questions`, and "Save rule" |
| `RuleList` | Panel: the rules as full-width outlined items (the selected one in an accent border and tint), then "Sign out" |
| `RuleView` | Panel: the rule's title, criteria and status pills, then `.block`s for purchases waiting for a signature, matches, needs your review, rejections (collapsed), auto-buy, purchases and agent runs |
| `DecisionRow` | A judged listing: 64px thumbnail framed in the set's tone, title, meta, price, the seller's text in a sunken well (always plain text), reasons, and action buttons |
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

Loading: skeleton tiles in the market, "…" in counts and wallet amounts, "Loading the rule…" in a muted panel. Empty: a centered `.empty` line with a way out ("Clear the filters"). Unreachable backend: a centered `.callout.error` under the hero, and "Backend not reachable" in the status bar. Busy: the clicked button's label changes ("Reading…", "Waiting for the wallet…") and the other actions in that panel disable until it finishes.

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
- A few values sit off the scales and are written out: the small button padding (7px by 15px), chip and pill padding, the 9px rule item padding, the hero copy margins (22px, 26px) and the step card padding (34px, 30px). Slab internals are shares of its width.
- The logo's SVG uses the accent colors as hex, so it still works when copied out on its own.
