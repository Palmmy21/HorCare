# Payment gateway (HorCare Pay and third parties)

The plumbing is built and tested; no real provider is connected yet. A provider is one file plus one line.

## How it works

1. **Staff ask for a payment request** (`POST /api/payment-gateway`, `action: create_intent`, `target_kind: bill|fine|charge`,
   `target_id`). HorCare works out what is still owed on that document, asks the active provider for a QR / pay link, and
   stores an *intent* (`users/{owner}/buildings/{b}/payment_intents/{id}`) with a short reference `HCxxxxxxxxxx`.
   Asking twice for the same open document returns the same intent.
2. **The tenant pays** the QR / link. The provider knows our reference.
3. **The provider calls** `POST /api/payment-webhook?provider=<id>` with a signed body. HorCare verifies the signature on the
   raw bytes, then applies the event once:
   * bill / fine → one transaction: a `PaymentRec` (`method: qr_gateway`, `verification: verified`, with provider, reference,
     transaction id and fee), the document marked paid (same allocation fields as manual "record payment"), the intent `paid`;
   * collection charge (Supabase) → the same atomic `collections_pay` as cash, tagged `gateway:<provider>` and verified;
   * the ledger books it to the `qr_gateway` channel (default account 1103) automatically for charges.
4. **A wrong amount is never applied.** Short, over, after cancellation, or a document that changed meanwhile → intent
   `needs_review`, an in-app notification, nothing recorded. The owner refunds / tops up by hand.

Retries are safe: an event is claimed in `gateway_events/{provider}__{event_id}` before it is applied (released again if
applying fails, so the provider's retry can succeed), and a settled intent ignores any further "paid".

## Adding a provider

1. Implement `PaymentProvider` (`src/shared/paymentGateway.ts`) in `api/_gateways/<name>.ts`:
   * `createCharge` → `{ provider_ref, qr_payload | pay_url }`;
   * `verifyWebhook(rawBody, headers)` → a normalised `ProviderEvent`, **throwing** (`bad_signature` / `malformed`) on anything
     it cannot trust, `null` for events HorCare does not need;
   * optional `fetchStatus` (reconcile intents whose webhook never arrived) and `refund`.
2. Register it in `api/_gateway-registry.ts` `build()` when its credentials are present.
3. Set `PAYMENT_GATEWAY_PROVIDER=<id>` in Vercel and give the provider the URL shown by `action: status`.
4. Copy the sandbox tests (`api/_payment-gateway.test.ts`) against the new verifier: signature, malformed, retry, wrong amount.

## Environment

| Variable | Meaning |
|---|---|
| `PAYMENT_GATEWAY_PROVIDER` | id of the provider new intents use. Unset = gateway off (`create_intent` answers 503). |
| `PAYMENT_GATEWAY_SANDBOX_SECRET` | enables the fake `sandbox` provider (HMAC-SHA256 of the raw body in `x-sandbox-signature`). Never set in production. |

## Still to build when a real provider is chosen

* Tenant-facing "pay now" (the LINE bill card and the portal calling `create_intent` for the tenant, not only staff).
* A staff screen listing intents and the `needs_review` queue (the API `list_intents` and notification exist).
* `fetchStatus` polling for stale pending intents, refunds from the UI, settlement/payout reports using `fee_satang`.
* VAT on gateway fees, if the provider invoices them.
