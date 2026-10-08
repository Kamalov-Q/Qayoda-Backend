import { Injectable } from '@nestjs/common';
import { MediaService, ProcessedAvatar } from './media.service';

@Injectable()
export class MediaFacade {
  constructor(private readonly mediaService: MediaService) {}

  processAvatar(buffer: Buffer): Promise<ProcessedAvatar> {
    return this.mediaService.processAvatar(buffer);
  }
}
