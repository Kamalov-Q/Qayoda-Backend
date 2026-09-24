import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';

/** `listing:<uuid>` — one room per listing being watched. */
const roomFor = (listingId: string) => `listing:${listingId}`;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Live view counts.
 *
 * Its own namespace rather than a few more events on `/chat`, because this one
 * is deliberately **unauthenticated**: browsing is public, most of the people
 * looking at a listing are not signed in, and `/chat` disconnects anyone
 * without a token. Nothing here is private — a view count is already printed
 * on the page.
 *
 * Clients say which listing they are looking at; the server pushes the new
 * number to everyone in that room whenever it moves.
 */
@WebSocketGateway({
  namespace: '/listings',
  cors: { origin: true, credentials: true },
})
export class ViewsGateway {
  private readonly logger = new Logger(ViewsGateway.name);

  @WebSocketServer() server: Server;

  @SubscribeMessage('listing:watch')
  async watch(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { listingId?: string },
  ) {
    const id = body?.listingId;
    // Validated here rather than with a DTO pipe: an unauthenticated socket
    // is the one place where a junk payload costs nothing to ignore, and a
    // thrown exception would just noise up the logs.
    if (!id || !UUID.test(id)) return;

    await client.join(roomFor(id));
  }

  @SubscribeMessage('listing:unwatch')
  async unwatch(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { listingId?: string },
  ) {
    const id = body?.listingId;
    if (!id || !UUID.test(id)) return;

    await client.leave(roomFor(id));
  }

  /**
   * Push a new count to everyone on that listing's page.
   *
   * Swallows its own failures: a listing view must not fail because a socket
   * server is having a bad day, and the count is re-read on the next load.
   */
  broadcast(listingId: string, viewCount: number) {
    try {
      this.server?.to(roomFor(listingId)).emit('listing:views', {
        listingId,
        viewCount,
      });
    } catch (e) {
      this.logger.warn(`View broadcast failed: ${(e as Error).message}`);
    }
  }
}
