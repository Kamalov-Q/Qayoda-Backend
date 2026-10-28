// enums/listing-status.enum.ts
export enum ListingStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  ARCHIVED = 'ARCHIVED',
  /**
   * The deal is done. Not the same thing as archived.
   *
   * Archived means "take this down" — the seller is withdrawing the advert,
   * for any reason or none. SOLD means "this found a buyer", which is a fact
   * about the property and worth keeping as one: the owner's own list can
   * show what they have shifted, and a stale link lands on something that
   * explains itself instead of a dead page.
   *
   * It behaves like archived everywhere that matters to a buyer — off the
   * map, out of the feed, closed to new offers — because almost every query
   * in the codebase allowlists `ACTIVE` rather than blocking `ARCHIVED`, so
   * a new status is excluded by default. That is deliberate: a status nobody
   * remembered to filter should disappear, not leak.
   *
   * Appended last. The Postgres type is altered with ADD VALUE, which
   * appends, so the TS order has to match or `schema:log` reports drift
   * forever.
   */
  SOLD = 'SOLD',
}
