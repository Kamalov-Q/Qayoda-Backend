import { Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { ProfileController } from './profile.controller';
import { MediaService } from './media.service';
import { DeleteListingImageListener } from './listeners/delete-listing-image.listener';
import { MediaFacade } from './media.facade';
import { IamModule } from '../iam/iam.module';

@Module({
  // ProfileController was written but never registered here, so every
  // /profile route answered 404.
  imports: [IamModule],
  controllers: [MediaController, ProfileController],
  providers: [MediaService, DeleteListingImageListener, MediaFacade],
  exports: [MediaFacade],
})
export class MediaModule {}
