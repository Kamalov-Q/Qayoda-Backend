/**
 * Upper-snake, like the category slugs. It is what listings store in their
 * `properties` array, so it is the one field that can never change.
 */
export const AMENITY_KEY = /^[A-Z][A-Z0-9_]{1,39}$/;

/** A listing cannot reasonably pick more than the whole catalogue. */
export const MAX_AMENITIES_PER_LISTING = 50;

/**
 * What the table starts with on a fresh (empty) database — the twelve
 * amenities that used to be hard-coded in the mobile app, under the same keys
 * existing listings already store, with the labels the app used to carry.
 * Seed data, not logic: admins may rename or delete any of these.
 */
export const DEFAULT_AMENITIES: {
  key: string;
  nameUz: string;
  nameRu: string;
}[] = [
  { key: 'REPAIRED', nameUz: "Ta'mirlangan", nameRu: 'С ремонтом' },
  { key: 'FURNISHED', nameUz: 'Mebel bilan', nameRu: 'С мебелью' },
  { key: 'AC', nameUz: 'Konditsioner', nameRu: 'Кондиционер' },
  { key: 'HEATING', nameUz: 'Isitish tizimi', nameRu: 'Отопление' },
  { key: 'PARKING', nameUz: 'Avtoturargoh', nameRu: 'Парковка' },
  { key: 'GARAGE', nameUz: 'Garaj', nameRu: 'Гараж' },
  { key: 'BALCONY', nameUz: 'Balkon', nameRu: 'Балкон' },
  { key: 'ELEVATOR', nameUz: 'Lift', nameRu: 'Лифт' },
  { key: 'INTERNET', nameUz: 'Internet', nameRu: 'Интернет' },
  { key: 'SECURITY', nameUz: "Qo'riqlanadi", nameRu: 'Охрана' },
  { key: 'POOL', nameUz: 'Basseyn', nameRu: 'Бассейн' },
  { key: 'GARDEN', nameUz: "Bog'", nameRu: 'Сад' },
];
