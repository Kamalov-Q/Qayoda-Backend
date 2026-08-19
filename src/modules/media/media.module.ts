import { Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { DeleteListingImageListener } from './listeners/delete-listing-image.listener';
import { MediaFacade } from './media.facade';

@Module({
  controllers: [MediaController],
  providers: [MediaService, DeleteListingImageListener, MediaFacade],
  exports: [MediaFacade],
})
export class MediaModule {}
