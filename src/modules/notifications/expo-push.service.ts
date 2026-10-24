import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { PushToken } from './entities/push-token.entity';

/** Expo's push gateway. No key: the token itself is the credential. */
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/** Expo's own cap per request. Larger batches are rejected outright. */
const EXPO_BATCH = 100;

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

export interface PushPayload {
  title: string;
  body: string;
  /** Rides along to the app so a tap can open the right screen. */
  data?: Record<string, unknown>;
}

/**
 * Sending to devices.
 *
 * Deliberately separate from UserNotificationsService: that one owns the
 * inbox, which is the source of truth and must keep working whatever
 * happens out here. A push is a best-effort copy of a row that already
 * exists — if Expo is down, the bell still shows the notification the next
 * time the app polls.
 */
@Injectable()
export class ExpoPushService {
  private readonly logger = new Logger(ExpoPushService.name);

  constructor(
    @InjectRepository(PushToken)
    private readonly tokens: Repository<PushToken>,
  ) {}

  /**
   * Register or re-point a device.
   *
   * Upsert on the token, because the same phone signing in as a different
   * account must MOVE, not accumulate: two rows would send one person's
   * messages to another person's lock screen.
   */
  async register(
    userId: string,
    token: string,
    platform: string,
  ): Promise<void> {
    await this.tokens.upsert(
      { token, userId, platform, lastSeenAt: new Date() },
      { conflictPaths: ['token'] },
    );
  }

  /** Sign-out. Removes this device only, never the account's others. */
  async unregister(token: string): Promise<void> {
    await this.tokens.delete({ token });
  }

  /**
   * Push to everyone in `userIds`, in Expo-sized batches.
   *
   * Never throws. Every caller is a side effect of something that has
   * already committed, and a failed push must not fail a payment, a message
   * or a comment.
   */
  async sendToUsers(
    userIds: string[],
    payload: PushPayload,
  ): Promise<void> {
    try {
      const ids = [...new Set(userIds)].filter(Boolean);
      if (!ids.length) return;

      const rows = await this.tokens.find({
        where: { userId: In(ids) },
        select: { token: true },
      });
      if (!rows.length) return;

      for (let i = 0; i < rows.length; i += EXPO_BATCH) {
        const batch = rows.slice(i, i + EXPO_BATCH);
        await this.sendBatch(
          batch.map((r) => r.token),
          payload,
        );
      }
    } catch (error) {
      this.logger.warn(`Push send failed: ${(error as Error).message}`);
    }
  }

  private async sendBatch(
    tokens: string[],
    payload: PushPayload,
  ): Promise<void> {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(
        tokens.map((to) => ({
          to,
          sound: 'default',
          title: payload.title,
          body: payload.body,
          data: payload.data ?? {},
        })),
      ),
    });

    if (!res.ok) {
      this.logger.warn(`Expo push HTTP ${res.status}`);
      return;
    }

    const json = (await res.json()) as { data?: ExpoTicket[] };
    const tickets = json.data ?? [];

    // DeviceNotRegistered is the ONLY reliable signal that a token is dead —
    // the app was deleted, or push was turned off at the OS. Expo asks that
    // these be dropped promptly; keeping them means every later send pays
    // for a device that will never answer.
    const dead = tickets
      .map((ticket, i) =>
        ticket.status === 'error' &&
        ticket.details?.error === 'DeviceNotRegistered'
          ? tokens[i]
          : null,
      )
      .filter((t): t is string => !!t);

    if (dead.length) {
      await this.tokens.delete({ token: In(dead) });
      this.logger.log(`Pruned ${dead.length} dead push token(s)`);
    }
  }
}
