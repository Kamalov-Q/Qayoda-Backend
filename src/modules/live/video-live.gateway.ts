import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';

/** `video:<uuid>` — one room per reel being watched. */
const roomFor = (videoId: string) => `video:${videoId}`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The `video:stats` payload. Every counter is optional — a broadcast says
 * only what moved, and a client that receives `{ likeCount }` must leave the
 * rest of what it is showing alone.
 */
export interface VideoStats {
  videoId: string;
  likeCount?: number;
  commentCount?: number;
  /** Distinct viewers. */
  viewCount?: number;
}

/**
 * A reel's numbers, kept live while people are looking at it.
 *
 * Unauthenticated, like the listings namespace and for the same reason:
 * everything broadcast here is already printed on the screen that receives
 * it, and most of the people watching a reel are not signed in.
 *
 * Why it is worth having at all, when the feed already refetches: a reel is
 * the one screen in this app where several people are reliably looking at
 * the same thing at the same time. A like landing on a number you are
 * staring at is the whole difference between a feed and a broadcast.
 *
 * The room is joined for the ACTIVE page only — not for every page the pager
 * has mounted — so a phone holds one room, not three.
 */
@WebSocketGateway({
  namespace: '/videos',
  cors: { origin: true, credentials: true },
})
export class VideoLiveGateway {
  private readonly logger = new Logger(VideoLiveGateway.name);

  @WebSocketServer() server: Server;

  @SubscribeMessage('video:watch')
  watch(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { videoId?: string },
  ) {
    const videoId = body?.videoId;
    if (!videoId || !UUID.test(videoId)) return { ok: false };

    // One reel at a time per socket: swiping to the next should stop the
    // previous one's traffic without the client having to remember to say so.
    for (const room of client.rooms) {
      if (room.startsWith('video:')) void client.leave(room);
    }
    void client.join(roomFor(videoId));
    return { ok: true };
  }

  @SubscribeMessage('video:unwatch')
  unwatch(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { videoId?: string },
  ) {
    const videoId = body?.videoId;
    if (videoId && UUID.test(videoId)) void client.leave(roomFor(videoId));
    return { ok: true };
  }

  /**
   * Push whatever moved. Called from the services that own the counters, and
   * deliberately tolerant: the gateway may have no server attached yet during
   * boot, and a missed broadcast is a number that updates on the next read.
   */
  broadcast(videoId: string, stats: Omit<VideoStats, 'videoId'>): void {
    try {
      this.server?.to(roomFor(videoId)).emit('video:stats', {
        videoId,
        ...stats,
      } satisfies VideoStats);
    } catch (error) {
      this.logger.warn(
        `video:stats for ${videoId} not sent: ${(error as Error).message}`,
      );
    }
  }
}
