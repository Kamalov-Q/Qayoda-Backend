import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, LessThan, MoreThan, Repository } from 'typeorm';
import { ListingsFacade } from '../listings/listings.facade';
import { ListingOffer } from '../listings/entities/listing-offer.entity';
import { ListingStatus } from '../listings/enums/listing-status.enum';
import { OfferPurpose } from '../listings/enums/offer-purpose.enum';
import { MessageType } from '../chat/enums/message-type.enum';
import { ChatService } from '../chat/chat.service';
import { BlocksService } from '../blocks/blocks.service';
import { RatesService } from '../../shared/rates/rates.service';
import { UserNotificationsService } from '../notifications/user-notifications.service';
import { NotificationKind } from '../notifications/notifications.constants';
import { PriceBid } from './entities/price-bid.entity';
import { PriceBidDirection } from './enums/price-bid-direction.enum';
import {
  PriceBidStatus,
  SETTLED_BID_STATUSES,
} from './enums/price-bid-status.enum';
import { CreatePriceBidDto } from './dto/create-price-bid.dto';
import { ListPriceBidsDto } from './dto/list-price-bids.dto';
import {
  BID_TTL_DAYS,
  BIDS_PAGE,
  MAX_BID_MULTIPLE,
  MAX_BIDS_PER_LISTING_PER_DAY,
} from './price-bids.constants';

/** Postgres numerics come back as strings. Everything here is explicit. */
const num = (v: string | number | null): number => Number(v ?? 0);

const money = (amount: string | number, currency: string): string =>
  `${new Intl.NumberFormat('ru-RU').format(Math.round(num(amount)))} ${
    currency === 'UZS' ? "so'm" : '$'
  }`;

/**
 * Negotiating a price.
 *
 * The rule the whole module is built around: accepting a bid agrees a NUMBER
 * and nothing else. No money moves, no listing changes hands, nothing is
 * reserved. The moment this service starts settling transactions it needs an
 * escrow, a dispute process and a licence, none of which this product has.
 *
 * Every write that reaches a human goes through the chat thread the two of
 * them already share, so there is one place a negotiation lives and one set
 * of sockets, read receipts and blocks governing it.
 */
@Injectable()
export class PriceBidsService {
  private readonly logger = new Logger(PriceBidsService.name);

  constructor(
    @InjectRepository(PriceBid)
    private readonly bids: Repository<PriceBid>,
    @InjectRepository(ListingOffer)
    private readonly offers: Repository<ListingOffer>,
    private readonly listings: ListingsFacade,
    private readonly chat: ChatService,
    private readonly blocks: BlocksService,
    private readonly rates: RatesService,
    private readonly notifications: UserNotificationsService,
    private readonly dataSource: DataSource,
  ) {}

  // ─────────────────────────────── placing ────────────────────────────────

  /**
   * A buyer puts a number on an advert.
   *
   * Supersedes their own open bid rather than adding to it: two live numbers
   * from one person is a question with two answers, and "accept" would have
   * to ask which.
   */
  async create(listingId: string, bidderId: string, dto: CreatePriceBidDto) {
    const listing = await this.listings.getSummary(listingId);

    if (listing.status !== ListingStatus.ACTIVE) {
      throw new BadRequestException('Listing is not open to offers');
    }
    if (listing.ownerId === bidderId) {
      throw new BadRequestException('You cannot bid on your own listing');
    }
    // Either direction, same as opening a thread: a block is supposed to end
    // the contact, and a bid is contact with a number attached.
    await this.blocks.assertNotBlocked(bidderId, listing.ownerId);

    const asking = await this.resolveAsking(listingId, dto.purpose);
    const currency = dto.currency ?? asking.currency;
    this.assertSaneAmount(dto.amount, asking, currency);
    await this.assertUnderDailyLimit(listingId, bidderId);

    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + BID_TTL_DAYS * 24 * 3600 * 1000,
    );

    const bid = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(PriceBid);

      // Their previous open bid steps aside. Withdrawn, not countered — a
      // counter is something the OTHER side does.
      await repo.update(
        {
          listingId,
          bidderId,
          status: PriceBidStatus.PENDING,
        },
        { status: PriceBidStatus.WITHDRAWN, respondedAt: now },
      );

      return repo.save(
        repo.create({
          listingId,
          bidderId,
          ownerId: listing.ownerId,
          direction: PriceBidDirection.BUYER,
          status: PriceBidStatus.PENDING,
          purpose: asking.purpose,
          amount: dto.amount.toFixed(2),
          currency,
          amountUsd: this.toUsd(dto.amount, currency),
          askingAmount: num(asking.price).toFixed(2),
          askingCurrency: asking.currency,
          expiresAt,
        }),
      );
    });

    await this.announce(bid, bidderId, listing.ownerId, {
      listingId,
      attach: true,
      body: this.bidSentence(bid, dto.note),
    });

    await this.notifications.notify({
      userId: listing.ownerId,
      actorId: bidderId,
      kind: NotificationKind.PRICE_BID_RECEIVED,
      listingId,
      conversationId: bid.conversationId,
      meta: this.metaFor(bid),
    });

    return this.toDto(await this.reload(bid.id));
  }

  // ────────────────────────────── responding ──────────────────────────────

  /** Yes. Both sides may accept — whoever did not make the bid. */
  async accept(bidId: string, userId: string, note?: string) {
    const bid = await this.loadRespondable(bidId, userId);

    await this.bids.update(bid.id, {
      status: PriceBidStatus.ACCEPTED,
      respondedAt: new Date(),
    });
    const settled = await this.reload(bid.id);

    await this.announce(settled, userId, this.counterpartyOf(settled, userId), {
      listingId: settled.listingId,
      attach: false,
      body: [
        `✅ Narx kelishildi: ${money(settled.amount, settled.currency)}.`,
        'Bu shartnoma emas — qolgani sizning kelishuvingiz.',
        note,
      ]
        .filter(Boolean)
        .join('\n'),
    });

    await this.notifications.notify({
      userId: this.counterpartyOf(settled, userId),
      actorId: userId,
      kind: NotificationKind.PRICE_BID_ACCEPTED,
      listingId: settled.listingId,
      conversationId: settled.conversationId,
      meta: this.metaFor(settled),
    });

    return this.toDto(settled);
  }

  /** No, with nothing offered in its place. */
  async decline(bidId: string, userId: string, note?: string) {
    const bid = await this.loadRespondable(bidId, userId);

    await this.bids.update(bid.id, {
      status: PriceBidStatus.DECLINED,
      respondedAt: new Date(),
    });
    const settled = await this.reload(bid.id);

    await this.announce(settled, userId, this.counterpartyOf(settled, userId), {
      listingId: settled.listingId,
      attach: false,
      body: [
        `Taklif rad etildi: ${money(settled.amount, settled.currency)}.`,
        note,
      ]
        .filter(Boolean)
        .join('\n'),
    });

    await this.notifications.notify({
      userId: this.counterpartyOf(settled, userId),
      actorId: userId,
      kind: NotificationKind.PRICE_BID_DECLINED,
      listingId: settled.listingId,
      conversationId: settled.conversationId,
      meta: this.metaFor(settled),
    });

    return this.toDto(settled);
  }

  /**
   * No, but — a number of my own.
   *
   * The old bid becomes COUNTERED and points at the new one, so the thread
   * reads as a sequence rather than a pile.
   */
  async counter(bidId: string, userId: string, dto: CreatePriceBidDto) {
    const previous = await this.loadRespondable(bidId, userId);
    const asking = await this.resolveAsking(
      previous.listingId,
      previous.purpose,
    );
    const currency = dto.currency ?? previous.currency;
    this.assertSaneAmount(dto.amount, asking, currency);

    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + BID_TTL_DAYS * 24 * 3600 * 1000,
    );
    // Whoever is answering is now the one making an offer; the bidder column
    // stays on the buyer either way, because the pair is what identifies the
    // negotiation.
    const direction =
      userId === previous.ownerId
        ? PriceBidDirection.SELLER
        : PriceBidDirection.BUYER;

    const created = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(PriceBid);

      const next = await repo.save(
        repo.create({
          listingId: previous.listingId,
          bidderId: previous.bidderId,
          ownerId: previous.ownerId,
          conversationId: previous.conversationId,
          direction,
          status: PriceBidStatus.PENDING,
          purpose: previous.purpose,
          amount: dto.amount.toFixed(2),
          currency,
          amountUsd: this.toUsd(dto.amount, currency),
          askingAmount: num(asking.price).toFixed(2),
          askingCurrency: asking.currency,
          expiresAt,
        }),
      );

      await repo.update(previous.id, {
        status: PriceBidStatus.COUNTERED,
        respondedAt: now,
        supersededById: next.id,
      });

      return next;
    });

    const recipient = this.counterpartyOf(created, userId);

    await this.announce(created, userId, recipient, {
      listingId: created.listingId,
      attach: true,
      body: this.counterSentence(created, previous, dto.note),
    });

    await this.notifications.notify({
      userId: recipient,
      actorId: userId,
      kind: NotificationKind.PRICE_BID_COUNTERED,
      listingId: created.listingId,
      conversationId: created.conversationId,
      meta: this.metaFor(created),
    });

    return this.toDto(await this.reload(created.id));
  }

  /** Taking your own number back. Silent — nobody needs telling. */
  async withdraw(bidId: string, userId: string) {
    const bid = await this.bids.findOne({ where: { id: bidId } });
    if (!bid) throw new NotFoundException('Bid not found');
    if (this.authorOf(bid) !== userId) {
      throw new ForbiddenException('Only the author may withdraw a bid');
    }
    this.assertOpen(bid);

    await this.bids.update(bid.id, {
      status: PriceBidStatus.WITHDRAWN,
      respondedAt: new Date(),
    });

    return this.toDto(await this.reload(bid.id));
  }

  // ─────────────────────────────── reading ────────────────────────────────

  /**
   * The bids on one advert.
   *
   * The owner sees every bid. Anybody else sees only their own — a public
   * bid count tells the next buyer what to beat, and suppresses the bid they
   * would otherwise have made.
   */
  async listForListing(listingId: string, userId: string, q: ListPriceBidsDto) {
    const listing = await this.listings.getSummary(listingId);
    const isOwner = listing.ownerId === userId;

    const [items, total] = await this.bids.findAndCount({
      where: {
        listingId,
        ...(isOwner ? {} : { bidderId: userId }),
        ...(q.status ? { status: q.status } : {}),
      },
      order: { createdAt: 'DESC' },
      take: q.limit ?? BIDS_PAGE,
      skip: q.offset ?? 0,
    });

    return { total, items: items.map((b) => this.toDto(b)) };
  }

  /** Everything this person has offered, anywhere. */
  async listMine(userId: string, q: ListPriceBidsDto) {
    const status = q.status ? { status: q.status } : {};
    const [items, total] = await this.bids.findAndCount({
      // BOTH sides of every negotiation this person is in: what they have
      // offered on other people's adverts, and what has been offered on
      // theirs. One screen, because a negotiation holds the same two rows
      // whichever end you have hold of, and `direction`/`authorId` already
      // say who put the current number up.
      where: [
        { ...status, bidderId: userId },
        { ...status, ownerId: userId },
      ],
      order: { createdAt: 'DESC' },
      take: q.limit ?? BIDS_PAGE,
      skip: q.offset ?? 0,
    });

    /**
     * The advert each offer is against, resolved in one query.
     *
     * Unlike the chat's by-id endpoint, this list has no surrounding
     * context: a column of bare amounts says nothing about what any of them
     * is an offer FOR. The title has to come with the row, and fetching it
     * per row would be a page of round trips.
     */
    const listings = await this.listings.getSummaries([
      ...new Set(items.map((b) => b.listingId)),
    ]);
    const byId = new Map(listings.map((l) => [l.id, l]));

    return {
      total,
      items: items.map((bid) => {
        const listing = byId.get(bid.listingId);
        return {
          ...this.toDto(bid),
          listing: listing
            ? {
                id: listing.id,
                title: listing.title,
                // So a row against a sold or withdrawn advert can say so
                // rather than leading somewhere that no longer exists.
                status: listing.status,
              }
            : null,
        };
      }),
    };
  }

  /** One bid, for the card in the chat thread. Participants only. */
  async getOne(bidId: string, userId: string) {
    const bid = await this.reload(bidId);
    if (bid.bidderId !== userId && bid.ownerId !== userId) {
      throw new ForbiddenException('Not your bid');
    }
    return this.toDto(bid);
  }

  /**
   * The bids behind a set of chat messages.
   *
   * One request for a page of a thread rather than one per card: a
   * conversation with twenty bids in it is still one round trip.
   */
  async getManyForUser(ids: string[], userId: string) {
    if (ids.length === 0) return [];
    const rows = await this.bids.find({ where: { id: In(ids.slice(0, 100)) } });
    return rows
      .filter((b) => b.bidderId === userId || b.ownerId === userId)
      .map((b) => this.toDto(b));
  }

  // ─────────────────────────────── expiry ─────────────────────────────────

  /**
   * Lapse the bids nobody answered.
   *
   * Hourly and small: the index is partial on (status, expires_at), so this
   * reads the handful that are actually due rather than the table. Expiry is
   * ALSO applied on read — `toDto` reports a past-due PENDING row as EXPIRED
   * — so a sweep that is late or skipped never shows a stale "awaiting
   * answer" card to anybody.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async expireDueBids(): Promise<void> {
    try {
      const due = await this.bids.find({
        where: { status: PriceBidStatus.PENDING, expiresAt: LessThan(new Date()) },
        take: 500,
      });
      if (due.length === 0) return;

      await this.bids.update(
        { id: In(due.map((b) => b.id)) },
        { status: PriceBidStatus.EXPIRED, respondedAt: new Date() },
      );

      // One insert and one batched push for the whole sweep. This was a
      // loop of awaited notify() calls, so a sweep that found its full page
      // of five hundred held the scheduler for five hundred round trips.
      await this.notifications.notifyEach(
        due.map((bid) => ({
          userId: this.authorOf(bid),
          kind: NotificationKind.PRICE_BID_EXPIRED,
          listingId: bid.listingId,
          conversationId: bid.conversationId,
          meta: this.metaFor(bid),
        })),
      );

      this.logger.log(`Expired ${due.length} price bid(s)`);
    } catch (e) {
      // A sweep that throws must not take the scheduler down with it; the
      // read-time fallback means nothing is shown wrongly in the meantime.
      this.logger.warn(`Bid expiry sweep failed: ${(e as Error).message}`);
    }
  }

  /**
   * Close everything open on an advert that stopped being open.
   *
   * Called when a listing is archived (and, when that status exists, sold).
   * A bid outliving the thing it was for is the one state that makes the
   * feature look broken from both sides at once.
   */
  async closeOpenBidsFor(
    listingId: string,
    reason: 'ARCHIVED' | 'SOLD',
  ): Promise<void> {
    try {
      const open = await this.bids.find({
        where: { listingId, status: PriceBidStatus.PENDING },
      });
      if (open.length === 0) return;

      await this.bids.update(
        { id: In(open.map((b) => b.id)) },
        { status: PriceBidStatus.DECLINED, respondedAt: new Date() },
      );

      // Same reasoning as the expiry sweep: a popular advert being archived
      // owes a notification to every bidder on it, and that is one write.
      await this.notifications.notifyEach(
        open.map((bid) => ({
          userId: bid.bidderId,
          kind: NotificationKind.PRICE_BID_DECLINED,
          listingId,
          conversationId: bid.conversationId,
          meta: { ...this.metaFor(bid), reason },
        })),
      );
    } catch (e) {
      this.logger.warn(`Closing bids for ${listingId} failed: ${(e as Error).message}`);
    }
  }

  // ─────────────────────────────── internals ──────────────────────────────

  /** The asking price a bid is measured against. */
  private async resolveAsking(listingId: string, purpose?: OfferPurpose) {
    const active = await this.offers.find({
      where: { listingId, isActive: true },
    });
    if (active.length === 0) {
      throw new BadRequestException('This listing has no price to bid on');
    }

    if (purpose) {
      const match = active.find((o) => o.purpose === purpose);
      if (!match) throw new BadRequestException('No such price on this listing');
      return match;
    }
    // One price, no ambiguity. More than one (for sale AND to rent) and the
    // client has to say which, or an accepted bid means two different things.
    if (active.length > 1) {
      throw new BadRequestException(
        'This listing has several prices — specify which one you are bidding on',
      );
    }
    return active[0];
  }

  private assertSaneAmount(
    amount: number,
    asking: ListingOffer,
    currency: string,
  ): void {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Amount must be positive');
    }
    // Compared in one scale, or a so'm bid looks a million times too big.
    const bidUsd = Number(this.toUsd(amount, currency) ?? 0);
    const askUsd = Number(
      this.toUsd(num(asking.price), asking.currency) ?? 0,
    );
    if (askUsd > 0 && bidUsd > askUsd * MAX_BID_MULTIPLE) {
      throw new BadRequestException('Amount looks like a mistake');
    }
  }

  private async assertUnderDailyLimit(
    listingId: string,
    bidderId: string,
  ): Promise<void> {
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const recent = await this.bids.count({
      where: { listingId, bidderId, createdAt: MoreThan(since) },
    });
    if (recent >= MAX_BIDS_PER_LISTING_PER_DAY) {
      throw new BadRequestException(
        'Too many offers on this listing today — try again tomorrow',
      );
    }
  }

  /**
   * Put the bid in front of the other person, in the thread they share.
   *
   * Best-effort on purpose: the bid is already saved and binding on nobody,
   * so a chat write that fails must not undo it. The card still renders from
   * the bid itself; what is lost is the line in the conversation.
   */
  private async announce(
    bid: PriceBid,
    senderId: string,
    recipientId: string,
    opts: {
      listingId: string;
      body: string;
      /**
       * Whether this message IS the bid, or merely talks about it.
       *
       * The card in the thread is drawn from any message carrying a bid id,
       * so attaching one to an acceptance would draw the SAME bid twice —
       * once where it was offered and again where it was answered. A new
       * number attaches (it is a new card); an answer to one does not, and
       * lands as the line of conversation it is.
       */
      attach: boolean;
    },
  ): Promise<void> {
    try {
      const dto = { type: MessageType.TEXT, body: opts.body } as never;
      const attachment = opts.attach ? bid.id : null;

      if (bid.conversationId) {
        const message = await this.chat.sendMessage(
          bid.conversationId,
          senderId,
          dto,
          undefined,
          attachment,
        );
        if (opts.attach) {
          await this.bids.update(bid.id, {
            messageId: (message as { id: string }).id,
          });
        }
        return;
      }

      // No thread yet. Only the buyer can open one — startConversation takes
      // the guest's id, and the seller is the host.
      if (senderId !== bid.bidderId) return;

      const started = await this.chat.startConversation(
        bid.bidderId,
        opts.listingId,
        dto,
        attachment,
      );
      await this.bids.update(bid.id, {
        conversationId: started.conversation.id,
        ...(opts.attach ? { messageId: started.message.id } : {}),
      });
      bid.conversationId = started.conversation.id;
    } catch (e) {
      this.logger.warn(
        `Bid ${bid.id} saved but not announced to ${recipientId}: ${(e as Error).message}`,
      );
    }
  }

  /** Who may answer this bid: whoever did not make it. */
  private counterpartyOf(bid: PriceBid, userId: string): string {
    return userId === bid.bidderId ? bid.ownerId : bid.bidderId;
  }

  /** Who made it, which the direction decides rather than the bidder column. */
  private authorOf(bid: PriceBid): string {
    return bid.direction === PriceBidDirection.BUYER
      ? bid.bidderId
      : bid.ownerId;
  }

  private async loadRespondable(bidId: string, userId: string) {
    const bid = await this.bids.findOne({ where: { id: bidId } });
    if (!bid) throw new NotFoundException('Bid not found');
    if (bid.bidderId !== userId && bid.ownerId !== userId) {
      throw new ForbiddenException('Not your bid');
    }
    if (this.authorOf(bid) === userId) {
      throw new BadRequestException('You cannot answer your own offer');
    }
    this.assertOpen(bid);

    /**
     * The advert still has to be live.
     *
     * create() checks this; accepting, declining and countering did not — so
     * a bid that outlived its listing could still be agreed to, for something
     * that had dropped off the map. The listener on `listing.archived` closes
     * open bids, but a listener is a race and an idempotency key away from
     * not having run yet, and this is the check that does not depend on it.
     */
    const listing = await this.listings.getSummary(bid.listingId);
    if (listing.status !== ListingStatus.ACTIVE) {
      throw new BadRequestException('This listing is no longer open to offers');
    }

    return bid;
  }

  private assertOpen(bid: PriceBid): void {
    if (SETTLED_BID_STATUSES.includes(bid.status)) {
      throw new BadRequestException(`This offer is already ${bid.status.toLowerCase()}`);
    }
    if (bid.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('This offer has expired');
    }
  }

  private async reload(id: string): Promise<PriceBid> {
    const bid = await this.bids.findOne({ where: { id } });
    if (!bid) throw new NotFoundException('Bid not found');
    return bid;
  }

  private toUsd(amount: number, currency: string): string | null {
    try {
      const usd = this.rates.toUsd(amount, currency);
      return usd == null ? null : Number(usd).toFixed(2);
    } catch {
      // A missing rate must not stop a bid; the column is nullable for
      // exactly this, and the number the user typed is untouched.
      return null;
    }
  }

  private metaFor(bid: PriceBid): Record<string, unknown> {
    return {
      bidId: bid.id,
      amount: num(bid.amount),
      currency: bid.currency,
      direction: bid.direction,
    };
  }

  /** What the thread says when a bid lands, for clients that cannot draw it. */
  private bidSentence(bid: PriceBid, note?: string): string {
    const head = `💬 Narx taklifi: ${money(bid.amount, bid.currency)}`;
    const delta = this.deltaSentence(bid);
    return [delta ? `${head} (${delta})` : head, note].filter(Boolean).join('\n');
  }

  private counterSentence(
    next: PriceBid,
    previous: PriceBid,
    note?: string,
  ): string {
    const head =
      `💬 Qarshi taklif: ${money(next.amount, next.currency)} ` +
      `(${money(previous.amount, previous.currency)} o'rniga)`;
    return [head, note].filter(Boolean).join('\n');
  }

  private deltaSentence(bid: PriceBid): string | null {
    const asking = num(bid.askingAmount);
    if (!asking || bid.askingCurrency !== bid.currency) return null;
    const pct = Math.round((1 - num(bid.amount) / asking) * 100);
    if (pct === 0) return null;
    return pct > 0 ? `so'ralgan narxdan −${pct}%` : `so'ralgan narxdan +${-pct}%`;
  }

  /**
   * The wire shape.
   *
   * Reports a past-due PENDING row as EXPIRED without writing: the hourly
   * sweep is what makes it true in the table, and this is what stops a late
   * sweep showing anybody a card with live buttons on a dead offer.
   */
  private toDto(bid: PriceBid) {
    const expired =
      bid.status === PriceBidStatus.PENDING &&
      bid.expiresAt.getTime() <= Date.now();

    return {
      id: bid.id,
      listingId: bid.listingId,
      conversationId: bid.conversationId,
      messageId: bid.messageId,
      bidderId: bid.bidderId,
      ownerId: bid.ownerId,
      authorId: this.authorOf(bid),
      direction: bid.direction,
      status: expired ? PriceBidStatus.EXPIRED : bid.status,
      purpose: bid.purpose,
      amount: num(bid.amount),
      currency: bid.currency,
      askingAmount: bid.askingAmount == null ? null : num(bid.askingAmount),
      askingCurrency: bid.askingCurrency,
      expiresAt: bid.expiresAt,
      respondedAt: bid.respondedAt,
      supersededById: bid.supersededById,
      createdAt: bid.createdAt,
    };
  }
}
