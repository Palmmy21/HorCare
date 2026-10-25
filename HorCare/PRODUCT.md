# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: Thai dormitory owners/managers (also market-stall landlords via the "market" building type). They mostly use the back office on a phone, checking in between other work during the day.

Secondary (confirmed in code, not interviewed): staff/housekeepers with limited roles, and tenants who reach a separate portal from LINE links.

## Product Purpose

HorCare runs a small rental property end to end: rooms and tenants, monthly meter readings, bills, LINE-delivered invoices, slip verification and payments, expenses, ledger/accounting, maintenance, parcels and announcements.

On opening the Dashboard, the owner wants two answers first, with equal weight:
1. How much money has been collected this cycle, and who still owes.
2. Room status and what still needs doing (vacant/occupied, meters not yet recorded, pending work).

Profit/expense trends are secondary.

## Operating Context

- Monthly billing cycle: record meters → save bills → send via LINE → tenants pay and send slips → owner verifies slips.
- Multiple branches/buildings per owner; a building may be a dorm or a market (terminology changes via `getWorkspaceTerms`).
- UI language is Thai; currency is Thai baht.
- Dashboard widgets can be shown/hidden per user (`useDashboardPrefs`).
- An AI assistant ("น้องแคร์ AI") is a tab on the Dashboard.

## Capabilities and Constraints

- React 19 + Vite + TypeScript, plain CSS in `src/index.css` (no CSS framework), lucide-react icons, hand-drawn SVG charts (no chart library).
- Light and dark themes via `html.dark` class (`useTheme`).
- PWA installable; must work well at phone widths.

## Brand Commitments

- Keep the existing HorCare logo (`public/logo.png`, `public/logo-icon.png`, `src/assets/horcare_logo.png`).
- Dark mode must stay fully supported.
- Brand colours are blue, orange and green (confirmed 2026-10-25). The owner does not want black-heavy UI: no black/near-black shell or ink.
- One typeface everywhere (Anuphan), including figures, print views and emails (confirmed 2026-10-25).

## Product Principles

1. Money and to-dos first: the first screen on a phone answers "how much is in, who owes, what's left to do".
2. Phone-first: everything important is reachable and legible at 375px without horizontal scrolling.
3. Calm over flashy: the owner checks this many times a day; it should feel quiet and trustworthy.
4. Thai-first copy and number formatting.
