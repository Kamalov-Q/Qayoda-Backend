import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import sharp from 'sharp';

const MAX_FULL = 1600;
const MAX_THUMB = 400;

export interface UploadedImage {
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
}

export interface BatchUploadResult {
  images: UploadedImage[];
  failed: number[];
}

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  private readonly zone = process.env.BUNNY_STORAGE_ZONE!;
  private readonly host =
    process.env.BUNNY_STORAGE_HOST! ?? 'storage.bunnycdn.com';
  private readonly key = process.env.BUNNY_STORAGE_KEY!;
  private readonly cdnUrl = process.env.BUNNY_CDN_URL!;

  async processImage(buffer: Buffer): Promise<UploadedImage> {
    let meta: sharp.Metadata;

    try {
      meta = await sharp(buffer).metadata();
    } catch {
      throw new BadRequestException('Uploaded file is not an image');
    }

    if (!meta.width || !meta.height) {
      throw new BadRequestException('Unable to determine image dimensions');
    }

    const id = crypto.randomUUID();
    const prefix = `listings/${new Date().toISOString().slice(0, 7)}`;
    const fullPath = `${prefix}/${id}.jpg`;
    const thumbPath = `${prefix}/${id}_thumb.jpg`;

    const full = await sharp(buffer)
      .rotate()
      .resize(MAX_FULL, MAX_FULL, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer({ resolveWithObject: true });

    const thumb = await sharp(buffer)
      .rotate()
      .resize(MAX_THUMB, MAX_THUMB, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 70 })
      .toBuffer();

    await Promise.all([
      this.putToBunny(fullPath, full.data),
      this.putToBunny(thumbPath, thumb),
    ]);

    return {
      url: `${this.cdnUrl}/${fullPath}`,
      thumbUrl: `${this.cdnUrl}/${thumbPath}`,
      width: full.info.width,
      height: full.info.height,
    };
  }

  async processImages(buffers: Buffer[]): Promise<BatchUploadResult> {
    const results = await Promise.allSettled(
      buffers.map((b) => this.processImage(b)),
    );

    const images: UploadedImage[] = [];

    const failed: number[] = [];

    results.forEach((r, i) => {
      if (r.status === 'fulfilled') images.push(r.value);
      else {
        failed.push(i);
        this.logger.error(
          `Image ${i} in batch upload failed: ${(r.reason as Error)?.message}`,
        );
      }
    });

    if (images.length === 0) {
      throw new BadRequestException('All images failed to upload');
    }

    return { images, failed };
  }

  async deleteFromBunny(cdnUrl: string): Promise<void> {
    const storagePath = cdnUrl.replace(`${this.cdnUrl}/`, '');
    if (!storagePath || storagePath === cdnUrl) return;

    const res = await fetch(
      `https://${this.host}/${this.zone}/${storagePath}`,
      {
        method: 'DELETE',
        headers: { AccessKey: this.key },
      },
    );

    if (!res.ok && res.status !== 404) {
      this.logger.warn(
        `Bunny delete failed: ${res.status} ${await res.text()} for ${storagePath}`,
      );
    }
  }

  private async putToBunny(storagePath: string, data: Buffer): Promise<void> {
    const res = await fetch(
      `https://${this.host}/${this.zone}/${storagePath}`,
      {
        method: 'PUT',
        headers: {
          AccessKey: this.key,
          'Content-Type': 'application/octet-stream',
        },
        body: data,
      },
    );

    if (res.status !== 201) {
      const body = await res.text().catch(() => '');
      this.logger.error(`Bunny upload failed: ${res.status} ${body}`);
      throw new InternalServerErrorException(`Failed to upload to Bunny`);
    }
  }
}
