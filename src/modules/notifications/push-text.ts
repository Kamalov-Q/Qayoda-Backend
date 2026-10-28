import { NotificationKind } from './notifications.constants';

/**
 * What a push says on the lock screen.
 *
 * Separate from the app's own strings, and in one language, because of
 * where it is written: the server knows which KIND happened but not which
 * language the recipient's phone is set to — that preference lives on the
 * client, which is the one place that cannot format this message.
 *
 * Uzbek, as the default the app ships in. Localising properly means storing
 * each user's language and keying this by it; worth doing, and a bigger
 * change than turning push on.
 *
 * A kind missing from here sends no push. That is the intended way to keep
 * something inbox-only — there is no separate flag to forget to set.
 */
export const PUSH_TEXT: Partial<
  Record<NotificationKind, { title: string; body: string }>
> = {
  [NotificationKind.CHAT_MESSAGE]: {
    title: 'Yangi xabar',
    body: 'Sizga xabar yuborildi',
  },
  [NotificationKind.LISTING_COMMENT]: {
    title: 'Yangi izoh',
    body: "E'loningizga izoh qoldirildi",
  },
  [NotificationKind.LISTING_COMMENT_REPLY]: {
    title: 'Izohingizga javob',
    body: 'Izohingizga javob berildi',
  },
  [NotificationKind.LISTING_REVIEW]: {
    title: 'Yangi baho',
    body: "E'loningiz baholandi",
  },
  [NotificationKind.NEW_FOLLOWER]: {
    title: 'Yangi kuzatuvchi',
    body: 'Sizni kuzata boshladi',
  },
  [NotificationKind.FOLLOWED_USER_POSTED]: {
    title: 'Yangi video',
    body: 'Siz kuzatayotgan foydalanuvchi video joyladi',
  },
  [NotificationKind.VIDEO_READY]: {
    title: 'Video tayyor',
    body: 'Videongiz joylandi',
  },
  [NotificationKind.VIDEO_FAILED]: {
    title: 'Video joylanmadi',
    body: 'Videongizni joylashda xatolik',
  },
  [NotificationKind.VIDEO_AWAITING_PAYMENT]: {
    title: "To'lov kutilmoqda",
    body: 'Videongiz uchun hisobingizni to’ldiring',
  },
  [NotificationKind.PRICE_BID_RECEIVED]: {
    title: 'Narx taklifi',
    body: "E'loningizga narx taklif qilindi",
  },
  [NotificationKind.PRICE_BID_COUNTERED]: {
    title: 'Qarshi taklif',
    body: 'Sotuvchi o’z narxini taklif qildi',
  },
  [NotificationKind.PRICE_BID_ACCEPTED]: {
    title: 'Taklif qabul qilindi',
    body: 'Narx taklifingiz qabul qilindi',
  },
  [NotificationKind.PRICE_BID_DECLINED]: {
    title: 'Taklif rad etildi',
    body: 'Narx taklifingiz rad etildi',
  },
  // Deliberately absent: PRICE_BID_EXPIRED. A bid lapsing is not worth
  // waking a phone for — the inbox row is enough. See the comment above:
  // a kind missing from here sends no push, and that is the mechanism.

  [NotificationKind.TOPUP_SUCCEEDED]: {
    title: "Hisob to'ldirildi",
    body: 'Balansingiz yangilandi',
  },
  [NotificationKind.TOPUP_FAILED]: {
    title: "To'lov amalga oshmadi",
    body: "To'lovni qayta urinib ko'ring",
  },
  [NotificationKind.TARIFF_PAID]: {
    title: 'Tarif faollashtirildi',
    body: "To'lov qabul qilindi",
  },
  [NotificationKind.TARIFF_EXPIRING]: {
    title: 'Tarif tugayapti',
    body: 'Tarifingiz muddati yakunlanmoqda',
  },
  // VIDEO_LIKE and COMMENT_REPLY stay inbox-only: a like is the highest
  // volume event in the app and the one least worth a buzz in somebody's
  // pocket.
};
