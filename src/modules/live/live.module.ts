import { Global, Module } from '@nestjs/common';
import { ListingLiveGateway } from './listing-live.gateway';
import { VideoLiveGateway } from './video-live.gateway';

/**
 * The two public sockets: `/listings` and `/videos`.
 *
 * A leaf on purpose: views, comments, ratings and now a reel's counters all
 * push through here, and if a gateway lived inside any one of those modules
 * the rest would have to import it to reach the socket. Global for the same
 * reason BlocksModule is, and it owns no entities, so there is nothing here
 * to import in a cycle.
 */
@Global()
@Module({
  providers: [ListingLiveGateway, VideoLiveGateway],
  exports: [ListingLiveGateway, VideoLiveGateway],
})
export class LiveModule {}
