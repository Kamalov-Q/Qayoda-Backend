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
