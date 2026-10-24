import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

/** The container types Bunny encodes without complaint, and phones produce. */
const MIME_TYPES = ['video/mp4', 'video/quicktime', 'video/x-matroska'] as const;

export class CreateListingVideoDto {
  @ApiPropertyOptional({
    enum: MIME_TYPES,
    description:
      'What the phone is about to send. Passed through to tus metadata, which Bunny requires; it is a hint for the encoder, not a check — the real limits are enforced against the encoded file.',
  })
  @IsOptional()
  @IsIn(MIME_TYPES as unknown as string[])
  mimeType?: string;
}
