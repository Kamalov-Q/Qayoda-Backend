import {
  BadRequestException,
  Controller,
  Post,
  Query,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiQuery,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { MediaService } from './media.service';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { Throttle } from '@nestjs/throttler';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { ErrorResponse } from 'src/shared/responses/error.response';
import {
  BatchUploadResponse,
  ChatAttachmentResponse,
} from './responses/upload.response';

const MAX_FILES = 30;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
/**
 * The ceiling on one upload.
 *
 * Must stay AT OR BELOW nginx's `client_max_body_size` (see
 * /etc/nginx/sites-available/uynest): the proxy rejects a bigger body with an
 * HTML page, before the API can explain itself, and the app then has nothing
 * to tell the user but "upload failed".
 *
 * Raising it is not free — Multer's default storage holds the whole file in
 * memory, and the video path then writes a second copy to /tmp for ffmpeg, so
 * one 64MB upload costs ~128MB on a 2GB box. Past this, move this endpoint to
 * disk storage rather than raising the number again.
 */
const MAX_CHAT_FILE_SIZE = 64 * 1024 * 1024;

const ATTACHMENT_KINDS = [
  'IMAGE',
  'VIDEO',
  'VOICE',
  'VIDEO_NOTE',
  'FILE',
] as const;

type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

@ApiTags('Media')
@ApiBearerAuth('access-token')
@ApiUnauthorizedResponse({
  type: ErrorResponse,
  description: 'Missing or expired access token.',
})
@ApiTooManyRequestsResponse({
  type: ErrorResponse,
  description: 'Rate limit for this endpoint exceeded.',
})
@Controller('media')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @ApiOperation({
    summary: 'Upload listing images',
    description: [
      `Accepts up to ${MAX_FILES} images in one multipart request (${MAX_FILE_SIZE / 1024 / 1024}MB each) and returns their CDN URLs, ready to attach to a listing.`,
      '',
      'Each image is auto-rotated from its EXIF orientation and re-encoded to JPEG twice: a full-size render capped at 1600px and a 400px thumbnail.',
      '',
      'Partial failure is not an error — files are processed independently, and the indexes that failed come back in `failed` so only those need resubmitting. The request fails only when every file failed.',
      '',
      'Rate limit: 30 requests per minute.',
    ].join('\n'),
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['files'],
      properties: {
        files: {
          type: 'array',
          maxItems: MAX_FILES,
          items: { type: 'string', format: 'binary' },
        },
      },
    },
  })
  @ApiCreatedResponse({ type: BatchUploadResponse })
  @ApiBadRequestResponse({
    type: ErrorResponse,
    description: 'No file was sent, or every file failed to process.',
  })
  @ApiPayloadTooLargeResponse({
    type: ErrorResponse,
    description: `A file exceeded ${MAX_FILE_SIZE / 1024 / 1024}MB.`,
  })
  @UseGuards(JwtAccessGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('upload')
  @UseInterceptors(
    FilesInterceptor('files', MAX_FILES, {
      limits: { fileSize: MAX_FILE_SIZE },
    }),
  )
  upload(@UploadedFiles() files: Express.Multer.File[]) {
    if (!files?.length) {
      throw new BadRequestException('Upload at least one file');
    }
    return this.mediaService.processImages(files.map((f) => f.buffer));
  }

  @ApiOperation({
    summary: 'Upload a chat attachment',
    description: [
      `Uploads one file (up to ${MAX_CHAT_FILE_SIZE / 1024 / 1024}MB) and returns the metadata to pass straight into a \`sendMessage\` payload — \`url\`, \`thumbUrl\`, \`fileSize\`, \`durationSec\`, dimensions and waveform.`,
      '',
      'Processing depends on `kind`:',
      '',
      '- `IMAGE` — re-encoded to JPEG at 1600px with a 400px thumbnail.',
      '- `VIDEO` / `VIDEO_NOTE` — stored as sent; a poster frame is extracted at the 1s mark and the duration and dimensions are probed.',
      '- `VOICE` — stored as sent; duration is probed and a 60-bucket waveform is derived for the player UI.',
      '- `FILE` — stored as sent, with no processing.',
      '',
      'Media probing is best-effort: if ffmpeg cannot read the file, the upload still succeeds with the derived fields left `null`.',
      '',
      'Rate limit: 60 requests per minute.',
    ].join('\n'),
  })
  @ApiConsumes('multipart/form-data')
  @ApiQuery({
    name: 'kind',
    enum: ATTACHMENT_KINDS,
    required: true,
    description: 'Selects the processing pipeline. Must match the message type.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiCreatedResponse({ type: ChatAttachmentResponse })
  @ApiBadRequestResponse({
    type: ErrorResponse,
    description:
      'No file was sent, `kind` is not one of the accepted values, or `kind=IMAGE` was used for something that is not an image.',
  })
  @ApiPayloadTooLargeResponse({
    type: ErrorResponse,
    description: `The file exceeded ${MAX_CHAT_FILE_SIZE / 1024 / 1024}MB.`,
  })
  @UseGuards(JwtAccessGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('chat/upload')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_CHAT_FILE_SIZE } }),
  )
  uploadChatAttachment(
    @UploadedFile() file: Express.Multer.File,
    @Query('kind') kind: AttachmentKind,
  ) {
    if (!file) throw new BadRequestException('Upload a file');
    if (!ATTACHMENT_KINDS.includes(kind))
      throw new BadRequestException('Invalid kind');
    return this.mediaService.processChatAttachment(file, kind);
  }

  @ApiOperation({
    summary: 'Upload a photo or a video for a story',
    description: [
      'Same processing as a chat attachment — images are re-encoded and thumbed, videos are probed for their duration and given a poster frame — under its own path so the two can diverge later without a migration of callers.',
      '',
      'Returns the URLs to hand to POST /stories. Only IMAGE and VIDEO: a story is something to look at.',
    ].join('\n'),
  })
  @ApiBadRequestResponse({
    type: ErrorResponse,
    description: `The file exceeded ${MAX_CHAT_FILE_SIZE / 1024 / 1024}MB.`,
  })
  @UseGuards(JwtAccessGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('stories/upload')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_CHAT_FILE_SIZE } }),
  )
  uploadStoryMedia(
    @UploadedFile() file: Express.Multer.File,
    @Query('kind') kind: AttachmentKind,
  ) {
    if (!file) throw new BadRequestException('Upload a file');
    if (kind !== 'IMAGE' && kind !== 'VIDEO') {
      throw new BadRequestException('A story is a photo or a video');
    }
    return this.mediaService.processChatAttachment(file, kind);
  }
}
