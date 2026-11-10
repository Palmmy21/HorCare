# ช่าง / แม่บ้าน ↔ LINE ↔ HorCare — architecture

How technicians and housekeepers connect their LINE account, receive jobs, and work from their own portal.
No staff member ever has a HorCare password: **their LINE account is their identity.**

## The three LINE channels

| Channel | Who talks to it | Webhook | Used for |
|---|---|---|---|
| Tenant OA (one HorCare OA) | tenants | `/api/line-webhook` | bills, slips, tenant portal |
| **Team OA** (HorCare Maintenance) | technicians, housekeepers, admins | `/api/line-staff-webhook` | registration, job cards, **staff portal**, meters, the admin menu |
| Support OA | owners | (push only) | plan expiry notices |

Staff and tenants never share a channel, so a tenant cannot reach staff tooling and vice versa.
Env: `LINE_STAFF_CHANNEL_SECRET`, `LINE_STAFF_CHANNEL_ACCESS_TOKEN`, and `VITE_LINE_STAFF_OA_ID` (the `@id` for add-friend links).

## Identity model

```
users/{owner}/buildings/{building}/staff/{staffId}
    name, phone, role: technician | housekeeping, active, line_user_id, linked_at
```

- One person = one LINE account, possibly **many staff records** (works for several properties or owners).
  The portal finds them all with a collection-group query on `staff.line_user_id`
  (index: `firestore.indexes.json` → `fieldOverrides` → `staff.line_user_id`, COLLECTION_GROUP).
- Housekeeping requests (`cleaning`) are assigned to the property's housekeeper accounts (`housekeepers`, the
  older phone + passcode login). The portal matches a housekeeping staff record to those accounts **by phone number**
  (last 9 digits: `081-111-2222` = `0811112222` = `+66811112222`) within the same property.

## Linking a LINE account (two ways)

```
A. Manager adds the person          B. Person signs up themselves
   ระบบจัดการ → ทีมช่าง/แม่บ้าน          scans the property's QR (HCR- code)
   → "รหัสเชื่อม LINE" (HCS-XXXXXXXX,      → chats with the team OA: role, name, phone
     24 h, one use)                       → manager approves in ทีมช่าง/แม่บ้าน
   → person sends it to the team OA
            \                                /
             staff.line_user_id = <LINE user id>
```

Codes are stored as SHA-256 hashes, expire, are single use, and code attempts are rate-limited per LINE user.

## Jobs reaching the person

1. Manager assigns a work order → `/api/work-orders` (assign) creates a fresh per-job secret, stores only its hash on
   the order (`staff_token_hash`), and pushes a LINE job card with `/?w=<owner~building~order~secret>`.
2. The card opens **StaffWorkPage** for that one job (accept → start → photos → done). Re-assigning or re-sending
   rotates the secret, so old cards stop working.

## Staff portal (all my jobs)

```
person → team OA: "งานของฉัน" (or rich-menu button)
   line-staff-webhook → issuePortalLink(lineUserId)
        only if the LINE id is on at least one active staff record
        token = 24 random bytes; stored as staff_portal_tokens/{sha256} { line_user_id, expires_at: +30 days }
   reply: https://<app>/?sp=<token>

/?sp=<token>  → StaffPortalPage
   POST /api/staff-portal { action: overview, token }
        token → line_user_id → staff records (active) → for each property:
            work_orders where assigned_staff_id == staff.id and status in assigned/accepted/in_progress/completed
            cleaning    where assigned_maid_id ∈ housekeepers with the same phone, not completed/cancelled
   tap a work order → StaffWorkPage in portal mode:
        POST /api/work-orders { action: staff_view | staff_images | staff_update, portal: <token>, job: owner~building~id }
        server checks: token valid, order exists and not closed, its assigned staff is active
                       AND that staff record's line_user_id == the token's LINE id
   housekeeping: POST /api/staff-portal { action: cleaning_update, token, job, status: in_progress | completed }
        server checks the request's housekeeper account has this person's phone at that property
```

Properties of the design:

- **No passwords, nothing to forget.** Lost the link? Type "งานของฉัน" again.
- **Revocation is immediate.** Every call re-reads the staff records: deactivate or unlink someone and their portal
  and every job in it close on the next request, without hunting down tokens.
- **Least data.** The portal returns job fields only — no owner ids beyond the opaque job key, no tenant contact
  details, no other staff. Unknown job, wrong person and wrong secret all answer the same `404`.
- **Per-job cards keep working** alongside the portal; both end in the same server-side checks.
- Tokens, codes and menu state are server-only collections (`staff_portal_tokens`, `staff_links`, `staff_reg_codes`, `staff_line_menus`):
  Firestore rules deny all client access.

## Rich menus: one per kind of person

`scripts/setup-staff-rich-menu.mjs` draws and installs four menus (deploy the server first, then run it):

| Menu | Who | Buttons (each sends that word) |
|---|---|---|
| `register` | everyone not linked — the OA's **default** | ลงทะเบียน · คู่มือ · ช่วยเหลือ |
| `technician` | ช่าง | งานของฉัน · ส่งงาน · ช่วยเหลือ |
| `housekeeping` | แม่บ้าน | งานของฉัน · จดมิเตอร์ · ส่งงาน · ช่วยเหลือ |
| `admin` | a linked HorCare account (owner, manager, front desk) | งานทั้งหมด · ทีมงาน · จดมิเตอร์ · ช่วยเหลือ |

- **Switching.** `api/_staff-menu.ts` `syncStaffMenu(lineUserId)` links the person to the menu `menuFor()` picks
  (admin, else housekeeping, else technician) and unlinks them — back to `register` — when they are no longer
  linked. It runs after every message and follow, on approval, and when a manager deactivates or unlinks someone, so
  the working menu appears the moment registration is approved and disappears the moment access ends. Menus are found
  on LINE by name (`horcare-staff-<menu>`), so reinstalling them needs no configuration; `staff_line_menus/{lineUserId}`
  remembers what was linked to avoid repeat calls. Best effort: a failed switch never fails a reply.
- **No link is baked into a menu.** A button sends a word (`src/shared/staffBot.ts`); the webhook answers with one card
  and one big button whose link is made for that person at that moment. Staff links carry a portal token
  (`/?sp=…`, `&go=next` opens the next job, `&go=meter` the meter page); admin links open the app
  (`/?view=operations&tab=team`, `/?view=recording`) where they sign in with their own account.
- **Admins** link with an `HCO-` code from Settings → การเชื่อมต่อ (`api/_owner-line.ts`): the owner, or a member whose
  role has `finance.read` or `work_order.create`. Access is re-read on every use; a binding whose account lost both is
  deleted. `#ยอด / #ค้าง / #ห้องว่าง` still answer accounts with `finance.read`, but are in no menu.
- **Guide.** `/?guide=staff` (`StaffGuidePage`): registration and daily use in numbered picture steps.

## Housekeepers: meters and photos

- **จดมิเตอร์** → `/?sp=<token>&go=meter` → `POST /api/staff-portal { action: housekeeper_session }` signs the person in as
  the property's **housekeeper account** with the same phone — the session Firestore rules already allow to record
  meters (`isHousekeeper`) — and the app opens on the meter page. If the manager never made that account, one is
  created for LINE sign-in only (`via_line`, no passcode, so the login page cannot open it). A manager's own account
  that is switched off is never reopened this way.
- Deactivating the staff record, unlinking LINE or changing the phone bumps the account's `session_version` (every
  open session ends) and switches a `via_line` account off; reactivating the staff record brings it back.
- **Finished cleaning with a photo**: `cleaning_update { status: completed, photo }` stores the picture in
  `cleaning_images/{id}__done` and marks the request `completion_has_photo`; the manager sees it on งานแม่บ้าน.
- Photos sent into the chat itself are not read; the bot says so and points at "ส่งงาน".

## Files

| Concern | File |
|---|---|
| Team OA webhook | `api/line-staff-webhook.ts` |
| Staff link codes, job links, staff actions | `api/_work-orders.ts` |
| Self-registration chat | `api/_staff-registration.ts` |
| Portal tokens, overview, housekeeping updates, housekeeper sign-in | `api/_staff-portal.ts` |
| Rich menu per person | `api/_staff-menu.ts`, `scripts/setup-staff-rich-menu.mjs` |
| Admin link (HCO-) and figures | `api/_owner-line.ts` |
| Words, menus and wording of the team OA | `src/shared/staffBot.ts` |
| Guide page | `src/components/StaffPortal/StaffGuidePage.tsx` |
| Shared types / ordering / phone matching | `src/shared/staffPortal.ts` |
| Portal page | `src/components/StaffPortal/StaffPortalPage.tsx` |
| One-job page (card and portal) | `src/components/WorkOrders/StaffWorkPage.tsx` |
| Manager side | ระบบจัดการ → ทีมช่าง/แม่บ้าน (`src/components/Operations/StaffTeamTab.tsx`) |
