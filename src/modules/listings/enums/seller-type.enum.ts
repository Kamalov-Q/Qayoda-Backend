/** Who is behind the advert. Buyers filter on this before anything else. */
export enum SellerType {
  OWNER = 'OWNER',
  REALTOR = 'REALTOR',
}

/**
 * New build or resale.
 *
 * Only meaningful where a building exists — a plot of land is neither — so
 * the app offers it for floor-capable categories and the field stays null
 * elsewhere rather than storing a nonsense answer.
 */
export enum BuildingType {
  NEW = 'NEW',
  SECONDARY = 'SECONDARY',
}

/**
 * State of repair — the answer that decides whether a price is good.
 *
 * Six levels rather than a yes/no, because "ta'mirlangan" covers everything
 * from fresh paint to a full designer fit-out, and buyers filter on the
 * difference. The existing REPAIRED amenity stays for listings posted before
 * this field existed.
 */
export enum RepairType {
  /** Needs work before anyone can live in it. */
  NEEDS_REPAIR = 'NEEDS_REPAIR',
  AVERAGE = 'AVERAGE',
  COSMETIC = 'COSMETIC',
  EURO = 'EURO',
  DESIGNER = 'DESIGNER',
  /** Structural: rewired, replumbed, walls moved. */
  CAPITAL = 'CAPITAL',
}
