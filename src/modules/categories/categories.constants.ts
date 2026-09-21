/**
 * The glyphs a category may use. A fixed set rather than free text: the
 * mobile app draws each key with its own icon, and an icon it doesn't know
 * would render as nothing. Keep in step with the app's CATEGORY_ICON_MAP and
 * the dashboard's CategoryIcon.
 */
export const CATEGORY_ICON_KEYS = [
  'apartment',
  'house',
  'land',
  'shop',
  'building',
  'dacha',
  'hotel',
  'office',
  'warehouse',
  'garage',
  'farm',
  'grid',
] as const;
export type CategoryIconKey = (typeof CATEGORY_ICON_KEYS)[number];

/**
 * Upper-snake, like the original enum values it continues. It is what
 * listings store, so it's the one field that can never change once created.
 */
export const CATEGORY_SLUG = /^[A-Z][A-Z0-9_]{1,39}$/;

/**
 * What the table starts with on a fresh (empty) database — seed data, not
 * logic: nothing reads this list after first boot, and admins may rename or
 * delete any of these. The slugs are the ones listings stored when categories
 * were a fixed enum, so listings from that time stay valid.
 */
export const DEFAULT_CATEGORIES: {
  slug: string;
  nameUz: string;
  nameRu: string;
  icon: CategoryIconKey;
  floorCapable: boolean;
}[] = [
  { slug: 'APARTMENT', nameUz: 'Kvartira', nameRu: 'Квартира', icon: 'apartment', floorCapable: true },
  { slug: 'HOUSE', nameUz: 'Hovli', nameRu: 'Дом', icon: 'house', floorCapable: false },
  { slug: 'LAND', nameUz: 'Yer', nameRu: 'Участок', icon: 'land', floorCapable: false },
  { slug: 'NON_RESIDENTIAL', nameUz: 'Noturar joy', nameRu: 'Нежилое помещение', icon: 'shop', floorCapable: true },
  { slug: 'BUILDING', nameUz: 'Bino', nameRu: 'Здание', icon: 'building', floorCapable: true },
  { slug: 'DACHA', nameUz: 'Dacha', nameRu: 'Дача', icon: 'dacha', floorCapable: false },
  { slug: 'HOTEL', nameUz: 'Mehmonxona', nameRu: 'Гостиница', icon: 'hotel', floorCapable: true },
];
