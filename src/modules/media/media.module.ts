import { Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { DeleteListingImageListener } from './listeners/delete-listing-image.listener';

@Module({
  controllers: [MediaController],
  providers: [MediaService, DeleteListingImageListener],
})
export class MediaModule {}
