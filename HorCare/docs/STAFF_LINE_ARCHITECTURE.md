# ช่าง / แม่บ้าน ↔ LINE ↔ HorCare — architecture

How technicians and housekeepers connect their LINE account, receive jobs, and work from their own portal.
No staff member ever has a HorCare password: **their LINE account is their identity.**

## The three LINE channels

| Channel | Who talks to it | Webhook | Used for |
|---|---|---|---|
| Tenant OA (one HorCare OA) | tenants | `/api/line-webhook` | bills, slips, tenant portal |
| **Team OA** | technicians, housekeepers, owners | `/api/line-staff-webhook` | staff linking, job cards, **staff portal**, owner `#ยอด` |
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
- Tokens and codes are server-only collections (`staff_portal_tokens`, `staff_links`, `staff_reg_codes`):
  Firestore rules deny all client access.

## Optional: rich menu

Add a rich-menu button on the team OA whose action sends the text **งานของฉัน**. No code change is needed; the
webhook already treats `งานของฉัน`, `งาน`, `portal`, `my jobs` as a portal request (`src/shared/staffPortal.ts`).

## Files

| Concern | File |
|---|---|
| Team OA webhook | `api/line-staff-webhook.ts` |
| Staff link codes, job links, staff actions | `api/_work-orders.ts` |
| Self-registration chat | `api/_staff-registration.ts` |
| Portal tokens, overview, housekeeping updates | `api/_staff-portal.ts` |
| Shared types / ordering / phone matching | `src/shared/staffPortal.ts` |
| Portal page | `src/components/StaffPortal/StaffPortalPage.tsx` |
| One-job page (card and portal) | `src/components/WorkOrders/StaffWorkPage.tsx` |
| Manager side | ระบบจัดการ → ทีมช่าง/แม่บ้าน (`src/components/Operations/StaffTeamTab.tsx`) |
