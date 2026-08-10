# Meal Subscription Partial Payment — Execution Plan

Status: PLAN (not yet executed)
Scope: MEAL category only. KIT and ACCOMMODATION flows are untouched.

## Goal

Allow an admin to onboard a MEAL customer by collecting an **advance amount**
instead of the full Total_Payable, record the **balance due** plus any number of
**partial payments** against that subscription, and block new subscription
purchases while a balance is outstanding.

## Confirmed current state (verified, not assumed)

| Thing | Reality |
|---|---|
| Wizard | `src/shared/components/admin/customers/QuickOnboardingForm.tsx` — one 2,598-line client component. Payment & Review is the inline `step === 3` branch (~L1895). No separate step files. |
| Charges UI | Delivery + Misc + Amount breakup already exist (~L1973–2122), gated only on `primaryCategory === "MEAL"` — rendered regardless of the payment toggle. |
| Toggle | `Switch` bound via `Controller` to `paymentStatus`, mapping checked → `"PAID"` / `"PENDING"` (~L1936–1970). |
| CTA gate | `canOnboard` (L437–443) requires `paymentStatus === "PAID"`. |
| Server action | `onboardCustomerAction` in `src/actions/admin-actions/onboardingActions.ts` (~L137). Reads `deliveryCharge` / `miscCharge` off the **raw** payload, not the Zod schema. |
| Service | `OnboardingService.onboard` (~L283) builds `rpcInput` (L532–605); `payment.amount = calculateTotalPayable(plan, delivery, misc)`. |
| RPC | `public.onboard_customer(payload jsonb)` — latest body in `scripts/add-misc-charge-to-onboard-rpc.sql`. Atomic: users → customer_profiles → subscriptions → payments → addresses → daily prefs. |
| Invoices | **No `invoices` table.** A `payments` row *is* an invoice, discriminated by `invoice_type`. Number derived at render: `` INV-${payment.id.split("-")[0].toUpperCase()} ``. Built by `generateInvoiceData(paymentId)` in `src/lib/invoices/index.ts`; rendered by `src/shared/components/shared/invoice/InvoiceDocument.tsx`. |
| `payments.status` | **No CHECK constraint.** Already holds a legacy `SUCCESS` on 5 rows. Adding `PARTIALLY_PAID` is free at the DB layer. |
| `payments_invoice_type_check` | Constrains to SUBSCRIPTION, ADDON, ACCOMMODATION_STAY, ACCOMMODATION_EXTENSION, ACCOMMODATION_FINAL_INVOICE, ACCOMMODATION_REFUND_INVOICE. **Left untouched** under D3. |
| Missing columns | `payments` has no `amount_paid` / `balance_due`. `subscriptions` has no `total_payable`. |
| Meal balance concept | Does not exist. Every "remaining balance" in the codebase is accommodation-only. |
| Live data | 251 PAID + 28 PENDING + 5 SUCCESS `SUBSCRIPTION` payments rows to backfill. |

## Reference pattern

`scripts/create-stay-payment-lifecycle.sql` already solves this for accommodation:
append-only ledger, balance **never stored** (always derived), `SELECT ... FOR UPDATE`
on the parent row to serialise appends, RPCs returning `jsonb {ok, reason}` instead
of raising, and a partial unique index enforcing one ADVANCE per parent. We mirror
it for subscriptions rather than inventing a second idiom.

## Design decisions

**D1 — Ledger, derived balance.** New append-only `subscription_payment_transactions`
table. `Total_Paid = SUM(CASE WHEN type='REFUND' THEN -amount ELSE amount END)`;
`Balance_Due = subscriptions.total_payable - Total_Paid`. Never stored as truth.

**D2 — Snapshot Total_Payable on the subscription.** Add `subscriptions.total_payable`.
Plan prices change over time; deriving the total from `subscription_plans.price` later
would silently re-price a settled subscription. Mirrors `stay_entries.payment_amount`.

**D3 — Exactly ONE invoice per subscription. Confirmed by the user.**
There is no second "final invoice" document and no per-transaction receipt document.
Onboarding writes the single canonical `invoice_type='SUBSCRIPTION'` row with
`amount = total_payable`, exactly as today, and that one row is the invoice for the
whole life of the subscription. It gains `amount_paid` and `balance_due`, which move
as payments come in.

Consequences, all of them simplifications:
- **No** new `invoice_type` value, so `payments_invoice_type_check` is left alone.
- **No** `is_final_invoice` column. "Final invoice" is a *derived* label:
  `balance_due <= 0`. A stored boolean would be a second source of truth that can
  drift from the ledger.
- The existing pricing breakup section (base price, GST, delivery, misc, total) is
  **not touched** — same calculation, same rows, same code path.
- The invoice grows two additions only:
  1. A status label: **Fully Paid** (⇒ this is the final invoice) or
     **Partial Payment Pending**.
  2. When partial, a block *above* the existing breakup showing **Total Amount Paid**
     and **Balance Remaining**.
- When the balance reaches zero, nothing new is created — the same row's
  `balance_due` hits 0 and the label flips to Fully Paid / Final Invoice.

**D4 — Advance must be > 0.** A zero advance means nothing was collected, which is the
existing PENDING case that onboarding already forbids. Blank delivery charge is rejected;
`0` typed explicitly is accepted (your requirement).

**D5 — Server recomputes the total.** The client's `totalPayable` is display-only. The
action recomputes plan price + delivery + misc server-side and validates
`0 < advance <= total` against *its own* figure.

**D6 — No back-charging.** Existing subscriptions are backfilled as fully paid and
settled, so no current customer is retroactively blocked from buying.

## Phases

### Phase 0 — Audit — ✅ COMPLETE

Every consumer of `payments.status` was traced. Findings, with the exact break each
one would cause if `PARTIALLY_PAID` were introduced blindly:

**A. Revenue aggregation — under-reports.** Six call sites filter
`.in("status", ["PAID","SUCCESS","CAPTURED"])` and `SUM(amount)`:
`src/services/dashboardMetrics.ts` (`REVENUE_PAYMENT_STATUSES`, L356/L471),
`master-actions/biReportActions.ts` L145, `master-actions/customerReportActions.ts` L64,
`master-actions/dashboardActions.ts` L94/L106, `master-actions/biOverviewActions.ts`
L43/L56/L141. A `PARTIALLY_PAID` row drops out entirely, so the advance actually
collected becomes invisible revenue. Naively *adding* the status is worse: `amount` is
`total_payable`, so it would book the unpaid balance as cash.

**B. Invoice button disappears — customer cannot see their own invoice.**
`billing-client.tsx` L51/L222/L231: `showInvoiceButton = isSuccessful || isPendingManual`.
`PARTIALLY_PAID` satisfies neither, so the button is hidden. Worse, the badge at
L293–297 falls through to the red/destructive branch and prints the raw string
`PARTIALLY_PAID`. `Customer360Dashboard.tsx` L1338–1345 has the identical bug.

**C. Invoice document mislabels.** `InvoiceDocument.tsx` L13:
`statusLabel = isPending ? "PAYMENT PENDING" : status` → a green pill reading
`PARTIALLY_PAID`. L14 is the `totalLabel = isPending ? "Amount Due" : "Total Paid"`
line that item 4.4 changes.

**D. Duplicate-invoice guard weakens.** `BillingService.recordOnboardingInvoice` L146–150
keys idempotency on `.eq("status", PAID_STATUS)`. A `PARTIALLY_PAID` row would not be
seen, so a second invoice could be inserted for the same subscription.

**E. Customer 360 totals.** `totalPaid` / `totalPending` (L643–656) bucket by status;
`PARTIALLY_PAID` lands in neither card.

#### Decisions

- [x] 0.2 **Revenue reads `amount_paid` for part-paid rows only.** Keep the existing
      `PAID/SUCCESS/CAPTURED → SUM(amount)` query untouched, and add a second
      `PARTIALLY_PAID → SUM(amount_paid)` term. Historical figures are bit-identical;
      new part-paid rows book exactly the cash collected.
- [x] 0.3 D3 confirmed by the user. Item 4.4 wording ("Total Payable" when partial)
      confirmed by the user.
- [x] 0.4 **`PARTIALLY_PAID` becomes a first-class third state**, not a fall-through.
      Anywhere the code asks "paid or pending", it must now ask "paid, partially paid,
      or pending". Tracked as explicit tasks in Phases 4 and 6.

#### 0.5 — Backfill is NOT required for correctness (important)

The original worry was a deployment window where code is live but the Phase 1.10
backfill has not run, leaving `amount_paid = 0` on 284 rows. Two design choices remove
that dependency entirely:

1. Only the new code path ever writes `PARTIALLY_PAID`, and it always sets `amount_paid`
   in the same insert. Revenue therefore never reads an un-backfilled `amount_paid`:
   historical rows keep status `PAID` and are still summed via `amount`.
2. **The Phase 5 outstanding gate derives from the ledger** (`EXISTS` a
   `subscription_payment_transactions` row with a positive remaining balance), *not*
   from `subscriptions.total_payable`. Existing subscriptions have zero ledger rows, so
   they can never register as outstanding and no current customer gets blocked.

Historical invoices also render unchanged: a legacy `PAID` row has `balance_due = 0`,
so `isFullyPaid` is true, the partial block is gated off by `amount_paid > 0`, and the
total row keeps saying "Total Paid".

Consequence: **the backfill is cosmetic only** (populating `amount_paid` on historical
invoices for reporting hygiene). It is safe to run at the end, as you asked, and safe
never to run. It is no longer a blocker for any phase.

### Phase 1 — Database — ✅ SCRIPTS AUTHORED, ⏳ NOT YET APPLIED

Three scripts written. The MCP Postgres connection is **read-only**, so these cannot be
applied from here — they need running in the Supabase SQL editor, in this order:

1. `scripts/create-subscription-payment-lifecycle.sql` (1.1–1.8)
2. `scripts/update-onboard-customer-with-partial-payment.sql` (1.9)
3. `scripts/backfill-subscription-payment-amounts.sql` (1.10) — **LAST, cosmetic, later**

Pre-flight verified against the live schema: every column the view and RPC reference
exists; `subscriptions.total_payable`, `payments.amount_paid` / `balance_due`,
`subscription_payment_transactions` and `subscription_payment_balances` do **not** yet
exist, so nothing has been applied and script 1 is a clean first run.
Also verified: exactly one `SUBSCRIPTION` invoice per subscription (270 rows, zero
duplicates), and `ADDON` rows carry `subscription_id = NULL`, so the backfill cannot
inflate `total_payable` with add-on purchases.

- [x] 1.1 `subscriptions.total_payable NUMERIC(10,2) NOT NULL DEFAULT 0`.
- [x] 1.2 Table `subscription_payment_transactions`: `id`, `subscription_id`
      (FK → subscriptions ON DELETE CASCADE), `customer_profile_id`, `transaction_type`
      CHECK IN (`ADVANCE`, `PARTIAL_BALANCE_PAYMENT`, `REFUND`), `amount NUMERIC(10,2)
      CHECK (amount > 0)`, `transaction_date DATE`, `payment_method`, `payment_reference`,
      `comment VARCHAR(500)`, `remark VARCHAR(500)`, `created_by`, `created_at`,
      `updated_at` + trigger. Indexes on `(subscription_id, created_at)` and
      `(customer_profile_id)`.
- [x] 1.3 Partial unique index `uniq_subscription_advance_transaction` — at most one
      ADVANCE per subscription.
- [x] 1.4 `payments`: add `amount_paid NUMERIC(10,2) NOT NULL DEFAULT 0` and
      `balance_due NUMERIC(10,2) NOT NULL DEFAULT 0`. Nothing else — per D3 there is
      no `is_final_invoice` column and no new `invoice_type`, so
      `payments_invoice_type_check` is untouched.
- [ ] 1.5 *(dropped — no new invoice_type needed under D3)*
- [ ] 1.6 *(dropped — no separate final-invoice row under D3)*
- [x] 1.7 View `subscription_payment_balances`. **Changed from the original plan: it is
      an INNER JOIN on the ledger, not a LEFT JOIN** (the opposite of
      `stay_payment_balances`). Accommodation created a ledger for every stay, so LEFT
      was right there. Here the 284 legacy subscriptions have no ledger and
      `total_payable = 0`; restricting the view to subscriptions that actually have a
      ledger makes "no ledger ⇒ paid in full at onboarding" structurally true and makes
      it impossible for a future change to `total_payable` to silently mark legacy
      customers outstanding. This is what implements finding 0.5.
- [x] 1.8 RPC `record_subscription_payment_transaction(...) RETURNS jsonb` — row-locked
      append. Reasons: `NOT_FOUND`, `NO_TOTAL_PAYABLE`, `AMOUNT_NOT_POSITIVE`,
      `AMOUNT_EXCEEDS_BALANCE` (+ authoritative `remaining_balance`),
      `REFUND_EXCEEDS_EXCESS`, `DUPLICATE_ADVANCE` (unique_violation trapped and
      translated rather than leaked). Returns the new `total_paid` /
      `remaining_balance` on success. Built now, consumed in the deferred phase.
      Appends to the ledger only — syncing `payments.amount_paid` / `balance_due` is the
      service layer's job, so an invoice-write failure cannot roll back a recorded
      collection.
- [x] 1.9 Update `onboard_customer` (new script, `CREATE OR REPLACE`, based verbatim on
      `add-misc-charge-to-onboard-rpc.sql`): accept an optional `payment_collection`
      block (`paid_in_full`, `amount_paid`); write `subscriptions.total_payable`,
      `payments.amount_paid` / `balance_due` / `status`, and insert the `ADVANCE` ledger
      row — all inside the existing transaction. Omitting the block must behave exactly
      as today (full payment), so KIT and every other caller is unaffected.
- [ ] 1.10 **Backfill — COSMETIC ONLY, run last** (see finding 0.5; separate,
      clearly-labelled script, run only after the UI and business logic are done and
      with explicit approval):
      for existing MEAL/KIT subscriptions set `total_payable = payments.amount`; for
      existing `SUBSCRIPTION` payments rows set `amount_paid = amount` and
      `balance_due = 0` where `status IN ('PAID','SUCCESS')`. Handles the 251 + 5
      settled rows. The 28 legacy PENDING rows stay `amount_paid = 0` /
      `balance_due = amount`, which by the Phase 4.2 gate means they keep rendering
      exactly as they do today (Proforma, no partial block).
      **Confirm before I run it — it writes to live rows.**

### Phase 2 — Server plumbing — ✅ COMPLETE

Verified: `tsc --noEmit` reports **0 errors in production code**. The 65 remaining errors
are all pre-existing, all in `__tests__` files, and none in a file this work touched.
(`onboardingService.property.test.ts:371` fails on `new Date(payload.startDate)` where
`startDate` is optional in the schema — unrelated, and adding an optional 6th parameter
cannot break an existing call.)

Files: `src/types/subscriptionPayment.ts` (new),
`src/services/SubscriptionPaymentService.ts` (new),
`src/repositories/subscriptionPaymentRepository.ts` (new),
`src/repositories/customerOnboardingRepository.ts`, `src/services/OnboardingService.ts`,
`src/actions/admin-actions/onboardingActions.ts`.

- [x] 2.1 `src/types/` — add `SubscriptionPaymentTransaction`, `TransactionType`,
      `SubscriptionBalanceSnapshot { totalPayable, totalPaid, remainingBalance, isFullyPaid }`.
- [x] 2.2 `src/repositories/customerOnboardingRepository.ts` — extend
      `OnboardSubscriptionInput` (`total_payable`), `OnboardPaymentInput`
      (`amount_paid`, `balance_due`, `status`), and add a `payment_collection` block to
      `OnboardCustomerRpcInput`.
- [x] 2.3 New `src/repositories/subscriptionPaymentRepository.ts` — wraps
      `record_subscription_payment_transaction`, maps each `reason` to a typed outcome.
      Mirrors `stayPaymentRepository.ts`.
- [x] 2.4 New `src/services/SubscriptionPaymentService.ts` — also ships
      `syncInvoicePaymentProjection`, which re-projects the ledger onto the single
      invoice row (`amount_paid` / `balance_due` / `status`). Idempotent, so it doubles
      as a drift repair. This is how the invoice flips to Fully Paid / final invoice.
- [x] 2.4b Original 2.4 text —
      `deriveSubscriptionBalance()` in **integer paise** (same discipline as
      `AccommodationService.deriveStayBalance`, avoiding float drift) and
      `getOutstandingBalanceForCustomer(customerProfileId)` returning
      `{ hasOutstanding, totalOutstanding, subscriptions[] }`.
      Per finding 0.5 this MUST be ledger-derived: only consider subscriptions that
      have at least one `subscription_payment_transactions` row. A subscription with an
      empty ledger was a full payment and can never be outstanding — this is what keeps
      all 284 existing rows out of the Phase 5 gate without needing the backfill.
- [x] 2.5 `src/services/OnboardingService.ts` — new optional
      `PaymentCollectionContext { paidInFull: boolean; advanceAmount: number }` param.
      Compute `totalPayable` once, derive `amountPaid` / `balanceDue`, set `status`, and
      populate the new rpcInput fields. Default (absent context) = today's full-payment
      behaviour.
- [x] 2.6 `src/actions/admin-actions/onboardingActions.ts` — read
      `customerPaidFullAmount` and `advanceAmountPaid` from the raw payload (same idiom
      as `deliveryCharge`). Validate: MEAL-only; delivery charge present (blank rejected,
      0 accepted); when not paid in full, `0 < advance <= serverTotal` with ≤ 2 decimals.
      Return pinned field errors. Log an admin audit entry when an advance is taken.

### Phase 3 — Wizard UI — ✅ COMPLETE

All changes in `src/shared/components/admin/customers/QuickOnboardingForm.tsx`.
Verified: 0 TS diagnostics, 0 ESLint errors (2 warnings, both pre-existing unused vars).
Test baseline confirmed unchanged by stashing the file and re-running: **3 failed / 6
passed before and after**, so the 3 failures are pre-existing. The a11y onboarding suite
passes (13 passed overall).

- [x] 3.1 Charges block now gated on `isMealPaymentPanelOpen`
      (`primaryCategory === "MEAL" && paymentStatus === "PAID"`). Previously it rendered
      regardless of the toggle.
- [x] 3.2 Delivery charge mandatory. Derived from `deliveryChargeInput.trim() === ""`
      rather than a new "touched" flag — the empty string already distinguishes "blank"
      from a typed `0`, so no extra state was needed. Field marked `*` with help text
      "Enter 0 if delivery is not being charged".
- [x] 3.3 Checkbox **"Customer paid full amount"**, checked by default.
- [x] 3.4 **"Advance amount paid (₹)"** + live **Balance remaining**, in an amber panel
      so a part payment reads visually differently from a settled one. Validation: > 0,
      ≤ total, ≤ 2 decimals. The ≤ total check is done in **paise**, so an advance that
      exactly equals the total is accepted instead of tripping on float drift.
- [x] 3.5 **"I have confirmed the pricing"** button.
      **Implemented as a snapshot, not a boolean.** State holds
      `confirmedPricingKey` (a join of plan, delivery, misc, label, checkbox, advance,
      payment status, category) and `pricingConfirmed` is derived by comparing it to the
      live key. So *any* change invalidates the confirmation automatically — including a
      field added to this panel later by someone who forgets to wire up a reset. A
      boolean plus a reset effect would rot the first time that dependency list fell out
      of date, and it also tripped `react-hooks/set-state-in-effect`.
- [x] 3.6 Review summary gains **Total payable / Amount collected / Balance due**. The
      latter two appear only once pricing is confirmed — before that the numbers are
      still in flux and would mislead. The Payment row now reads
      "✓ Part payment collected" for an advance.
- [x] 3.7 `canOnboard` extended with delivery-charge presence, advance validity, and
      `pricingConfirmed`; `onboardBlockedReason` extended to match.
      **Also promoted the blocked reason from tooltip-only to an inline banner.** It
      previously covered only the unpaid case and lived in a disabled button's tooltip,
      which is unreachable by touch and easy to miss.
- [x] 3.8 Payload sends `customerPaidFullAmount` + `advanceAmountPaid`.
- [x] 3.9 KIT and ACCOMMODATION untouched. KIT has no payment panel, so it always
      reports `customerPaidFullAmount: true` — byte-identical to its previous behaviour.
- [x] 3.10 Submit-time re-checks for all three new gates. The CTA is already disabled in
      each case; these catch a submit arriving by any other route (Enter key, stale
      render) so the server never rejects after the fact.

### Phase 4 — Invoice rendering — ✅ COMPLETE

Hard constraint honoured: **the pricing breakup was not modified.** Base Price, GST,
Delivery Charges, Miscellaneous and the total amount keep their exact calculation, order,
and markup. Only the total row's *label* changes, and only on a part payment.

Verified: 30/30 invoice tests pass; `tsc` still reports 65 total / **0 non-test** errors
(unchanged); ESLint clean on both touched files (the 3 `no-explicit-any` errors in
`index.ts` are pre-existing `addresses.find((a: any) => ...)` callbacks at L208/324/389,
untouched by this work).

**One intentional visible change to existing invoices:** the header status pill on a
settled invoice now reads **FULLY PAID** instead of the raw status `PAID`. That is the
label you asked for as the final-invoice marker, so it applies to the 251 historical
settled invoices too. Nothing else about them changes.

`payments` was already selected with `*`, so `amount_paid` / `balance_due` needed no
query change.

Phase 4.3 needed no work: all three invoice viewers (admin, franchise, customer portal)
already render through the same `InvoiceDocument` + `generateInvoiceData`, so they all
inherit the change.

Phase 4.5 resolved: `autoPrint` is gated on `!isPending`, and `PARTIALLY_PAID` is not
pending, so a part-paid invoice auto-prints. Correct — it is a real invoice.

- [x] 4.1 `src/lib/invoices/index.ts` — select `amount_paid` / `balance_due` and add
      `amountPaid`, `balanceDue` to `InvoicePricing`, plus a single derived
      `paymentState: "PAID" | "PARTIALLY_PAID" | "PENDING"` on `InvoiceData`.
      Three states, not two booleans — per finding 0.4, `isPending` alone cannot express
      this, and a legacy PENDING row has `balance_due = 0` so a naive
      `isFullyPaid = balanceDue <= 0` would stamp "FULLY PAID" on an unpaid invoice.
      Derive from `status` first, using `balance_due` only for the figures.
      Leave every existing `lineItems` / `pricing` computation untouched.
- [x] 4.2 `InvoiceDocument.tsx` — additions only, no change to the breakup:
      - `statusLabel` (L13) gains a `PARTIALLY_PAID` branch → **PARTIAL PAYMENT PENDING**
        in amber; `PAID` → **FULLY PAID**, which is what marks it the final invoice.
        Without this the pill prints the raw string `PARTIALLY_PAID` in green (finding C).
      - When `paymentState === "PARTIALLY_PAID"`, a block **above** the pricing breakup
        with **Total Amount Paid** and **Balance Remaining**.
      - Legacy PENDING invoices keep today's Proforma rendering with no new block.
      The existing `InvoiceDocument.parity.test.tsx` must still pass unchanged.
- [x] 4.5 `autoPrint` — no change needed, `PARTIALLY_PAID` is not pending so it prints.
- [x] 4.6 Also had to add `paymentState` to the two ACCOMMODATION early-return branches
      (`ACCOMMODATION_FINAL_INVOICE` at ~L244, `ACCOMMODATION_REFUND_INVOICE` at ~L363).
      They build their own `InvoiceData` rather than falling through to the shared return.
      Meal balance is passed as 0 there on purpose — accommodation keeps its balance in
      `stay_payment_transactions`, so a PAID stay invoice resolves to `PAID` and renders
      identically to before.
- [x] 4.7 Updated the two hand-built fixtures in `InvoiceDocument.parity.test.tsx` with
      `paymentState: "PAID"`. It is the only place outside `generateInvoiceData` that
      constructs `InvoiceData`. Parity still holds — both fixtures are settled, so both
      render the same branch.
- [x] 4.3 No work needed — admin, franchise and customer-portal viewers all render
      through the shared `InvoiceDocument` + `generateInvoiceData`.
- [x] 4.4 **Total row label** — ✅ wording confirmed by the user.
      `InvoiceDocument.tsx` L14 is currently
      `totalLabel = isPending ? "Amount Due" : "Total Paid"`. Extend to a three-way:
      `PENDING → "Amount Due"`, `PARTIALLY_PAID → "Total Payable"`,
      `PAID → "Total Paid"` (unchanged, so existing invoices are byte-identical).
      Label swap only; the amount and its calculation are untouched.

### Phase 5 — Outstanding-balance gates — ✅ COMPLETE

Verified: `tsc` unchanged at 65 total / **0 non-test** errors. ESLint baselined by
stashing the 10 modified files and re-running: **18 errors / 5 warnings before and
after** — all `no-explicit-any` in files that were already heavily `any`-typed, none
introduced here.

Security check performed: the new `subscription_payment_balances` view bypasses RLS (it
is not `security_invoker`), so I verified the grants. `anon` and `authenticated` have
**no SELECT** on either the view or `subscription_payment_transactions` — only
REFERENCES/TRIGGER/TRUNCATE, which are inert Supabase default-grant artifacts. Access is
`service_role`/`postgres` only, identical to the existing `stay_payment_balances`. So a
logged-in customer cannot read another customer's balance via PostgREST.

**Key placement decision — the payment gate is PRE-payment, not at activation.**
`verifyAndActivateSubscriptionAction` and `checkAndReconcileSubscriptionPaymentAction`
both funnel into `activateSubscription`, which looked like the ideal single choke point.
It is the wrong one: by the time it runs, Razorpay has already captured the customer's
money, so refusing there would take payment and withhold the subscription. The gate
therefore lives in `createRazorpayOrderAction`, before any money moves, and activation is
deliberately left ungated. Residual race: a balance recorded between order creation and
payment still lets that subscription activate — correct, since the customer paid for it
and the older balance remains owed independently.

- [x] 5.1 Customer portal. New `OutstandingBalanceBanner` (rose, so it is distinct from
      the amber profile-incomplete banner — both can show at once and need different
      remedies) on `subscription/page.tsx`, plus every plan card's CTA replaced with a
      disabled **Balance Due** button. The balance check is ordered *before* the profile
      gate: completing a profile unlocks nothing while money is owed.
      `checkout/page.tsx` redirects back to `/subscription`, where the explanation lives —
      rendering an unusable wizard would strand the customer.
- [x] 5.2 Server enforcement in `createRazorpayOrderAction`. See the placement note above
      for why activation is intentionally excluded.
- [x] 5.2b **Fixed a pre-existing bug found while wiring this.**
      `step-5-preview.tsx` threw a hardcoded `"Could not create order"` and discarded
      `orderRes.error`, so no server-side rejection reason ever reached the customer — the
      new gate message included. It now surfaces the actual error.
- [x] 5.3 `addSubscription` and `franchiseAddSubscription` both reject with the pinned
      admin message plus the amount outstanding.
- [x] 5.4 `AdminAddSubscriptionForm.tsx` now keeps a persistent inline `Alert` alongside
      the existing toast. A toast that vanishes in seconds is the wrong home for a figure
      the admin has to collect against.
- [x] 5.5 Bulk import exempted via a new `skipOutstandingBalanceCheck` option, matching
      the existing `skipStartDateCheck` / `skipOverlapCheck` idiom. Migration replays
      historical subscriptions that predate the concept, so the gate would fail an import
      on data that is not in arrears.
- [x] 5.6 **Accommodation dues — decided: NOT included.** 7 subscriptions carry an
      `ACCOMMODATION_STAY` invoice, and accommodation already has its own outstanding
      balance in `stay_payment_transactions`. Should an unpaid *stay* balance also block
      buying a new *meal* subscription? Current plan: **no** — the gate reads the meal
      ledger only, matching your stated requirement. Ask before widening it.

### Phase 5.5 — Customer 360 "Subscription" tab — ✅ COMPLETE (interim, user-requested)

Inserted between Phases 5 and 6 at the user's request, after they verified the onboarding
flow live (₹18,583 total, ₹5,000 advance, ₹13,583 outstanding, `PARTIALLY_PAID` invoice,
one `ADVANCE` ledger row — all confirmed in the database).

- [x] Renamed the tab **"Add Subscription" → "Subscription"**. Tab names double as
      `?tab=` deep-link values, so the old name is still accepted and normalised to the
      new one rather than silently falling back to the default tab.
- [x] New `getSubscriptionPaymentOverview(customerProfileId)` in
      `SubscriptionPaymentService`. Returns per-subscription summaries plus
      `hasOutstanding` / `hasRefundDue` / `canAddSubscription`.
      **Figures are resolved from payment STATE, not from the raw columns**, so the card
      is correct with or without the cosmetic backfill: a legacy settled invoice still has
      `amount_paid = 0`, and reading that column blindly would show "Paid ₹0.00" against a
      subscription that was paid in full long ago.
      Includes terminal subscriptions that still carry a balance — that is exactly the
      thing blocking a new sale, so hiding it would leave the admin unable to see why.
- [x] New `SubscriptionPaymentSummaryCard`: headline Total Payable / Amount Paid /
      Balance Remaining, the itemised breakup (same lines the invoice prints, so the two
      reconcile), the payment ledger, and a link to the invoice. Colour-coded amber for
      balance due, sky for refund due, emerald for settled.
- [x] Add New Subscription form **hidden** unless every existing subscription is exactly
      settled (zero balance AND zero refund). Hidden rather than disabled: a form that
      cannot be submitted invites the admin to fill it in and then discover it was
      pointless. Replaced by a card naming the blocking amount. The Add flow itself is
      untouched, as requested.
- [x] Wired through both the admin and franchise customer pages.
- [x] Reverted an initial overreach: I had made the tab visible to Dietitians since it now
      carries read-only content. That contradicts documented Req 5.10/16.1 and was not
      asked for, so Dietitian behaviour is unchanged — they still do not see the tab.

Verified: `tsc` 65 total / **0 non-test** errors (one genuine new error — a missing
`TriangleAlert` import — was caught and fixed). Both new files are ESLint-clean.
`Customer360Dashboard` baselined by stashing: 8 problems (1 error, 7 warnings) before and
after. Dietitian read-only property test baselined the same way: 2 failed / 6 passed
before and after, so those failures are pre-existing.

**Open question for the user:** this UI gate blocks on a pending *refund* as well as an
outstanding balance, per your instruction ("0 outstanding balance or 0 refund balance").
The Phase 5 *server* gates (`addSubscription`, `franchiseAddSubscription`,
`createRazorpayOrderAction`) still block only on a positive balance. Worth aligning them
to also reject a pending refund — say the word and I will.

### Phase 5.6 — Record Balance Payment form — ✅ COMPLETE (was "Deferred")

This is the item the plan listed under **Deferred**. The user asked for it next, so it is
done now. The RPC (1.8), repository (2.3) and `syncInvoicePaymentProjection` (2.4) were
already built for exactly this, so only the action, schema and form were new.

New files:
- `src/validations/subscriptionPaymentSchema.ts` — amount bounds, payment method,
  reference, note, business date. Deliberately does **not** validate against a
  client-supplied balance; that answer belongs to the row-locked RPC.
- `src/actions/admin-actions/subscriptionPaymentActions.ts` —
  `recordSubscriptionBalancePaymentAction`.
- `src/shared/components/admin/customers/RecordSubscriptionPaymentForm.tsx` — rendered
  inside the summary card only while `balanceDue > 0`, so the UI offers no route to
  over-collecting.

Behaviour: enter ₹10,000 against the live ₹13,583 balance → ledger gains a
`PARTIAL_BALANCE_PAYMENT` row, the invoice projection moves to
`amount_paid = 15,000` / `balance_due = 3,583`, and the card, the Payments Collected list
and the Add-Subscription gate all re-render from `router.refresh()`. Clearing the balance
flips the invoice to `PAID`, which is the FULLY PAID / final-invoice state, and the Add
New Subscription form reappears.

Decisions worth recording:

- **Authorisation covers both portals with an ownership check.** `checkGroupManage`
  admits only ADMIN/MASTER_ADMIN, but the Customer 360 dashboard is shared with the
  franchise portal. The action therefore branches: ADMIN/MASTER_ADMIN through
  `checkGroupManage`, FRANCHISE_ADMIN through a `users.franchise_id` lookup compared
  against `subscriptions.franchise_id`. Without that comparison one franchise could
  record payments against another franchise's customers.
- **A projection failure does not roll back the collection.** The ledger append and the
  invoice re-projection are deliberately not atomic. Money genuinely taken from a customer
  must never be discarded because a denormalised cache could not be refreshed; the sync is
  idempotent, so a later call repairs the drift. That path returns a warning telling the
  admin to reload, not a failure implying nothing was recorded.
- **The server returns the authoritative balance on rejection.** If two admins collect
  concurrently, the second submit is rejected with the real remaining balance derived
  inside the row lock, rather than silently over-collecting.
- **Client-side amount check is in paise**, so a payment that exactly clears the balance
  is accepted instead of tripping on float drift. A "Full" button prefills the exact
  balance for the common case.

Verified: `npm run build` **succeeds** (compiled in 2.0 min, 58/58 static pages) — the real
check that the server/client boundaries hold, since the card is a client component importing
types from a server-only service. `tsc` 65 total / **0 non-test** errors. All four new files
ESLint-clean. RPC argument names verified against `pg_proc` before wiring the repository.
`revalidatePath` follows the project's existing `/admin/customers/{id}` convention (both
portal paths invalidated, since the action serves both).

### Phase 5.7 — Card restyled to match the Accommodation card — ✅ COMPLETE

User request: make the meal subscription card look and behave like the Accommodation
"Stay Overview" card, and add a **% collected progress bar** to the payment summary.

`SubscriptionPaymentSummaryCard` was rewritten against `AccommodationTab.tsx` as the
reference rather than approximated by eye — same `border-primary/20 bg-primary/5` shell,
same `CardHeader pb-3` + status-badge row, same orange alert banner idiom, same icon-led
4-column detail grid, same `border-t pt-4` section rhythm, and the same boxed
`sm:divide-x` Total / Paid / Remaining trio.

Specifically matched, not reinvented:
- **Status badge palette** copied case-for-case from `getStatusBadgeClasses`, so ACTIVE /
  PENDING / EXPIRED mean the same colour in both tabs.
- **Progress bar** uses the accommodation formula
  (`round(paid / total * 100)`, clamped 0–100), the same `h-1.5 rounded-full bg-muted`
  track, emerald when settled and amber when not, the same `role="progressbar"` +
  `aria-valuenow/min/max`, and the same `{n}% collected` caption with the
  `· Refund due ₹X` suffix.
- **Alert banner** mirrors the awaiting-checkout banner: name the amount, then say what
  to do about it.

Meal-specific adaptations:
- Grid reads Plan / Category / Start Date / End Date; the sub-row shows plan **days**
  where a stay shows **nights**, plus the subscription code and payment method.
- Headline trio uses whole rupees like the accommodation card; the Price Breakup and
  Payments Collected rows stay paise-accurate so they still reconcile against the invoice
  line by line.
- Added `totalDays` to `SubscriptionPaymentSummary` to feed the duration row.
- `RecordSubscriptionPaymentForm`'s shell changed from an emerald panel to the neutral
  `rounded-lg border bg-background/80` used by the card's other inner boxes, so it reads as
  part of the overview rather than as a competing panel. Hard-coded `bg-white` inputs
  dropped for the same reason.

Verified: `npm run build` succeeds (102s, 58/58 static pages), 0 TS diagnostics, ESLint
clean on all three touched files.

### Phase 5.8 — Fixed a pre-existing auto-print bug — ✅ COMPLETE

Surfaced while the user was testing the balance-payment flow. **Not caused by this
feature** — confirmed via `git diff`, the offending block is untouched original code.

`InvoiceDocument` rendered its auto-print trigger as an inline
`<script dangerouslySetInnerHTML>`. React does not execute script tags rendered inside a
component tree, so the browser logged *"Encountered a script tag while rendering React
component"* and **the print dialog never opened**. The approach was broken twice over: it
hung the call off `window.onload`, which has usually already fired by the time React
hydrates, so even an executed script would have missed the event.

Replaced with `AutoPrintTrigger`, a small client component that:
- prints from `useEffect`, guarded by a ref so React's development Strict Mode double-invoke
  does not stack two print dialogs;
- waits for `document.readyState === "complete"` (or a one-shot `load` listener) before
  printing, because the invoice contains a logo `<img>` and printing early yields a
  logo-less PDF — the one artefact of this page a customer actually receives;
- allows one animation frame so the final layout pass commits before the dialog freezes
  the page.

Gating is unchanged: real invoices print, an unpaid Proforma does not, and a
`PARTIALLY_PAID` invoice does (it is a genuine document).

Verified: 30/30 invoice tests pass, `npm run build` succeeds (113s, 58/58 pages), ESLint
clean apart from a pre-existing `<img>` warning.

Also confirmed the live end-to-end result in the database — invoice `amount = 18,583`,
`amount_paid = 18,583`, `balance_due = 0`, `status = PAID`, and the ledger sums to exactly
`18,583` across three rows (₹5,000 advance + ₹2,000 + ₹11,583). Projection and ledger agree,
so the invariant holds.

### Phase 5.9 — Add Subscription brought to parity with onboarding — ✅ COMPLETE

User request: the Add Subscription form (for an already-onboarded customer) should offer
the same options as the onboarding wizard — miscellaneous charges, advance payment,
remaining balance — for **both** Existing Plan and Custom Plan modes.

**Server** — `addSubscription` (`adminSubscriptionActions.ts`):
- `baseSchema` gains `miscCharge`, `miscChargeLabel`, `customerPaidFullAmount`,
  `advanceAmountPaid`. All default to "not charged / paid in full", so bulk migration and
  every other caller behave exactly as before.
- Total_Payable resolved **before any insert**, so a rejected advance leaves nothing behind.
  Mode-aware: an existing plan's `totalAmount` excludes delivery and needs it added; a
  custom plan's already includes it (per the form's two `setValue` effects). Misc is added
  on top in both cases.
- Writes `subscriptions.{misc_charge, misc_charge_label, total_payable}` and
  `payments.{misc_charge, misc_charge_label, amount_paid, balance_due, status}`.
- `status` is now three-way: `PENDING` / `PARTIALLY_PAID` / `PAID`.
- ADVANCE ledger row written **after** the invoice row succeeds — this action is a sequence
  of separate inserts rather than one transaction (pre-existing), so ordering is the only
  consistency lever available; a failed payments insert must not leave a ledger claiming
  money against an invoice-less subscription.
- An advance equal to the total collapses to a full payment, preserving the
  "no ledger ⇒ paid in full" invariant the outstanding gate depends on.

**UI** — `AdminAddSubscriptionForm`: Miscellaneous Charges section, live Amount Breakup
(reusing an `AmountRow` helper mirroring the wizard's), the "Customer paid full amount"
checkbox with advance input and live Balance remaining, and the "I have confirmed the
pricing" gate. All shown for both modes. The payment-collection block appears only when
Payment Status is "Payment Collected" — a part payment of nothing is just the existing
Pending case. Submit is disabled on charge errors, a missing advance, or an unconfirmed
part payment. Local state is explicitly cleared on success, since `reset()` only clears
react-hook-form fields and the next subscription would otherwise inherit the previous
one's misc charge and advance.

#### Two bugs found and fixed along the way

1. **`franchiseAddSubscription` was silently discarding money fields.** It declares its
   OWN `baseSchema`, and Zod strips unknown keys — so the shared form's new misc/advance
   fields would have been dropped, creating the subscription at the wrong price with no
   error. **`deliveryCharge` was already being lost this way before this feature**, so
   franchise-created subscriptions have never recorded a delivery charge. Both actions are
   now at parity, including the ADVANCE ledger row.
2. **The action signatures used `z.infer` (output type) instead of `z.input`.** Because
   defaulted fields are *required* in the output type, adding any new defaulted field
   immediately broke `bulkImportActions.ts` at compile time. Corrected to `z.input`, which
   is what a function that parses its argument should accept.

Known legacy path left alone: the payments-insert fallback for environments missing the
invoice-breakdown columns still records `PAID`/`PENDING` at the plan amount. It cannot
trigger in this database (all columns exist) and rewriting it is out of scope.

Verified: `tsc` 65 total / **0 non-test** errors; ESLint back to the exact pre-change
baseline (7 problems, 3 errors, 4 warnings — all pre-existing, confirmed by stashing);
`npm run build` succeeds (52s, 58/58 pages).

### Phase 5.10 — Delivery charge made mandatory on Add Subscription — ✅ COMPLETE

Brings the Add Subscription form in line with the onboarding wizard (Phase 3.2): blank is
rejected, an explicit `0` is accepted.

- Form: field marked `*` with help text ("Enter 0 if delivery is not being charged"),
  inline error, `aria-invalid`, and the Create button disabled while blank. Derived from
  the raw input string, since `""` already distinguishes blank from `0` — no extra state.
- Submit-time re-check in `performSubmission` for all four gates (delivery, charge errors,
  advance, pricing confirmation), catching a submit that arrives via the Enter key or a
  stale render.
- Server: both `addSubscription` and `franchiseAddSubscription` reject a missing delivery
  charge. **Checked against the RAW `formData`, not `parsed.data`** — the schema's
  `.default(0)` erases the difference between "0 was entered" (free delivery) and "the
  field never arrived" (the admin forgot), which mean opposite things. Bulk migration
  always sends the field explicitly, so it is unaffected.

Also fixed a related display bug spotted in the user's screenshot: clearing the delivery
charge left the `"487.63 km × ₹13.00/km"` note behind, so the breakup showed a
distance-derived note next to a **₹0.00** delivery line. The note is now cleared with the
value. That figure is quoted to customers, so a stale note beside a zero was worth fixing.

Verified: `tsc` 65 total / **0 non-test** errors; ESLint at the pre-change baseline
(7 problems, all pre-existing); `npm run build` succeeds (58s, 58/58 pages).

### Phase 6 — Display — ✅ COMPLETE

All 8 items addressed. Build succeeds (68s, 58/58 pages). `tsc` at 65 total / **0 non-test**.

- [x] 6.1 `src/app/admin/(main)/customers/[id]/page.tsx` — payments select gains
      `delivery_charge`, `misc_charge`, `misc_charge_label`, `amount_paid`, `balance_due`.
- [x] 6.2 `Customer360Dashboard.tsx` Billing tab — `totalPaid` card now includes
      PARTIALLY_PAID rows (reading `amount_paid`), and `totalPending` card includes their
      `balance_due`. `BillingPayment` interface extended.
- [x] 6.3 Customer portal `billing-client.tsx` — `StatusPill` now renders "Partially Paid"
      in amber instead of the raw status string in red (finding B). Invoice button shows.
- [x] 6.4 Franchise customer page — same payments select additions as 6.1.
- [x] 6.5 **Finding B — invoice button hidden.** Both `billing-client.tsx` and
      `Customer360Dashboard` now include `PARTIALLY_PAID` in the `showInvoiceButton` check.
- [x] 6.6 **Finding E — Billing cards.** PARTIALLY_PAID rows now bucket correctly into
      the Total Paid and Pending Collection summary cards.
- [x] 6.7 **Finding A — revenue.** All 6 aggregation sites now add a second
      `PARTIALLY_PAID → SUM(amount_paid)` term alongside the existing
      `PAID/SUCCESS/CAPTURED → SUM(amount)` query:
      `dashboardMetrics.ts`, `biReportActions.ts`, `customerReportActions.ts`,
      `dashboardActions.ts` (current + previous period), `biOverviewActions.ts`
      (MRR + previous MRR + revenue growth trend). Historical figures cannot shift: the
      only `PARTIALLY_PAID` rows that exist are the ones this feature creates, and each
      was previously invisible to revenue. Adding them in books exactly the advance that
      was actually collected — no more, no less.
- [x] 6.8 **Finding D — idempotency guard.** `BillingService.recordOnboardingInvoice`
      now queries `.in("status", ["PAID", "PARTIALLY_PAID"])`, so a part-paid subscription
      can never receive a duplicate invoice through the non-RPC path.

### Phase 7 — Verification — ✅ COMPLETE

- [x] 7.1 **`npm run build` clean.** Compiled successfully (69s, 58/58 static pages).
      `npm run lint`: 844 problems across 354 files — **all pre-existing**. Every file
      this feature introduced (`src/types/subscriptionPayment.ts`,
      `src/services/SubscriptionPaymentService.ts`,
      `src/repositories/subscriptionPaymentRepository.ts`,
      `src/validations/subscriptionPaymentSchema.ts`,
      `src/actions/admin-actions/subscriptionPaymentActions.ts`,
      `src/shared/components/admin/customers/SubscriptionPaymentSummaryCard.tsx`,
      `src/shared/components/admin/customers/RecordSubscriptionPaymentForm.tsx`,
      `src/shared/components/customer/subscription/plans/OutstandingBalanceBanner.tsx`,
      `src/shared/components/shared/invoice/AutoPrintTrigger.tsx`) lints **0 errors,
      0 warnings** individually.
- [x] 7.2 **Unit tests written and passing.** `subscriptionPaymentService.test.ts`:
      15 tests covering paise-based balance derivation (empty ledger, advance, partial,
      refund, over-collection, string amounts from the DB driver, float-drift edge cases
      with real-world totals, the payment-state resolver with three-state logic,
      case-insensitivity, tiebreaker when status and balance disagree).
- [x] 7.3 **Parity with the billing service.** The `billingService.property.test.ts`
      property tests (4 properties, all originally failing because the idempotency guard
      was changed from `.eq` to `.in`) were fixed by adding `.in()` support to the
      in-memory fake client. All 4 pass. The billing service now correctly rejects a
      duplicate invoice for a `PARTIALLY_PAID` subscription as well as for a `PAID` one.
      **All 49 invoice + billing tests pass (9 test files).**
- [ ] 7.4 **Manual test matrix** — to be performed by the user. The code-verifiable part
      of Phase 7 is complete.

## Deferred (your call, explicitly later)

- Customer 360 UI to collect balance payments (consumes the Phase 1.8 RPC and the
  Phase 2.3 repository, both built as part of this work). That UI updates
  `payments.amount_paid` / `balance_due` on the single invoice row, which is what flips
  the label to Fully Paid / final invoice — no new document is created.
- A per-transaction payment receipt document. Not needed for the single-invoice model;
  revisit alongside the collection UI if you want printable receipts per instalment.

## Risks

1. ~~`PARTIALLY_PAID` leaking into revenue reporting~~ — **closed by Phase 0.** All six
   aggregation sites identified; fix is additive (items 6.5–6.8) and leaves historical
   figures unchanged.
2. ~~Backfill ordering~~ — **closed by finding 0.5.** Neither revenue nor the outstanding
   gate depends on backfilled data, so the script is cosmetic and can run last or never.
3. **`onboard_customer` is shared** by MEAL, KIT, and bulk import. Changes must be
   strictly additive with the new `payment_collection` block optional. Still open.
4. **`QuickOnboardingForm.tsx` is 2,598 lines** with the charge fields held in local
   state *outside* the Zod schema. Phase 3 stays surgical; no refactor bundled in.
   Still open.
5. **`PARTIALLY_PAID` is a third state, not a boolean.** Findings B, C, E all came from
   code asking "paid or pending?". Any new read of `payments.status` added from here on
   must handle three states.
