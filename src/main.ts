import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { PaynetParseErrorFilter } from './modules/billing/providers/paynet/paynet-parse-error.filter';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import {
  WsConversationDto,
  WsEditMessageDto,
  WsMessageIdDto,
  WsPresenceCheckDto,
  WsSendMessageDto,
  WsTypingDto,
} from './modules/chat/dto/ws-events.dto';
import { PresenceResponse } from './modules/chat/responses/receipt.response';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });

  // Behind nginx on the same host: take the client IP from X-Forwarded-For,
  // or Paynet's IP allowlist sees 127.0.0.1 for every call.
  app.set('trust proxy', 'loopback');
  // Malformed JSON on /api/paynet must still be a JSON-RPC answer (-32700).
  app.useGlobalFilters(new PaynetParseErrorFilter(app.get(HttpAdapterHost).httpAdapter));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  /**
   * CORS: an allowlist, not a mirror.
   *
   * This was `{ origin: true, credentials: true }`, which reflects whatever
   * Origin the caller sends and tells the browser credentials are welcome.
   * That was survivable while every client authenticated with a Bearer token
   * held in app memory — a third-party page could make the request but had
   * no token to attach, so it got nothing useful back.
   *
   * It stops being survivable the moment the web app keeps its refresh token
   * in a cookie, because the browser attaches cookies by itself. Reflecting
   * any origin with credentials enabled would then let ANY website call
   * /api/auth/refresh with the visitor's cookie and read the access token
   * out of the response. That is full account takeover from a page the user
   * merely visited.
   *
   * So: named origins only. Requests with NO Origin header — the mobile app,
   * curl, the payment providers' server-to-server webhooks — are allowed
   * through untouched, because CORS is a browser mechanism and has nothing
   * to say about them.
   */
  const allowedOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);

  app.enableCors({
    origin(origin, callback) {
      // No Origin: not a browser. Native app, webhook, health check, curl.
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin.replace(/\/+$/, ''))) {
        return callback(null, true);
      }
      // Outside production nothing is deployed and localhost ports move
      // around; refusing them turns every front-end experiment into a CORS
      // hunt. Production is strict.
      if (process.env.NODE_ENV !== 'production') return callback(null, true);
      // `callback(null, false)` — NOT an Error. Throwing produces a 500,
      // which is both a lie (the server is fine) and noise in whatever
      // watches the error rate. Answering WITHOUT the
      // Access-Control-Allow-Origin header is the correct refusal: the
      // browser then refuses to hand the response to the calling script,
      // and that is the entire enforcement mechanism. CORS is a rule the
      // browser applies, not a server-side gate.
      return callback(null, false);
    },
    credentials: true,
    // Browser clients send this to ask for cookie auth; without it listed,
    // the preflight fails and the header never arrives.
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Auth-Mode',
      // Sent by the web client on POST /listings/:id/view, so a view
      // can be counted once per device when nobody is signed in. A
      // custom header makes that request non-simple, so the browser
      // preflights it and drops the POST entirely unless the name is
      // listed here — which it was not, so web views were never
      // counted. The app was unaffected: a native client sends no
      // Origin, so there is no preflight.
      'X-Device-Id',
    ],
  });

  // Needed before any route can read the refresh cookie.
  app.use(cookieParser());

  // All REST routes are prefixed with /api (e.g., /api/click/prepare).
  // The Click merchant dashboard is configured with /api in the webhook URLs,
  // so this prefix must match. Swagger docs and health check are excluded.
  app.setGlobalPrefix('api', { exclude: ['docs', 'health'] });

  const config = new DocumentBuilder()
    .setTitle('Growen City API')
    .setDescription(
      [
        'Authentication, listings, media and chat endpoints.',
        '',
        '## Authentication',
        '',
        'Three ways in, all returning the same session payload. There is no password anywhere in the system.',
        '',
        '| Method | Flow |',
        '| --- | --- |',
        '| **Phone** | `POST /auth/phone/request` → SMS → `POST /auth/phone/verify` |',
        '| **Google** | Native sign-in SDK → `POST /auth/google` with the ID token |',
        '| **Telegram** | `POST /auth/telegram/start` → open `deepLink` → poll `POST /auth/telegram/poll` |',
        '',
        'The first call for an unknown phone number, Google account or Telegram account creates the account; `isNew` in the response says which happened, so the app can decide whether to show onboarding. No separate register endpoint exists.',
        '',
        'An account can hold one identity per provider. `POST /auth/link/google` and `POST /auth/link/telegram` attach another to the account you are already signed in as; `GET /auth/identities` lists them and `DELETE /auth/link/{provider}` removes one — except the last, which would lock the account.',
        '',
        'Sign-ins merge into an existing account only on a contact detail the provider itself verified: a phone number proven by the SMS code, or a Google email marked verified. Telegram vouches for neither, so it never merges.',
        '',
        '### Tokens',
        'Send the access token as `Authorization: Bearer <token>` (15 min). Refresh with `POST /auth/refresh`, which takes the refresh token **in the body** and rotates it — each one works exactly once, and replaying a spent token revokes the whole chain. `POST /auth/logout` revokes every refresh token for the account.',
        '',
        '## Chat',
        '',
        'The REST endpoints under **Chat** cover the whole feature and are enough on their own. The socket adds the live half: delivery receipts, typing indicators and presence.',
        '',
        'Sending an attachment is always two steps — `POST /media/chat/upload` first, then send a message carrying the URLs it returned.',
        '',
        '### Realtime (Socket.IO)',
        '',
        'Connect to the **`/chat`** namespace with the access token in the handshake:',
        '',
        '```js',
        "const socket = io('https://<host>/chat', { auth: { token: accessToken } });",
        '```',
        '',
        '`query.token` works too. An unauthenticated or expired token is disconnected immediately; on expiry the server first emits **`auth:expired`** — refresh the token and reconnect rather than retrying blindly. A user may hold several sockets at once (multiple devices or tabs); presence flips only when the last one drops.',
        '',
        'OpenAPI cannot describe socket events, so they are listed here. Their payload schemas are published under **Schemas** (the `Ws*` models), and the objects broadcast back reuse the same `MessageResponse` and `PresenceResponse` models as the REST endpoints.',
        '',
        '**Emit (client → server)** — every event is acknowledged; those marked ↩ resolve to a payload.',
        '',
        '| Event | Payload | Effect |',
        '| --- | --- | --- |',
        '| `message:send` | `WsSendMessageDto` | Stores the message and pushes it to both parties. ↩ `MessageResponse` — already `DELIVERED` if the recipient is connected. |',
        '| `message:read` | `WsConversationDto` | Marks the thread read; notifies the sender. |',
        '| `message:edit` | `WsEditMessageDto` | Edits your own text message (48h window). ↩ `MessageResponse` |',
        '| `message:delete` | `WsMessageIdDto` | Soft-deletes your own message. ↩ the deleted-message payload |',
        '| `typing` | `WsTypingDto` | Relays a typing indicator to the counterpart. Not persisted. |',
        '| `presence:check` | `WsPresenceCheckDto` | ↩ `PresenceResponse[]` for the given users. |',
        '',
        '**Listen (server → client)**',
        '',
        '| Event | Payload | When |',
        '| --- | --- | --- |',
        '| `message:new` | `MessageResponse` | A message was sent in one of your conversations. Echoed to the sender too, so all their devices stay in sync. |',
        '| `message:read` | `ReadReceiptResponse` | The counterpart opened the conversation. |',
        '| `message:edit` | `MessageResponse` | A message was edited. |',
        '| `message:delete` | `DeletedMessageResponse` | A message was deleted. |',
        '| `typing` | `{ conversationId, userId, isTyping, kind }` | The counterpart started or stopped composing. |',
        '| `presence` | `PresenceResponse` | Someone you have a conversation with came online or went offline. |',
        '| `auth:expired` | — | The token was rejected; a disconnect follows. |',
        '',
        'Send `clientId` (a UUID you generate) with `message:send` for optimistic UI: it is echoed back on the stored message, and a retry after a dropped connection returns the original instead of creating a duplicate.',
        '',
        '#### `/listings` — the public one',
        '',
        'A second namespace, deliberately **unauthenticated**: browsing is public and most people reading a listing are not signed in. Nothing broadcast on it is private — every number it carries is already printed on the page.',
        '',
        '```js',
        "const socket = io('https://<host>/listings');",
        "socket.emit('listing:watch', { listingId });",
        '```',
        '',
        '| Event | Direction | Payload | When |',
        '| --- | --- | --- | --- |',
        '| `listing:watch` | client → server | `{ listingId }` | Join that listing\'s room. Re-send after a reconnect — a fresh socket is in no rooms. |',
        '| `listing:unwatch` | client → server | `{ listingId }` | Leave it. |',
        '| `listing:stats` | server → client | `{ listingId, viewCount?, commentCount?, ratingAvg?, ratingCount? }` | One of the listing\'s counters moved. Only the changed fields are sent — patch what you are given and leave the rest alone. |',
      ].join('\n'),
    )
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Access token returned by login, register, or refresh.',
      },
      'access-token',
    )
    .build();

  // Socket payloads reach no controller, so nothing would pull them into the
  // spec — register them so the Realtime tables above resolve to real schemas.
  const document = SwaggerModule.createDocument(app, config, {
    extraModels: [
      WsSendMessageDto,
      WsConversationDto,
      WsMessageIdDto,
      WsEditMessageDto,
      WsTypingDto,
      WsPresenceCheckDto,
      PresenceResponse,
    ],
  });
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  // HOST=127.0.0.1 in production keeps the API reachable only through nginx;
  // unset, it listens on every interface so a phone on the LAN can reach a
  // dev machine.
  await app.listen(process.env.PORT ?? 3000, process.env.HOST || '0.0.0.0', () => {
    console.log(`Server listening on port ${process.env.PORT ?? 3000}`);
    console.log(`Docs: http://localhost:${process.env.PORT ?? 3000}/docs`);
  });
}
void bootstrap();
