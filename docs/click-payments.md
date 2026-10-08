# Tariffs, organizations and Click — project overview and integration plan

Written for whoever implements this: an engineer who knows TypeScript but has
not worked in this codebase. Facts about the repository are checked against it
as of 2026-10-04; where this document guesses about Click's API, it says so.

**The short version.** The only thing being sold is a tariff — a plan a
*billing subject* subscribes to. A billing subject is either one user or one
organization whose members share its id. Neither tariffs nor organizations
exist in this codebase today, so this is three projects stacked on each other,
and Click is the smallest of them:

```
1. Organizations      ── a new account shape, touching auth, profiles, listings
2. Tariffs            ── plans, subscriptions, quotas, enforcement
3. Click              ── taking the money for (2)
```

Build them in that order. Each is useful before the next one lands: an
organization is worth having with a free plan, and a tariff is worth having
before anyone can pay for it — you can activate the first subscriptions by
hand from the dashboard.

---

## 1. What the project is

**Growen City** (the code still says `uynest` in places) is an Uzbek
real-estate marketplace in three repositories under `~/projects/qayoda`:

| Repo | Stack | What it is |
| --- | --- | --- |
| `server` | NestJS 11, TypeORM, PostgreSQL + PostGIS, Socket.IO | The API. Nearly all of this work. |
| `mobile` | Expo SDK 57, React Native 0.86, expo-router | The app buyers and sellers use. |
| `admin` | Vite + React 19, React Router, TanStack Query | The moderators' dashboard. |

**Deployment.** One DigitalOcean droplet, 2 GB RAM. The API runs under pm2 as
`uynest-api` from `~/Qayoda-Backend`, in **fork mode, one instance**, behind
nginx at `https://growen.duckdns.org`. The admin dashboard is a static build;
the app ships through EAS. Deploy is `git pull && npm ci --include=dev && npm
run build && pm2 restart uynest-api`.

### What already exists that matters here

- **`src/modules/auth/`** — accounts and sessions. Three ways in (phone OTP,
  Google, Telegram), JWT access + rotating refresh. `UserRole` is `USER |
  ADMIN` and nothing else; there is no notion of a role *within* a group.
- **`src/modules/users/entities/user.entity.ts`** — the account. Carries
  `is_verified_realtor` (the blue badge) and nothing resembling an employer.
- **`src/shared/events/`** — a transactional outbox. `OutBoxService.publish()`
  writes an event row *inside the caller's transaction*,
  `OutboxRelayService` drains it every second under a row lock, and
  `withIdempotency()` makes a handler run once per `(event id, handler)`. This
  is how a payment turns into a subscription exactly once; do not invent a
  second mechanism.
- **`src/modules/auth/telegram-webhook.controller.ts`** — the only endpoint a
  third party currently calls. Read it before writing Click's callbacks; it
  already solves three of the four problems in §7.
- **`src/modules/categories/`** and the admin's `CategoriesPage` — the pattern
  to copy for admin-editable reference data. Tariff plans should be editable
  there rather than hardcoded.
- **`src/modules/verification/`** — the most recently built module, and the
  closest template for a new one: entity, DTOs, service, two controllers
  (public + admin), SQL migration, admin page.

### What does not exist

No organizations, teams, agencies or memberships. No plans, subscriptions,
quotas or entitlements. No payments, orders or invoices. The only trace of
money anywhere is two unused colour tokens in `mobile/src/theme/tokens.ts`
(`payme` teal, `vip` gold — the latter currently borrowed by the star rating).

`SellerType.REALTOR` on a listing is a **label the seller picks**, not a link
to a company, and `is_verified_realtor` is a badge on a person. Neither is an
organization, and neither should be quietly promoted into one.

---

## 2. Billing subjects: user or organization

> An organization is a set of users who share its id. The tariff belongs to
> the organization, not to any member; a user with no organization is billed
> as themselves.

### 2.1 The one abstraction everything hangs off

```ts
/** Who pays, and who the quotas are counted against. */
type BillingSubject =
  | { kind: 'USER'; id: string }
  | { kind: 'ORG';  id: string };

subjectOf(user) = user.organizationId
  ? { kind: 'ORG',  id: user.organizationId }
  : { kind: 'USER', id: user.id };
```

Write this once, in the organizations module, and let every quota check,
subscription lookup and payment order go through it. If two places ever
compute "who is this person billed as" differently, you will have a customer
with two subscriptions and no way to say which is real.

### 2.2 Shape

Literally "members share the same id", so membership is a column on the user
rather than a join table:

**`organizations`** — `id`, `name`, `slug`, `logo_url`, `phone`, `about`,
`owner_id` (the user who can pay and remove people), `created_at`,
`deleted_at`.

**On `users`** — `organization_id uuid null` and `org_role varchar null`
(`OWNER | MANAGER | AGENT`).

One organization per user. A join table would allow somebody to work at two
agencies; for this market that is a rare case bought at the price of a join on
every permission check, and it can be added later without changing the
`BillingSubject` contract. Say no for now.

**Invariants worth enforcing in SQL, not just in code:**

- `organizations.owner_id` must be a user whose `organization_id` is that
  organization — an owner who is not a member is a support ticket waiting to
  happen.
- `org_role` is null exactly when `organization_id` is null.

### 2.3 The questions this forces

Decide these before writing the migration; each one is cheap now and expensive
after there is data.

- **Who do listings belong to?** They carry `owner_id` (a user) today. An
  agency wants its name on the advert and wants the listing to survive an
  agent leaving. Recommendation: keep `owner_id` as the author and add
  `organization_id` for attribution and quota counting, set at creation from
  `subjectOf()`. Do not reassign `owner_id`.
- **What happens when someone joins or leaves?** Recommendation: listings
  created *before* joining stay personal; everything created while a member
  belongs to the org and stays with it when they leave. Anything else means
  rewriting ownership rows at membership time, which is where the support
  tickets come from.
- **Who shows on the profile and the listing card?** An agency listing should
  show the agency, with the agent underneath. That touches `ProfileHeader`,
  the listing seller row and the map preview — all of which now share one
  component, so it is one change, not three.
- **Can an org member see the org's chats?** Recommendation: no, not in the
  first version. Conversations are between two people; making them visible to
  colleagues is a privacy change buyers did not agree to.

---

## 3. Tariffs

### 3.1 Plans

**`tariff_plans`** — admin-editable reference data, like categories and
amenities, not a hardcoded enum. Prices change; deploys should not be how they
change.

| Column | Notes |
| --- | --- |
| `id` uuid | |
| `code` varchar unique | `FREE`, `START`, `PRO`, `AGENCY`. Stable; code may branch on it. |
| `name_uz`, `name_ru` | Shown in the app. |
| `price_uzs` numeric(14,2) | **Price in so'm.** See §7 on why not USD. |
| `period_days` int | 30, 90, 365. Not "months" — month arithmetic is a bug farm. |
| `audience` varchar | `USER` \| `ORG` \| `BOTH`. An agency plan should not be buyable by a lone seller. |
| `limits` jsonb | See below. |
| `is_active` bool | Retiring a plan must not break existing subscriptions. |
| `sort_order` int | |

`limits` as a document rather than columns, because the list will grow and
every new limit would otherwise be a migration:

```json
{
  "activeListings": 20,
  "promotedSlots": 2,
  "members": 5,
  "storiesPerDay": 3,
  "canUseStories": true
}
```

Keep a **`FREE` plan row** rather than treating "no subscription" as a special
case. Then every subject always has a plan, and quota code is one lookup with
no null branch. This is worth more than it sounds.

### 3.2 Subscriptions

**`subscriptions`** — `id`, `subject_type` (`USER | ORG`), `subject_id`,
`plan_id`, `status` (`ACTIVE | EXPIRED | CANCELLED`), `current_period_start`,
`current_period_end`, `auto_renew bool`, `source_order_id`, timestamps.

**One active subscription per subject**, enforced with a partial unique index
— the same trick `verification_requests` uses for one pending application per
user:

```sql
CREATE UNIQUE INDEX "uq_subscription_active"
  ON subscriptions (subject_type, subject_id) WHERE status = 'ACTIVE';
```

Buying while one is active **extends** it (`current_period_end +=
period_days`) rather than creating a second row. Upgrading mid-period is a
product decision — prorate, or start the new plan and forfeit the remainder.
Recommendation: forfeit, say so plainly in the app, and revisit when somebody
complains. Proration is a lot of arithmetic for a rare event.

### 3.3 Entitlements — where the tariff actually bites

One service, one method, called from everywhere:

```ts
entitlements.assert(subject, 'LISTING_CREATE');  // throws QUOTA_EXCEEDED
entitlements.limits(subject);                     // for the app to draw
```

It resolves the active subscription (or `FREE`), reads `limits`, counts what
is in use, and refuses with a code the app can turn into "You are on START,
which allows 5 adverts. Upgrade to post more." A bare 403 teaches nobody
anything.

Call sites to find: listing creation (`ListingsService.create`), promotion if
you add it, story posting (`StoriesService.create` already caps at 20 live per
author — that cap becomes a plan limit), and member invites.

**On expiry, never delete anything.** Block *new* adverts and let the existing
ones stand, or hide the ones over quota while keeping the rows. Listings are
the thing the business is made of and the thing a customer will be angriest
about losing. Downgrade should be reversible by paying.

### 3.4 Lifecycle

```
          buy / admin grant
 FREE ───────────────────────► ACTIVE ──period ends, no renewal──► EXPIRED
                                 │  ▲                                 │
                    extend/renew │  └─────────── buy again ───────────┘
                                 ▼
                             CANCELLED  (auto_renew off, runs to period end)
```

A nightly cron flips `ACTIVE → EXPIRED` where `current_period_end < now()` and
publishes `subscription.expired` on the outbox; a listener sends the SMS and
whatever in-app notice you want. Warn at T-3 days as well — a silent expiry
reads as the app breaking.

---

## 4. Click

> **Verify this section against the current official documentation
> (docs.click.uz) and the parameters in your own merchant cabinet before
> writing code.** The shape below is the long-standing Click Merchant API, but
> Click ships more than one product and details drift between versions. A
> signature algorithm that is subtly wrong fails closed and silently, which is
> an expensive way to find out.

You will be issued **`merchant_id`**, **`service_id`**, **`secret_key`** and a
merchant **`user_id`**.

### 4.1 Sending the payer to Click

```
https://my.click.uz/services/pay
  ?service_id=<SERVICE_ID>
  &merchant_id=<MERCHANT_ID>
  &amount=<so'm, decimal>
  &transaction_param=<your order id>
  &return_url=<deep link back into the app>
```

`transaction_param` is the only thread tying Click's transaction to yours, so
it is your order id, and the order exists in your database before the payer
leaves.

### 4.2 Click calling you back

Two endpoints you implement, server to server, as
`application/x-www-form-urlencoded`:

| Action | Endpoint | Question |
| --- | --- | --- |
| `action=0` | `POST /click/prepare` | "Does this order exist, is it unpaid, is the amount right?" |
| `action=1` | `POST /click/complete` | "The money moved. Deliver." |

Both carry `click_trans_id`, `service_id`, `click_paydoc_id`,
`merchant_trans_id` (your order id), `amount`, `action`, `error`,
`error_note`, `sign_time`, `sign_string`; `complete` adds
`merchant_prepare_id`, the value you returned from prepare.

**The signature** is an MD5 over concatenated fields in a fixed order, roughly:

```
md5(click_trans_id + service_id + SECRET_KEY + merchant_trans_id
    + [merchant_prepare_id, only when action=1]
    + amount + action + sign_time)
```

Compare in constant time; refuse on mismatch. **The exact field order is the
single highest-risk line in this integration** — verify it, do not trust this
document.

You answer with JSON carrying `click_trans_id`, `merchant_trans_id`,
`merchant_prepare_id`/`merchant_confirm_id`, `error` and `error_note`.
`error: 0` is accepted; the negative codes are a fixed vocabulary (signature
failed, bad amount, action not found, already paid, transaction not found,
cancelled). Return the right one — Click's retry and reconciliation behaviour
keys off them.

**Amounts are in so'm with decimals** (`30000.00`), not tiyin. Store `numeric`,
compare with a one-tiyin tolerance, never `===` on a float you did arithmetic
on.

### 4.3 Renewal — the open question

The flow above is **one-off**. Charging a card again next month needs card
binding (Click's token/card API: request a token, confirm it by SMS, then
charge it later without the payer present). I am not confident enough in the
current shape of that API to describe it here, and it usually needs separate
approval from Click.

Recommendation: **ship manual renewal first.** `auto_renew` exists in the
schema from day one but is always false; the subject gets a warning at T-3
days and a "Renew" button that opens the same checkout. Add tokenized
auto-renew as a second phase once the first one is collecting money. Nobody
has ever lost a customer because renewal took two taps.

---

## 5. The design

A new module `src/modules/payments/`, alongside `src/modules/organizations/`
and `src/modules/tariffs/`.

### 5.1 Tables

**`payment_orders`** — one row per attempt to buy, created before the payer
leaves.

| Column | Notes |
| --- | --- |
| `id` uuid | Goes in `transaction_param`. |
| `subject_type`, `subject_id` | Who it is for. Not the payer. |
| `paid_by_user_id` uuid | Who pressed the button — for the ledger. |
| `plan_id` uuid | |
| `amount_uzs` numeric(14,2) | **Frozen at creation.** Never recomputed. |
| `status` varchar | `PENDING → PREPARED → PAID`, or `CANCELLED` / `FAILED`. |
| `provider` varchar | `CLICK`. Payme is the obvious second — do not put `click` in column names. |
| `provider_trans_id` varchar null | |
| `prepared_at`, `paid_at` timestamptz null | |

Index `(subject_type, subject_id)`, `status`, and a unique index on
`(provider, provider_trans_id)` so a replayed callback cannot create a second
record.

**`payment_events`** — every callback stored raw before it is acted on:
provider, action, full body as `jsonb`, whether the signature verified, the
response you sent, timestamp. When somebody says "I paid and got nothing",
this table is the only thing that settles it, and it is what you reconcile
against Click's report.

### 5.2 Endpoints

```
GET  /tariffs                      (public)  the plan list, for the app
GET  /tariffs/me                   (auth)    my subject's plan, limits, usage
POST /payments/orders              (auth)    create an order → checkout URL
GET  /payments/orders/:id          (auth)    poll status
POST /click/prepare                (public, signed)
POST /click/complete               (public, signed)
GET  /admin/payments               (admin)   the ledger
POST /admin/subscriptions/grant    (admin)   activate without payment
```

That last one matters more than it looks: it is how you sell the first ten
subscriptions over the phone while the Click integration is still in review,
and how you compensate somebody whose payment went wrong.

**Who may pay for an organization:** `OWNER` only, or `OWNER | MANAGER`. Pick
one and enforce it in the order endpoint, not in the app.

### 5.3 Delivering the goods

On a verified `complete` with `error: 0`, in **one transaction**:

1. `UPDATE payment_orders SET status='PAID', paid_at=now() WHERE id=$1 AND
   status='PREPARED'` — and check the affected row count. Zero means it was
   already paid: answer "already paid" and do nothing else. This single
   statement is your concurrency control; no locks or flags needed.
2. `OutBoxService.publish('payment.paid', { orderId }, manager)` in the same
   transaction, so the event cannot escape for a payment that rolled back.
3. Commit, answer Click.

A listener on `payment.paid`, wrapped in `withIdempotency()`, starts or
extends the subscription. **Fulfilment never happens inline in the HTTP
handler** — Click is waiting on that response, and a slow or failing side
effect turns a successful charge into a retry storm.

---

## 6. Conventions this codebase expects

Breaking these costs an afternoon each.

- **`synchronize` is off in production.** Every schema change needs a
  hand-written file in `server/sql/` named `YYYY-MM-DD-what.sql`, wrapped in
  `BEGIN/COMMIT`, guarded with `IF NOT EXISTS`, using **TypeORM's own
  generated index and constraint names** so `npm run schema:sql` stays silent
  afterwards. Write the entity, run `npm run schema:sql`, copy the names out
  of its output, write the file, apply with `psql "$DATABASE_URL" -f`.
- **`npm run schema:sql` is the "is my database in sync" check** and should
  print "Your schema is up to date". If it offers to `DROP INDEX`, an index
  exists that no entity declares — declare it, do not drop it.
- **DI errors are runtime-only.** `npm run build` passes and the app dies at
  boot. After wiring a module, start it and look for `Nest application
  successfully started` and your routes in the `RouterExplorer` lines.
- **`src/data-source.ts` loads both `src/**/*.entity.ts` and
  `dist/**/*.entity.js`** — a stale `dist` produces phantom drift.
- **Modules read other modules' entities directly** when they need a column or
  two; cross-module links are plain id columns, never `@ManyToOne`.
- **Admin endpoints** go behind `@UseGuards(JwtAccessGuard, RolesGuard)` +
  `@Roles(UserRole.ADMIN)`, usually a second controller class in the same file
  (see `stories.controller.ts`).
- The server README is partly stale — it describes `src/modules/iam` and
  `src/modules/otp`, now `src/modules/auth`. Trust the code.

---

## 7. The landmines

**The global ValidationPipe will reject Click's callbacks.** `main.ts`
installs `new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true,
transform: true })`. Click posts fields you did not declare and
`forbidNonWhitelisted` turns that into a 400, which Click reads as failure and
retries. The Telegram webhook dodges this by typing `@Body()` as a **plain
interface** rather than a DTO class, so the pipe has no metadata and passes
the body through. Do the same and validate by hand.

**Throttling will turn retries into a storm.** A global `ThrottlerGuard` caps
every route at 100 requests per minute per IP, and Click's callbacks all come
from a few of their addresses. Put `@SkipThrottle()` on the callback
controller, as `TelegramWebhookController` does.

**`growen.duckdns.org` is free dynamic DNS** sitting in the path of your
money. Move to a domain you own before go-live, and ask Click for their
callback source IPs to allowlist at nginx. Signature checking is the real
defence; this is cheap depth.

**One pm2 instance, fork mode.** That is why the outbox relay's
`@Cron(EVERY_SECOND)` is safe today — exactly one process drains it. Scale to
cluster mode or a second droplet and it double-dispatches, including
subscription activation. `withIdempotency()` is what saves you; make sure
every payment listener uses it.

**Price tariffs in so'm, not USD.** Listings are priced in USD and
`RatesService` converts at the Central Bank's daily rate (falling back to a
hardcoded 12 800 if CBU has not answered since boot). If a plan's price is
derived from USD and the rate moves between checkout and callback, the
recomputed amount will not match what Click collected, `prepare` refuses, and
the payer is charged for nothing. A plan that costs "99 000 so'm" has no FX
problem at all. `amount_uzs` is frozen on the order regardless.

**The payer may never come back.** They close the browser at Click's page or
the return deep link fails. The order's truth is the callback, never the app's
navigation. Poll `GET /payments/orders/:id` on return *and* on next launch,
and handle "paid while you were away".

**Quota checks race.** Two agents posting the tenth and eleventh advert at the
same moment both count nine. If that matters, count inside the same
transaction as the insert with `SELECT … FOR UPDATE` on the subscription row —
or accept the occasional one-over, which for an advert quota is fine and for a
paid promoted slot is not.

---

## 8. The mobile side

No new native dependencies: **`expo-web-browser`** and **`expo-linking`** are
already installed, which is all the checkout needs.

1. Seller opens Tariffs (Settings, or a card on the profile tab) and sees the
   plan list from `GET /tariffs`, with their current plan and usage from
   `GET /tariffs/me`.
2. Tapping a plan calls `POST /payments/orders` → `{ orderId, checkoutUrl }`.
3. `WebBrowser.openAuthSessionAsync(checkoutUrl, returnUrl)` where `returnUrl`
   is `Linking.createURL('/payments/return')` — the same `uynest://` scheme
   the story copy-link uses.
4. On return, poll the order until it leaves `PENDING`, with a timeout and a
   "still processing" fallback.
5. Quota refusals come back as a code; show the limit and a route to the plan
   list, never a bare error.

An **organization** also needs: create/edit screens, a member list with
invites and roles, and an org profile page. The profile header is already one
shared component (`src/features/users/components/ProfileHeader.tsx`) used by
the profile screen, the account tab and the listing seller row, so showing an
agency instead of a person is one change in one file.

Add strings to **both** `uz.ts` and `ru.ts` — `uz` is the reference dictionary
and the others are type-checked against its shape, so a missing key is a build
error.

## 9. The admin side

Three pages, all modelled on `src/pages/VerificationPage.tsx` (status tabs,
table, drawer, confirm dialogs):

- **Tariflar** — CRUD over plans, like `CategoriesPage`. Prices and limits
  editable without a deploy.
- **Obunalar** — subscriptions: who is on what, until when, with a **grant**
  action for selling by hand and an **extend** action for compensation.
- **To'lovlar** — the payment ledger, with raw `payment_events` behind each
  row.

Organizations likely want a page too — members, owner, and which listings are
attributed to them.

Wire each into the route table in `App.tsx`, the `NAV` array in
`components/Layout.tsx`, and add counts to `OverviewPage.tsx`.

---

## 10. Testing it

There is no test suite in this repo. What has worked is a throwaway script
booting the real DI container against the dev database — no HTTP, no tokens:

```ts
const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
const svc = app.get(PaymentsService);
// drive the state machine, assert on what the database holds, clean up
```

Put it at `src/something.scratch.ts`, run with `npx ts-node -r
tsconfig-paths/register src/...`, delete it after.

The cases that must pass before production:

- `complete` for an order never `prepare`d → refused.
- The same `complete` twice → paid once, subscription extended once, second
  answered "already paid".
- Tampered `sign_string` → refused, and the attempt recorded in
  `payment_events`.
- Amount one tiyin off → refused.
- Buying while a subscription is active → extended, not duplicated; the
  partial unique index proves it.
- An org member pays → the **organization's** subscription moves, not theirs.
- A user with no org pays → their own subscription moves.
- Subscription expires → `EXPIRED`, new adverts refused, existing ones intact.

Then run a real small payment end to end in Click's test environment.

---

## 11. Order of work

1. **Decide the product.** Plan names, prices in so'm, period, and what each
   limit actually is. Everything below is shaped by this and nothing can start
   without it.
2. **Organizations** — entity, membership columns on `users`, `subjectOf()`,
   listing attribution, profile and member screens, admin page. Ship with
   everyone on `FREE`.
3. **Tariffs** — plans table + admin CRUD, subscriptions, `EntitlementsService`
   and its call sites, the expiry cron, `GET /tariffs` and `/tariffs/me`, the
   app's plan screen. Activate subscriptions with the admin grant endpoint.
   **The product is now sellable by hand.**
4. **Click** — orders, callbacks, signature verification, the state machine,
   the `payment.paid` listener, the mobile checkout, the ledger page.
5. **Reconciliation** — a daily job comparing `PAID` orders against Click's
   report, alerting when either side has one the other does not.
6. **Auto-renewal**, if the numbers justify the extra integration.

Steps 3 and 4 are where to be slow and paranoid. Step 2 is where to be
decisive: the questions in §2.3 get much more expensive once there is data.
