import { ApiProperty } from '@nestjs/swagger';

export class UploadedImageResponse {
  @ApiProperty({
    example: 'https://cdn.example.com/listings/2026-08/3f1c9d2e.jpg',
    description: 'Full-size render, JPEG, longest edge capped at 1600px.',
  })
  url: string;

  @ApiProperty({
    example: 'https://cdn.example.com/listings/2026-08/3f1c9d2e_thumb.jpg',
    description: 'Thumbnail, JPEG, longest edge capped at 400px.',
  })
  thumbUrl: string;

  @ApiProperty({ example: 1600, description: 'Width of `url` after resizing.' })
  width: number;

  @ApiProperty({ example: 1200, description: 'Height of `url` after resizing.' })
  height: number;
}

export class BatchUploadResponse {
  @ApiProperty({
    type: [UploadedImageResponse],
    description: 'Successfully processed images, in submission order.',
  })
  images: UploadedImageResponse[];

  @ApiProperty({
    type: [Number],
    example: [2],
    description:
      'Indexes in the submitted array that failed. The rest still uploaded — resubmit only these.',
  })
  failed: number[];
}

export class ChatAttachmentResponse {
  @ApiProperty({ example: 'https://cdn.example.com/chat/2026-08/3f1c9d2e.jpg' })
  url: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'https://cdn.example.com/chat/2026-08/3f1c9d2e_thumb.jpg',
    description:
      'Image thumbnail or video poster frame. `null` for voice and generic files, and also when poster extraction failed — clients should fall back to a placeholder.',
  })
  thumbUrl: string | null;

  @ApiProperty({ example: 'shartnoma.pdf', description: 'Original file name.' })
  fileName: string;

  @ApiProperty({ example: 248130, description: 'Stored size in bytes.' })
  fileSize: number;

  @ApiProperty({ example: 'image/jpeg' })
  mimeType: string;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 12,
    description: 'Probed duration for audio and video, rounded to seconds.',
  })
  durationSec: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 1600 })
  width: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 1200 })
  height: number | null;

  @ApiProperty({
    type: [Number],
    nullable: true,
    example: [4, 18, 55, 92, 71, 30, 12],
    description:
      '60 RMS buckets normalised to 0-100, for the voice-note waveform. Only set for `VOICE`.',
  })
  waveform: number[] | null;
}
