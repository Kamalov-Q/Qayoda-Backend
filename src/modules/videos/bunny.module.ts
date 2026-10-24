import { Module } from '@nestjs/common';
import { BunnyStreamService } from './bunny-stream.service';

/**
 * The upload pipeline, on its own, so that more than one feature can use it.
 *
 * Reels and listing tours are separate features with separate tables and
 * separate rules — but they are the same 40 MB of H.264 going to the same
 * Bunny library through the same signed tus ticket. That part is shared;
 * nothing else is.
 */
@Module({
  providers: [BunnyStreamService],
  exports: [BunnyStreamService],
})
export class BunnyModule {}
