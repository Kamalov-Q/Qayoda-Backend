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

/** One person, one message. The unit sendEach works in. */
export interface PushTo {
  userId: string;
  payload: PushPayload;
}

/** One device, one message. The unit Expo's API works in. */
interface PushMessage {
  token: string;
  payload: PushPayload;
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

      await this.dispatch(rows.map((r) => ({ token: r.token, payload })));
    } catch (error) {
      this.logger.warn(`Push send failed: ${(error as Error).message}`);
    }
  }

  /**
   * Push a DIFFERENT message to each of many people, in one pass.
   *
   * sendToUsers is a fan-out: one event, one payload, many recipients. This
   * is the other shape — a sweep that settles a page of rows and owes each
   * of them a push about its own listing and thread. Doing that by calling
   * sendToUsers per row cost a token query AND an HTTP round trip EACH, five
   * hundred of both when the bid-expiry cron ran, all fired at once because
   * the calls were not awaited.
   *
   * Expo's endpoint takes an array of messages, each with its own `to` and
   * `data`, so the whole sweep is one token query and a request per hundred
   * devices — with every deep link still pointing at its own listing, which
   * is what batching by kind would have thrown away.
   *
   * Never throws, for the reason sendToUsers gives.
   */
  async sendEach(items: PushTo[]): Promise<void> {
    try {
      const userIds = [...new Set(items.map((i) => i.userId).filter(Boolean))];
      if (!userIds.length) return;

      const rows = await this.tokens.find({
        where: { userId: In(userIds) },
        select: { userId: true, token: true },
      });
      if (!rows.length) return;

      const tokensOf = new Map<string, string[]>();
      for (const row of rows) {
        const list = tokensOf.get(row.userId);
        if (list) list.push(row.token);
        else tokensOf.set(row.userId, [row.token]);
      }

      // Per recipient rather than per item, because one person can be owed
      // two of these at once — two of their bids lapsing in the same sweep —
      // and both are real messages, not a duplicate to collapse.
      const messages: PushMessage[] = [];
      for (const item of items) {
        for (const token of tokensOf.get(item.userId) ?? []) {
          messages.push({ token, payload: item.payload });
        }
      }

      await this.dispatch(messages);
    } catch (error) {
      this.logger.warn(`Varied push send failed: ${(error as Error).message}`);
    }
  }

  /** Expo-sized chunks. Larger requests are rejected outright. */
  private async dispatch(messages: PushMessage[]): Promise<void> {
    for (let i = 0; i < messages.length; i += EXPO_BATCH) {
      await this.sendBatch(messages.slice(i, i + EXPO_BATCH));
    }
  }

  private async sendBatch(messages: PushMessage[]): Promise<void> {
    if (!messages.length) return;

    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(
        messages.map(({ token, payload }) => ({
          to: token,
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
    // Expo answers positionally, so ticket i belongs to messages[i].
    const dead = tickets
      .map((ticket, i) =>
        ticket.status === 'error' &&
        ticket.details?.error === 'DeviceNotRegistered'
          ? messages[i]?.token
          : null,
      )
      .filter((t): t is string => !!t);

    if (dead.length) {
      await this.tokens.delete({ token: In(dead) });
      this.logger.log(`Pruned ${dead.length} dead push token(s)`);
    }
  }
}
