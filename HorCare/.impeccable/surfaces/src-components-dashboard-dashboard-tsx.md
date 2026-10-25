---
version: 1
slug: "src-components-dashboard-dashboard-tsx"
primary_target: "src/components/Dashboard/Dashboard.tsx"
related_targets: ["src/index.css","src/components/Accounting/charts.tsx","src/components/RoomManagement/RoomStatusDashboard.tsx"]
---

# Dashboard (back office home)

Mode: Operate. Phone-first (owner checks between other work), desktop secondary. Scope of phase 1: shared tokens/components in src/index.css + Dashboard + room status grid + SVG chart kit.

Audience/job: dorm or market owner answering "how much is in, who still owes, what's left to do this cycle".
Constraints: keep HorCare logo, dark mode, widget toggles (useDashboardPrefs ids), Thai copy, NongCare AI tab.

## Direction contract

THESIS: The dashboard is this month's billing cycle read like a bank statement: one money figure, then the short list of what is unfinished. It refuses the KPI-tile grid with tinted icon squares, gradient accents, glow dots and a progress ring.

OWN-WORLD: Cool paper-white ground (#F5F7FA) with white panels and hairline borders, deep ink-navy shell (#0F1B2D) carrying the logo, one brand blue (#0A6CC2) for actions and selection, status green/amber/red only where state is meant. Anuphan (Thai+Latin workhorse) for everything; tabular numerals in columns. 12px radii, 1px hairlines, shadows almost absent. Dark mode: near-black blue ground, raised panels, same roles stepped for the dark surface.

STORY: Owner opens the app on a phone, sees collected baht vs expected at a glance, sees how many rooms are paid, waiting for slip review, or unpaid, taps through to slips; below, the cycle checklist (meters recorded, rooms vacant) then trends.

FIRST VIEWPORT: Building name as the H1, "ภาพรวม · รอบบิล <month>" beneath, a quiet customize icon; segmented tabs (overview / AI). Then the money panel: hero figure "collected" ≥40px, "of expected · %" line, one stacked status bar (paid/pending/unpaid) with a labelled row per status and outstanding amount, "Manage slips" action at the panel's head. Then room status grid (compact tiles).

FORM: Restrained ledger panels with a signature "cycle bar" — the billing cycle's state drawn as one segmented bar reused for collection and meter progress. Own grounded direction, pinned by the user ("clean & calm, Linear/Stripe-like"), which beats the roll; the roll was run afterwards for provenance and its dealt worlds were not adopted (disclosed). seed:7978da95f82c3305

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
