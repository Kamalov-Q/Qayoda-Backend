import { Global, Module } from '@nestjs/common';
import { ListingLiveGateway } from './listing-live.gateway';

/**
 * The public `/listings` socket, and nothing else.
 *
 * A leaf on purpose: views, comments and ratings all push through it, and if
 * it lived inside any one of them the other two would have to import that
 * module to reach it. Global for the same reason BlocksModule is — four
 * modules broadcast, none of them should have to know where the socket lives
 * — and it owns no entities, so there is nothing here to import in a cycle.
 */
@Global()
@Module({
  providers: [ListingLiveGateway],
  exports: [ListingLiveGateway],
})
export class LiveModule {}
