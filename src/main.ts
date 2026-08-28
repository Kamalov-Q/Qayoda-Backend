import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
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
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableCors({ origin: true, credentials: true });

  const config = new DocumentBuilder()
    .setTitle('uyNest API')
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

  await app.listen(process.env.PORT ?? 3000, '0.0.0.0', () => {
    console.log(`Server listening on port ${process.env.PORT ?? 3000}`);
    console.log(`Docs: http://localhost:${process.env.PORT ?? 3000}/docs`);
  });
}
void bootstrap();
