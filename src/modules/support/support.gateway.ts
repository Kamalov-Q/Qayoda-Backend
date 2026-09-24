import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { DataSource } from 'typeorm';
import { UserRole } from '../../shared/enums';

/** Every admin on duty sits in one room; each user sits in their own. */
const ADMIN_ROOM = 'support:admins';
const userRoom = (userId: string) => `support:user:${userId}`;

/**
 * Live support threads.
 *
 * Its own namespace rather than more events on `/chat`: support messages are
 * not between two named people, they are between one person and whoever is on
 * duty, and "every admin" is a room that has no meaning in the chat gateway.
 *
 * Authenticated — unlike `/listings`, nothing here is public.
 */
@WebSocketGateway({
  namespace: '/support',
  cors: { origin: true, credentials: true },
})
export class SupportGateway implements OnGatewayConnection {
  private readonly logger = new Logger(SupportGateway.name);

  @WebSocketServer() server: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly ds: DataSource,
  ) {}

  async handleConnection(client: Socket) {
    const token =
      (client.handshake.auth?.token as string | undefined) ??
      (client.handshake.query?.token as string | undefined);

    if (!token) return client.disconnect();

    let userId: string;
    try {
      const payload = this.jwt.verify<{ sub: string }>(token, {
        secret: this.config.get<string>('JWT_ACCESS_SECRET'),
      });
      userId = payload.sub;
    } catch {
      // Same contract as the chat socket: say so, and let the client refresh.
      client.emit('auth:expired');
      return client.disconnect();
    }

    // The role comes from the database, not the token: a demoted admin must
    // not keep receiving the support queue until their token expires.
    const rows = await this.ds.query<{ role: UserRole }[]>(
      `SELECT role FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [userId],
    );
    if (!rows.length) return client.disconnect();

    (client.data as { userId?: string }).userId = userId;
    await client.join(userRoom(userId));
    if (rows[0].role === UserRole.ADMIN) await client.join(ADMIN_ROOM);
  }

  /** A new message, to the person it concerns and to the whole duty room. */
  emitMessage(userId: string, payload: unknown) {
    this.emit(userRoom(userId), 'support:message', payload);
    this.emit(ADMIN_ROOM, 'support:message', payload);
  }

  /** A thread opened, closed, or read — the queue reorders on it. */
  emitThread(userId: string, payload: unknown) {
    this.emit(userRoom(userId), 'support:thread', payload);
    this.emit(ADMIN_ROOM, 'support:thread', payload);
  }

  private emit(room: string, event: string, payload: unknown) {
    try {
      this.server?.to(room).emit(event, payload);
    } catch (e) {
      // A message must not fail to save because a socket could not be told.
      this.logger.warn(`Support broadcast failed: ${(e as Error).message}`);
    }
  }
}
