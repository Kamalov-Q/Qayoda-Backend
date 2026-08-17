# Qayoda API

Backend for **Qayoda**, a real-estate marketplace: property listings drawn as map polygons, with OTP-based accounts and real-time chat between buyers and owners.

Built with [NestJS 11](https://nestjs.com) and TypeScript on PostgreSQL + PostGIS, with Socket.IO for the live layer.

---

## What's inside

| Module | Path | Responsibility |
| --- | --- | --- |
| **IAM** | [`src/modules/iam`](src/modules/iam) | Accounts, JWT access/refresh sessions, password + OTP sign-in, presence flags. |
| **OTP** | [`src/modules/otp`](src/modules/otp) | One-time codes: issue, hash, verify, expire. Shared by register / login / password reset. |
| **Listings** | [`src/modules/listings`](src/modules/listings) | Properties, offers, images, saves, and PostGIS geometry — including viewport queries for the map. |
| **Media** | [`src/modules/media`](src/modules/media) | Image and attachment processing (sharp, ffmpeg), uploaded to Bunny CDN storage. |
| **Chat** | [`src/modules/chat`](src/modules/chat) | Conversations and messages over REST *and* a Socket.IO gateway: delivery/read receipts, typing, presence. |
| **Notifications** | [`src/modules/notifications`](src/modules/notifications) | Event listeners that deliver mail (Resend). |

Cross-cutting pieces live in [`src/shared`](src/shared): TypeORM setup, the transactional outbox, and the throttler config.

### Conventions worth knowing

- **Modules talk through facades, not services.** `IamFacade`, `ListingsFacade`, `OtpFacade` and `ChatFacade` are the only exported surfaces. Entities never hold relations across a module boundary — a listing stores a plain `owner_id`, not a `@ManyToOne` to `User`.
- **Events go through a transactional outbox.** `OutBoxService.publish()` writes the event inside the caller's transaction, so an event can never escape for work that rolled back. `OutboxRelayService` drains the table every second under a row lock and re-emits onto the in-process event bus. Dispatched rows are pruned after 24h — OTP payloads carry plaintext codes.
- **Repositories extend `Repository<T>`** and own the raw SQL. Services stay free of query builders where they can.

---

## Requirements

- Node.js 20+
- PostgreSQL 14+ with the **`postgis`** and **`citext`** extensions

`synchronize` cannot create extensions, so enable them once before the first run:

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS citext;
```

Video and voice attachments shell out to **ffmpeg**/**ffprobe**; install them if you need chat media (`apt install ffmpeg`). Without them, uploads still succeed — duration, dimensions, poster frames and waveforms are simply left `null`.

---

## Setup

```bash
npm install
cp .env.example .env   # then fill in the values below
npm run dev
```

The server listens on `PORT` (default `3000`) and prints its Swagger URL on boot.

### Environment

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection string. TLS is enabled automatically for non-local hosts. |
| `PORT` | no | Defaults to `3000`. |
| `NODE_ENV` | no | `production` disables schema sync; `development` turns on SQL logging. |
| `JWT_ACCESS_SECRET` | yes | Signs the 15-minute access token. Also verifies the socket handshake. |
| `JWT_REFRESH_SECRET` | yes | Signs refresh tokens, which rotate on every use. |
| `JWT_VERIFICATION_SECRET` | yes | Signs the short-lived token handed out after an OTP is verified. |
| `RESEND_API_KEY` | yes | Resend API key for outbound mail. |
| `MAIL_FROM` | yes | Sender address on a domain verified in Resend. |
| `BUNNY_STORAGE_ZONE` | yes | Bunny storage zone name. |
| `BUNNY_STORAGE_KEY` | yes | Bunny storage password. |
| `BUNNY_CDN_URL` | yes | Public CDN base URL, no trailing slash. |
| `BUNNY_STORAGE_HOST` | no | Defaults to `storage.bunnycdn.com`. |

---

## API documentation

Swagger UI is served at **`/docs`** (`http://localhost:3000/docs`) and is the reference for every endpoint — request bodies, response shapes, and the failure cases each route can return. Authorization persists across page reloads, so you can paste an access token once and keep using it.

### Route surface

| Area | Base | Highlights |
| --- | --- | --- |
| Auth | `/auth` | `otp/request`, `otp/verify`, `register`, `login`, `login/otp`, `refresh`, `logout`, `password/*`, `me` |
| Listings | `/listings` | CRUD, `mine`, `saved`, `:id/save`, `:id/offers`, `:id/geometry`, `:id/images`, `:id/restore` |
| Map | `/listings/map` | Viewport query returning listings within the visible bounds |
| Chat | `/chat` | `conversations`, `conversations/:id/messages`, `conversations/:id/read`, `messages/:id` |
| Media | `/media` | `upload` (listing images), `chat/upload` (chat attachments) |

Send the access token as `Authorization: Bearer <token>`. It lasts 15 minutes; refresh with `POST /auth/refresh`, which takes the refresh token **in the body** and rotates it — each refresh token works exactly once.

---

## Realtime chat

The REST endpoints under `/chat` cover the whole feature on their own. The Socket.IO gateway adds the live half: delivery receipts, typing indicators, and presence.

```js
const socket = io('http://localhost:3000/chat', { auth: { token: accessToken } });

socket.emit('message:send', { conversationId, type: 'TEXT', body: 'Salom' });
socket.on('message:new', (message) => { /* … */ });
```

- **Client → server:** `message:send`, `message:read`, `message:edit`, `message:delete`, `typing`, `presence:check`
- **Server → client:** `message:new`, `message:read`, `message:edit`, `message:delete`, `typing`, `presence`, `auth:expired`

Every event payload is documented in the **Realtime** section of `/docs`, with the schemas published under the `Ws*` models. Two details matter in a client:

- On **`auth:expired`** the token was rejected and a disconnect follows — refresh and reconnect rather than retrying blindly.
- Send a `clientId` (a UUID you generate) with `message:send`. It comes back on the stored message so you can reconcile the optimistic bubble, and a retry after a dropped connection returns the original message instead of creating a duplicate.

Attachments are always two steps: `POST /media/chat/upload` first, then send a message carrying the URLs it returns.

---

## Scripts

| Command | Does |
| --- | --- |
| `npm run dev` | Start in watch mode. |
| `npm start` | Start once, no watcher. |
| `npm run start:debug` | Watch mode with the inspector attached. |
| `npm run build` | Compile to `dist/`. |
| `npm run start:prod` | Run the compiled build (`node dist/main`). |
| `npm run lint` | ESLint over `src`, `apps`, `libs`, `test` — autofixes. |
| `npm run format` | Prettier over `src` and `test`. |
| `npm test` / `test:watch` / `test:cov` | Jest unit tests. |
| `npm run test:e2e` | Jest end-to-end suite. |

---

## Before you deploy

- **Write migrations.** `synchronize` is on whenever `NODE_ENV !== 'production'` and will happily drop a column whose entity field was renamed. Production has no migrations yet — that gap needs closing before the first real deploy.
- **Presence is per-process.** The chat gateway tracks live sockets in an in-memory `Map`, so a second instance will not see the first one's connections and delivery receipts will be wrong across them. Scaling out needs the Socket.IO Redis adapter.
- **Enable the Postgres extensions** on the target database, as above.

---

## License

UNLICENSED — private project.
