---
name: HorCare
description: Back office for small Thai dorms and markets; this month's billing cycle read like a bank statement, in blue, orange and green.
colors:
  primary: "#0A6CC2"
  primary-deep: "#08589F"
  primary-light: "#3D8FD6"
  primary-wash: "rgba(10, 108, 194, 0.08)"
  shell-blue: "#0A5DAA"
  shell-active-orange: "#FFB36B"
  accent-orange: "#E8740C"
  cool-paper: "#F4F7FB"
  panel-white: "#FFFFFF"
  mist: "#EBF1F7"
  hairline: "#DCE5EF"
  hairline-strong: "#C3D0DE"
  steel-faint: "#8FA3B8"
  steel-muted: "#557089"
  steel-secondary: "#3E5872"
  steel-body: "#29435E"
  steel-heading: "#1A3350"
  navy-ink: "#102A43"
  success: "#15803D"
  success-deep: "#166534"
  success-wash: "rgba(21, 128, 61, 0.09)"
  warning: "#C2410C"
  warning-fill: "#F59E2E"
  warning-wash: "rgba(245, 158, 46, 0.14)"
  danger: "#C62828"
  danger-wash: "rgba(198, 40, 40, 0.08)"
  status-paid: "#147A43"
  status-pending: "#F59E2E"
  status-unpaid: "#D64545"
  status-vacant: "#A9B8C8"
  series-1: "#2A78D6"
  series-1-soft: "#9EC5F4"
  series-2: "#EB6834"
  series-muted: "#D3DEEA"
  cat-1: "#2A78D6"
  cat-2: "#EB6834"
  cat-3: "#1BAF7A"
  cat-4: "#EDA100"
  cat-5: "#E87BA4"
  cat-6: "#008300"
  cat-7: "#6250D6"
  cat-8: "#E34948"
  chart-grid: "#E6EDF4"
typography:
  display:
    fontFamily: "Anuphan, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans Thai', Roboto, sans-serif"
    fontSize: "clamp(2.5rem, 1.8rem + 2vw, 3rem)"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.02em"
    fontFeature: "tnum"
  headline:
    fontFamily: "Anuphan, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans Thai', Roboto, sans-serif"
    fontSize: "1.625rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  figure:
    fontFamily: "Anuphan, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans Thai', Roboto, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
    fontFeature: "tnum"
  title:
    fontFamily: "Anuphan, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans Thai', Roboto, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "Anuphan, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans Thai', Roboto, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Anuphan, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans Thai', Roboto, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
  caption:
    fontFamily: "Anuphan, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans Thai', Roboto, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "12px"
  2xl: "16px"
  full: "9999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "8": "32px"
  "10": "40px"
  "12": "48px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.panel-white}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "12px 20px"
  button-primary-hover:
    backgroundColor: "{colors.primary-deep}"
  button-secondary:
    backgroundColor: "{colors.mist}"
    textColor: "{colors.steel-body}"
    rounded: "{rounded.md}"
    padding: "12px 20px"
  button-secondary-hover:
    backgroundColor: "{colors.hairline}"
  button-outline:
    backgroundColor: "{colors.panel-white}"
    textColor: "{colors.steel-body}"
    rounded: "{rounded.md}"
    padding: "12px 20px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.steel-secondary}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  button-ghost-hover:
    backgroundColor: "{colors.mist}"
    textColor: "{colors.navy-ink}"
  link-action:
    backgroundColor: "transparent"
    textColor: "{colors.primary}"
    rounded: "{rounded.md}"
    padding: "5px 8px"
    height: "32px"
  link-action-hover:
    backgroundColor: "{colors.primary-wash}"
  panel:
    backgroundColor: "{colors.panel-white}"
    rounded: "{rounded.xl}"
    padding: "20px"
  segmented-tabs:
    backgroundColor: "{colors.mist}"
    rounded: "{rounded.lg}"
    padding: "3px"
  segmented-tab:
    backgroundColor: "transparent"
    textColor: "{colors.steel-secondary}"
    rounded: "7px"
    padding: "6px 14px"
    height: "34px"
  segmented-tab-active:
    backgroundColor: "{colors.panel-white}"
    textColor: "{colors.navy-ink}"
  input:
    backgroundColor: "{colors.panel-white}"
    textColor: "{colors.steel-heading}"
    rounded: "{rounded.md}"
    padding: "12px 16px"
  badge-success:
    backgroundColor: "{colors.success-wash}"
    textColor: "{colors.success}"
    typography: "{typography.caption}"
    rounded: "{rounded.sm}"
    padding: "2px 8px"
  badge-warning:
    backgroundColor: "{colors.warning-wash}"
    textColor: "{colors.warning}"
    rounded: "{rounded.sm}"
    padding: "2px 8px"
  badge-danger:
    backgroundColor: "{colors.danger-wash}"
    textColor: "{colors.danger}"
    rounded: "{rounded.sm}"
    padding: "2px 8px"
  badge-neutral:
    backgroundColor: "{colors.mist}"
    textColor: "{colors.steel-secondary}"
    rounded: "{rounded.sm}"
    padding: "2px 8px"
  room-tile:
    backgroundColor: "{colors.panel-white}"
    rounded: "{rounded.md}"
    padding: "7px 10px"
    height: "52px"
  room-tile-vacant:
    backgroundColor: "{colors.cool-paper}"
    textColor: "{colors.steel-muted}"
  room-tile-reserved:
    backgroundColor: "{colors.warning-wash}"
    textColor: "{colors.navy-ink}"
  shell:
    backgroundColor: "{colors.shell-blue}"
    textColor: "{colors.panel-white}"
  nav-item:
    backgroundColor: "transparent"
    textColor: "rgba(255, 255, 255, 0.82)"
    rounded: "{rounded.md}"
    padding: "10px 14px"
  nav-item-active:
    backgroundColor: "rgba(255, 255, 255, 0.16)"
    textColor: "{colors.panel-white}"
---

# Design System: HorCare

## Overview

**Creative North Star: "The Calm Ledger"**

HorCare reads like a well-kept bank statement for a small rental business, printed in three colours: blue, orange and green. The ground is a blue-tinted paper, panels are white sheets separated by 1px blue-grey hairlines, and text is a deep navy ink rather than black. The brand-blue shell frames the work and carries the HorCare logo; inside it, blue means "you can act here", orange means "this still needs you", and green means "this is done". Everything else stays quiet so that the numbers are the loudest thing on the page.

Density is moderate and phone-first: panels stack to one column below 768px, figures stay legible at 375px, and every money column uses tabular numerals so amounts line up like a ledger. Colour is spent on meaning. Green, orange and red appear only where a payment, task or room is in that state, always beside a text label; chart hues come from a validated categorical set and never stand in for state.

The world explicitly rejects black and near-black: no black shell, no black ink, no near-black dark mode. It also rejects the KPI-tile grid with tinted icon squares, gradient accents, glow dots and progress rings that the earlier cyan look used. Depth comes from tone and hairlines, not shadows.

Dark mode is a first-class twin and stays blue: a deep-blue ground (`#0B1A2C`), panels raised by lightness (`#11243A`), hairlines at `#22405F`, a deep-blue shell (`#0D2E52`), and every role stepped brighter for the dark surface (brand blue `#4C9BE6`, success `#3DBE78`, warning `#F5A54A`, danger `#F06A6A`; status fills paid `#1A8C4F`, pending `#EE9432`, unpaid `#D94C4C`). The same token names resolve in both themes via `html.dark`.

**Key Characteristics:**
- Blue-tinted paper ground, white hairline panels, brand-blue shell, deep-navy ink. No black anywhere.
- Blue acts, orange waits, green is done.
- Status colours only where state is meant, and always with a label.
- Anuphan for every role, including figures, print views and emails; tabular numerals in every figure and column.
- 12px panel radii, 1px hairlines, shadows almost absent.
- The cycle bar: one segmented bar reused for collection and progress.

## Colors

A cool, blue-tinted ledger with three voices: brand blue for action, orange for attention, green for completion.

### Primary
- **Ledger Blue** (primary): primary buttons, link actions ("จัดการสลิป"), focus rings, active toggles and selection. Hover deepens to **Deep Ledger Blue** (primary-deep). **Blue Wash** (primary-wash) is the hover ground for link actions and selected rows.
- **Shell Blue** (shell-blue): the shell only, meaning the desktop sidebar, the sticky mobile header, the splash screen, and the PWA theme and tile colour. It carries the logo and nav in white. In dark mode it steps to a deep blue (`#0D2E52`) with a `#1C3E64` border.

### Secondary
- **Active Orange** (shell-active-orange): the icon of the active nav item on the blue shell, and nothing else. It marks "you are here".
- **Signal Orange** (accent-orange): the orange accent token (`--color-accent`; `#F5A54A` in dark mode). It survives in the legacy orange gradient and glow tokens; new surfaces reach for the warning roles below instead.

### Neutral
- **Cool Paper** (cool-paper): the page ground, table header rows, vacant room tiles and the hover ground for row links.
- **Panel White** (panel-white): every panel, card, input and tooltip surface.
- **Mist** (mist): the segmented tab track, secondary buttons, empty bar tracks and in-panel row dividers.
- **Hairline** (hairline): the 1px border on every panel, input and tile, and the dividers between key figures.
- **Strong Hairline** (hairline-strong): outline button borders, dashed vacant-tile borders and chart axes.
- **Steel scale**: blue-tinted greys. Faint (placeholders, chevrons), muted (labels, meta, hint text, chart text), secondary (secondary text, ghost buttons), body (body copy), heading (panel titles), and **Navy Ink** (navy-ink: page titles, hero and figure values). Navy Ink is the darkest colour in the light theme.

### Status (state only)
- **Ledger Green** (success, success-deep, success-wash): done, paid, success. Text-safe on white. Used for "done" to-do values, success badges and confirming buttons.
- **Burnt Orange** (warning): the text step for "needs attention / waiting": warning badge text and attention notes, always on **Orange Wash** (warning-wash). **Waiting Orange** (warning-fill) is the fill step for borders, bars and dots; never set body text in it.
- **Ledger Red** (danger, danger-wash): owed, failed, destructive.
- **Paid / Pending / Unpaid / Vacant** (status-paid, status-pending, status-unpaid, status-vacant): fills for cycle-bar segments, status dots and chart marks that encode payment, task or room state. Green, orange and red were validated together for colour-blind separation in both themes, on the condition that they always appear with a label.

### Chart palette
- **Series 1 Blue / Series 2 Orange** (series-1, series-2): income and expense magnitude in bars, lines and horizontal bar lists; series-1-soft and series-muted are their quiet companions. Chart gridlines use chart-grid.
- **Categorical 1-8** (cat-1 to cat-8): a validated eight-step categorical set for breakdowns that need more than two series. Use them in order.

### Named Rules
**The Three Voices Rule.** Blue acts, orange waits, green is done. If something is blue it is clickable or selected; if it is orange it still needs the owner; if it is green it is finished or paid. Red is reserved for owed and failed.

**The No-Black Rule.** The darkest ink is Navy Ink, the shell is Shell Blue, and dark mode is deep blue. No surface, text or shell is black or near-black.

**The Labelled-State Rule.** Status green, orange and red never carry meaning alone; every dot, segment or tile in a status colour sits beside its text label, count or legend.

**The Two Palettes Rule.** Status tokens encode state, while series and categorical tokens encode magnitude and category. A chart of income is series-1 blue, never paid-green, and series-2 orange in a chart means expense, not "waiting".

## Typography

**Display Font:** Anuphan (with -apple-system, Segoe UI, Noto Sans Thai, Roboto)
**Body Font:** Anuphan
**Label/Mono Font:** Anuphan. `--font-mono` is an alias that resolves to the same Anuphan stack; reference and account-number fields keep the `font-mono` hook but render in Anuphan with tabular numerals.

**Character:** One Thai and Latin workhorse at weights 300 to 700 does every job. Hierarchy comes from size and weight 600, never from a second face. Body text is set at line-height 1.6 so Thai tone marks have room to breathe.

### Hierarchy
- **Display** (600, clamp(2.5rem, 1.8rem + 2vw, 3rem), 1.15, -0.02em): the single hero money figure ("collected this cycle"). There is one per screen.
- **Headline** (600, 1.625rem, 1.25, -0.01em; 1.375rem below 768px): the page H1, which is the building name on the Dashboard. Page titles elsewhere use 1.5rem.
- **Figure** (600, 1.375rem; 1.25rem on phones): key-figure values inside the hairline-split figures panel.
- **Title** (600, 0.9375rem, 1.4): panel titles and the room-map title.
- **Body** (400, 0.875rem, 1.6): rows, lists, buttons and tabs. Totals step up to 1.125rem at 600.
- **Label** (400, 0.8125rem): figure labels, panel meta, chart legends and tooltips, table headers (500).
- **Caption** (400, 0.75rem): room lists under a money row, "left to do" notes, hints and badges (500).

### Named Rules
**The One Face Rule.** Anuphan is the only face loaded and the only face named, in the app, print views, the contract modal, the monthly report, the tenant portal and transactional email. No mono, no second display face, no fallback to Sarabun, Inter or IBM Plex Mono.

**The Tabular Figures Rule.** Every number that can sit above or beside another number (money, counts, room numbers, account numbers, chart ticks) is set with `font-variant-numeric: tabular-nums`.

**The No-Uppercase Rule.** Table headers and labels are sentence case at 500 weight. Thai has no case, and Latin labels match it.

## Layout

The app is a fixed 240px Shell Blue sidebar (80px collapsed) beside a content column centred up to 1200px wide, with a minimum 32px gutter. Below 768px the sidebar becomes an off-canvas drawer opened from a sticky Shell Blue mobile header.

The Dashboard uses a 12-column panel grid with a 16px gap (12px on phones). Panels span 8+4, 7+5, 6+6 or 12. Below 1024px every 8/4 and 7/5 pair becomes full width, and below 768px everything stacks to one column. Panel padding is 20px (16px on phones).

Spacing follows a 4px base scale (4, 8, 12, 16, 20, 24, 32, 40, 48). Inside panels, rows are separated by Mist hairlines with about 10px vertical padding rather than by gaps, which keeps lists reading as a ledger. Breakpoints are at 1024, 768, 480 and 400px; at 400px money rows fold their count under the label so amounts stay right-aligned.

Touch targets are at least 32px for inline link actions and 34px for segmented tabs. Safe-area insets are respected in standalone PWA mode.

## Elevation & Depth

The system is flat. Panels sit on the paper ground separated by a 1px Hairline and, at most, a barely visible `shadow-sm`. Shadows are tinted with Navy Ink (`rgba(16, 42, 67, …)`), not black. Depth appears only on things that genuinely float: chart tooltips and popovers (`shadow-lg`), modals (`shadow-xl`), and the active segmented tab, which lifts with a 1px shadow plus a hairline ring. In dark mode, panels are raised by being lighter than the deep-blue ground, and shadows only darken.

### Shadow Vocabulary
- **Rest** (`box-shadow: 0 1px 2px 0 rgba(16, 42, 67, 0.05)`): base `.card` surfaces. Optional; the hairline does the work.
- **Raised** (`box-shadow: 0 2px 8px -2px rgba(16, 42, 67, 0.09), 0 1px 2px rgba(16, 42, 67, 0.04)`): small menus and popovers.
- **Floating** (`box-shadow: 0 10px 24px -8px rgba(16, 42, 67, 0.16), 0 2px 4px rgba(16, 42, 67, 0.05)`): chart tooltips and dropdowns.
- **Overlay** (`box-shadow: 0 24px 48px -12px rgba(16, 42, 67, 0.24)`): modals and sheets.
- **Focus halo** (`box-shadow: 0 0 0 3px rgba(10, 108, 194, 0.18)`): focused inputs, alongside a Ledger Blue border.

### Named Rules
**The Hairline Rule.** Surfaces are separated by 1px lines, not by shadow or tinted fills. To divide one panel into parts, as the key figures do, split it with hairlines rather than floating four cards.

## Shapes

Corners are gently rounded and consistent by size. Panels and cards use 12px, inputs, buttons, room tiles and row-link hovers use 8px, segmented tracks use 10px (with an inner tab at 7px, so the curves nest), and badges use 6px. Bars (cycle bars, horizontal bar tracks) are full pills, and status dots are circles (8px, or 6px inside tiles). Chart legend keys are 10px squares at a 3px radius, and dashed series keys are a 14px dashed stroke. Borders are always 1px; vacant room tiles switch the border to dashed Strong Hairline, the only dashed border in the system.

## Components

### Buttons
Quiet, rectangular and confident; colour comes only from role.
- **Shape:** gently rounded (8px).
- **Primary:** Ledger Blue fill, white text, 0.875rem at weight 500, 12px by 20px padding. Hover deepens to Deep Ledger Blue. Press scales to 0.98.
- **Secondary:** Mist fill with body text; hover steps to Hairline.
- **Outline:** white with a Strong Hairline border; hover darkens the border and grounds to Cool Paper.
- **Ghost:** transparent with secondary text; hover takes a Mist ground. Used for the Dashboard's customize control (an icon plus a label that hides below 400px).
- **Success / Danger:** green or red fills are reserved for confirming or destroying a state change.
- **Focus:** every focusable element gets a 2px Ledger Blue outline at a 2px offset.
- **Disabled:** 50% opacity.

### Link action
A text-only blue action in a panel head ("จัดการสลิป" plus a chevron): 0.875rem at weight 500, at least 32px tall, with a Blue Wash ground on hover. This is how a panel offers its one next step.

### Segmented tabs
A Mist track with a 1px hairline and 3px padding holds tabs of 0.875rem at weight 500. The active tab is a white chip at weight 600 and Navy Ink colour with a 1px lift. On phones the track spans the full width and the tabs share it equally.

### Cards / Containers (panels)
- **Corner Style:** 12px.
- **Background:** Panel White.
- **Shadow Strategy:** none at rest (see the Hairline Rule).
- **Border:** 1px Hairline.
- **Internal Padding:** 20px (16px on phones). Flush panels drop the padding and let a table run edge to edge under a hairline.
- **Head:** a title on the left and one meta string or link action on the right, at least 28px tall.

### Inputs / Fields
- **Style:** white with a 1px Hairline border, 8px radius, 12px by 16px padding, 0.9375rem, and Steel Heading text.
- **Focus:** the border turns Ledger Blue and gains the 3px focus halo.
- **Select:** a custom chevron sits 12px from the right.
- **Reference fields:** account and reference numbers stay in Anuphan (via the `--font-mono` alias) with tabular numerals.

### Badges
Washed status chips: a 6px radius, 2px by 8px padding, 0.75rem at weight 500, and text in the status text step on its own wash: green on Green Wash for done, Burnt Orange on Orange Wash for waiting ("รอตรวจ"), red on Red Wash for owed. Neutral badges use Mist with secondary text.

### Navigation
The sidebar is Shell Blue with a white logo row above a faint white divider. Nav items are 0.875rem at weight 500 in 82% white with 18px lucide icons at 70% white. Hover adds a 6% white ground and brings icons to 90% white. The active item has a 16% white ground (19% on hover), white text at weight 600, and an Active Orange icon. Category headings (the expandable groups) are never smaller than the pages under them: 0.9375rem at weight 600 in full white, above sub-items at 0.875rem. On phones a sticky Shell Blue header carries the logo and a menu button.

### The Cycle Bar (signature)
The billing cycle's state is drawn as one segmented bar: a 10px pill on a Mist track, with segments separated by 2px gaps, each at least 4px wide and sized by `flex-grow`. In the money panel the segments are paid (green), pending (orange) and unpaid (red), followed by one ledger row per status (dot, label with room list, count, right-aligned tabular amount, chevron when it links). In the to-do panel the same bar at 6px shows progress, with finished work in the Paid green and the remainder left as track; finished counts read in Ledger Green. Segments ease in over 0.6s (`cubic-bezier(0.16, 1, 0.3, 1)`).

### Key figures
One panel, four cells divided by vertical hairlines (a 2x2 grid with a horizontal hairline on phones). Each cell has a label with a small lucide icon in muted steel, a figure value, and an optional sub-line. There are no icon tiles and no tints.

### Room status tiles
A grid with a minimum column width of 76px (68px on phones) and 8px gaps. Tiles are white, 8px radius, hairline border and at least 52px tall, holding a tabular room number at 0.9375rem/600. Occupied is the normal state and stays unmarked (number only; the status lives in the aria-label, and the legend key is a plain outlined tile swatch). Only exceptions get a caption with a 6px status dot: vacant tiles are Cool Paper with a dashed border, muted number and Vacant dot, and reserved tiles take the Orange Wash with a Pending orange dot. Hover only darkens the border.

### Charts
Hand-drawn SVG, coloured entirely through tokens. Gridlines are 1px in chart-grid, the baseline is chart-axis, and ticks are chart-text in tabular numerals. Series are drawn from series and categorical tokens with 2px strokes, round joins, and 3.5 to 4px dots ringed in the surface colour. Targets are a 4/4 dashed line in Paid green; expectations are 5/4 dashed lines. Hover adds a Mist band and a white tooltip with a hairline border and the Floating shadow. Legends use 10px rounded keys.

## Do's and Don'ts

### Do:
- **Do** put the single most important number on the screen in Display (up to 3rem, weight 600, tabular), and let everything else defer to it.
- **Do** separate content with 1px Hairline (`#DCE5EF`) borders and Mist row dividers rather than shadows or tinted boxes.
- **Do** use the cycle bar for any "how much of this cycle is done" reading, with status colours for payment state and Paid green for completed work.
- **Do** use orange for anything still waiting on the owner: Burnt Orange for text on Orange Wash, Waiting Orange for fills and dots.
- **Do** pair every status colour with a text label, count or legend.
- **Do** set every amount, count and room number in tabular numerals and right-align money columns.
- **Do** reference tokens (`var(--color-*)`, `var(--status-*)`, `var(--series-*)`, `var(--cat-*)`, `var(--sidebar-*)`) so dark mode follows automatically.
- **Do** keep the HorCare logo on the Shell Blue shell.

### Don't:
- **Don't** use black or near-black for a shell, ground, panel or text in either theme; the darkest ink is Navy Ink (`#102A43`) and dark mode stays deep blue.
- **Don't** build KPI-tile grids with tinted icon squares, glow dots or progress rings; use one hairline-split figures panel and the cycle bar.
- **Don't** use the legacy `--gradient-*` or `--shadow-glow-success` / `--shadow-glow-orange` tokens on new surfaces; they survive only so unconverted screens still render.
- **Don't** use status green, orange or red tokens to decorate a category tag, an icon or a chart series; categories and series take the series and categorical tokens.
- **Don't** set body text in Waiting Orange (`#F59E2E`); it is a fill step, and Burnt Orange is the text step.
- **Don't** hard-code hex colours in components; inline literals do not switch with `html.dark`.
- **Don't** lift elements on hover with `translateY`; hover changes border, ground or text colour only.
- **Don't** load or name a second typeface (Sarabun, Inter, IBM Plex Mono or any mono) in the app, print views, portal or email; Anuphan carries every role.
