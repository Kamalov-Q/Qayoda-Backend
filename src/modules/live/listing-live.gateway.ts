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
 * The `listing:stats` payload. Every counter is optional — a broadcast says
 * only what moved, and a client that receives `{ commentCount }` must leave
 * the rest of what it is showing alone.
 */
export interface ListingStats {
  listingId: string;
  /** Distinct viewers. */
  viewCount?: number;
  /** Top-level comments; replies are not counted. */
  commentCount?: number;
  /** The listing's stars, as RatingService last decided them. */
  ratingAvg?: number;
  /** How many people reviewed it. */
  ratingCount?: number;
}

/**
 * Whatever a listing's page shows about itself, kept live.
 *
 * Its own namespace rather than a few more events on `/chat`, because this
 * one is deliberately **unauthenticated**: browsing is public, most of the
 * people looking at a listing are not signed in, and `/chat` disconnects
 * anyone without a token. Nothing broadcast here is private — every number is
 * already printed on the page.
 *
 * Clients say which listing they are looking at; whoever changes one of its
 * counts pushes the new value to that room. One event with optional fields,
 * not one event per counter: the client patches what it is given, so adding a
 * number later costs nothing on either side.
 */
@WebSocketGateway({
  namespace: '/listings',
  cors: { origin: true, credentials: true },
})
export class ListingLiveGateway {
  private readonly logger = new Logger(ListingLiveGateway.name);

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
   * Push what changed to everyone on that listing's page.
   *
   * Swallows its own failures: recording a view, writing a comment or
   * upholding a report must not fail because a socket server is having a bad
   * day, and every number here is re-read on the next load anyway.
   */
  broadcast(listingId: string, patch: Omit<ListingStats, 'listingId'>) {
    try {
      this.server
        ?.to(roomFor(listingId))
        .emit('listing:stats', { listingId, ...patch });
    } catch (e) {
      this.logger.warn(`Stats broadcast failed: ${(e as Error).message}`);
    }
  }
}
