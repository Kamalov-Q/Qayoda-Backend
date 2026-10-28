// enums/price-bid-direction.enum.ts

/**
 * Who put this number on the table.
 *
 * A counter-offer is not a separate concept — it is a bid with the direction
 * reversed, on the same listing, between the same two people. Modelling it as
 * one more row of the same shape is what keeps "accept" meaning one thing.
 */
export enum PriceBidDirection {
  /** The buyer's offer. */
  BUYER = 'BUYER',
  /** The seller's counter. */
  SELLER = 'SELLER',
}
