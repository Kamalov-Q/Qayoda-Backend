import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

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

export interface ChatAttachment {
  url: string;
  thumbUrl: string | null;
  fileName: string;
  fileSize: number;
  mimeType: string;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  waveform: number[] | null;
}

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  private readonly zone = process.env.BUNNY_STORAGE_ZONE!;
  private readonly host =
    process.env.BUNNY_STORAGE_HOST ?? 'storage.bunnycdn.com';
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
    // `fetch` rejects Buffer: undici types its body as NodeJS.ArrayBufferView,
    // which does not admit the `ArrayBufferLike` generic that Buffer carries.
    // This is a view over the same memory, not a copy — it matters at image size.
    const body = new Uint8Array(
      data.buffer as ArrayBuffer,
      data.byteOffset,
      data.byteLength,
    );

    const res = await fetch(
      `https://${this.host}/${this.zone}/${storagePath}`,
      {
        method: 'PUT',
        headers: {
          AccessKey: this.key,
          'Content-Type': 'application/octet-stream',
        },
        body,
      },
    );

    if (res.status !== 201) {
      const body = await res.text().catch(() => '');
      this.logger.error(`Bunny upload failed: ${res.status} ${body}`);
      throw new InternalServerErrorException(`Failed to upload to Bunny`);
    }
  }

  async processChatAttachment(
    file: Express.Multer.File,
    kind: 'IMAGE' | 'VIDEO' | 'VOICE' | 'VIDEO_NOTE' | 'FILE',
  ): Promise<ChatAttachment> {
    const id = crypto.randomUUID();
    const prefix = `chat/${new Date().toISOString().slice(0, 7)}`;
    const ext = this.safeExt(file);

    if (kind === 'IMAGE') return this.processChatImage(file, id, prefix);
    if (kind === 'VIDEO' || kind === 'VIDEO_NOTE')
      return this.processChatVideo(file, id, prefix, ext);
    if (kind === 'VOICE') return this.processChatVoice(file, id, prefix, ext);
    return this.processChatFile(file, id, prefix, ext);
  }

  private async processChatImage(
    file: Express.Multer.File,
    id: string,
    prefix: string,
  ): Promise<ChatAttachment> {
    let full: { data: Buffer; info: sharp.OutputInfo };
    let thumb: Buffer;

    try {
      full = await sharp(file.buffer)
        .rotate()
        .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toBuffer({ resolveWithObject: true });

      thumb = await sharp(file.buffer)
        .rotate()
        .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 70 })
        .toBuffer();
    } catch {
      // A non-image sent as kind=IMAGE is the client's mistake, not a 500.
      throw new BadRequestException('Uploaded file is not an image');
    }

    const fullPath = `${prefix}/${id}.jpg`;
    const thumbPath = `${prefix}/${id}_thumb.jpg`;
    await Promise.all([
      this.putToBunny(fullPath, full.data),
      this.putToBunny(thumbPath, thumb),
    ]);

    return {
      url: `${this.cdnUrl}/${fullPath}`,
      thumbUrl: `${this.cdnUrl}/${thumbPath}`,
      fileName: file.originalname,
      fileSize: full.data.length,
      mimeType: 'image/jpeg',
      durationSec: null,
      width: full.info.width,
      height: full.info.height,
      waveform: null,
    };
  }

  /** Uploads the video as-is; extracts a poster frame at 1s */
  private async processChatVideo(
    file: Express.Multer.File,
    id: string,
    prefix: string,
    ext: string,
  ): Promise<ChatAttachment> {
    const tmpIn = path.join(os.tmpdir(), `${id}${ext}`);
    const tmpThumb = path.join(os.tmpdir(), `${id}_poster.jpg`);
    await fs.writeFile(tmpIn, file.buffer);

    let durationSec: number | null = null;
    let width: number | null = null;
    let height: number | null = null;

    try {
      const meta = await this.probe(tmpIn);
      durationSec = meta.durationSec;
      width = meta.width;
      height = meta.height;

      await new Promise<void>((resolve, reject) => {
        ffmpeg(tmpIn)
          .screenshots({
            timestamps: ['1'],
            filename: path.basename(tmpThumb),
            folder: path.dirname(tmpThumb),
            size: '480x?',
          })
          .on('end', () => resolve())
          .on('error', reject);
      });
    } catch (err) {
      this.logger.warn(
        `Video probe/poster failed for ${id}: ${(err as Error).message}`,
      );
    }

    const videoPath = `${prefix}/${id}${ext}`;
    let thumbUrl: string | null = null;

    try {
      await this.putToBunny(videoPath, file.buffer);

      try {
        const buf = await fs.readFile(tmpThumb);
        const thumbPath = `${prefix}/${id}_poster.jpg`;
        await this.putToBunny(thumbPath, buf);
        thumbUrl = `${this.cdnUrl}/${thumbPath}`;
      } catch {
        /* no poster — client shows a placeholder */
      }
    } finally {
      // Runs even if the upload threw, so /tmp does not fill up with orphans.
      await Promise.allSettled([fs.unlink(tmpIn), fs.unlink(tmpThumb)]);
    }

    return {
      url: `${this.cdnUrl}/${videoPath}`,
      thumbUrl,
      fileName: file.originalname,
      fileSize: file.size,
      mimeType: file.mimetype,
      durationSec,
      width,
      height,
      waveform: null,
    };
  }

  /** Derives duration + a 60-bucket waveform from mono 8kHz PCM */
  private async processChatVoice(
    file: Express.Multer.File,
    id: string,
    prefix: string,
    ext: string,
  ): Promise<ChatAttachment> {
    const tmpIn = path.join(os.tmpdir(), `${id}_in${ext}`);
    const tmpPcm = path.join(os.tmpdir(), `${id}.pcm`);
    await fs.writeFile(tmpIn, file.buffer);

    let durationSec: number | null = null;
    let waveform: number[] | null = null;

    try {
      durationSec = (await this.probe(tmpIn)).durationSec;

      await new Promise<void>((resolve, reject) => {
        ffmpeg(tmpIn)
          .audioChannels(1)
          .audioFrequency(8000)
          .format('s16le')
          .on('end', () => resolve())
          .on('error', reject)
          .save(tmpPcm);
      });

      waveform = this.buildWaveform(await fs.readFile(tmpPcm), 60);
    } catch (err) {
      this.logger.warn(
        `Voice processing failed for ${id}: ${(err as Error).message}`,
      );
    }

    const audioPath = `${prefix}/${id}${ext}`;
    try {
      await this.putToBunny(audioPath, file.buffer);
    } finally {
      await Promise.allSettled([fs.unlink(tmpIn), fs.unlink(tmpPcm)]);
    }

    return {
      url: `${this.cdnUrl}/${audioPath}`,
      thumbUrl: null,
      fileName: file.originalname,
      fileSize: file.size,
      mimeType: file.mimetype,
      durationSec,
      width: null,
      height: null,
      waveform,
    };
  }

  private async processChatFile(
    file: Express.Multer.File,
    id: string,
    prefix: string,
    ext: string,
  ): Promise<ChatAttachment> {
    const filePath = `${prefix}/${id}${ext}`;
    await this.putToBunny(filePath, file.buffer);
    return {
      url: `${this.cdnUrl}/${filePath}`,
      thumbUrl: null,
      fileName: file.originalname,
      fileSize: file.size,
      mimeType: file.mimetype || 'application/octet-stream',
      durationSec: null,
      width: null,
      height: null,
      waveform: null,
    };
  }

  private probe(
    filePath: string,
  ): Promise<{
    durationSec: number | null;
    width: number | null;
    height: number | null;
  }> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, data) => {
        if (err) {
          return reject(err instanceof Error ? err : new Error(String(err)));
        }
        const stream = data.streams.find((s) => s.width && s.height);
        resolve({
          durationSec: data.format.duration
            ? Math.round(data.format.duration)
            : null,
          width: stream?.width ?? null,
          height: stream?.height ?? null,
        });
      });
    });
  }

  /** RMS per bucket, normalized 0-100 */
  private buildWaveform(pcm: Buffer, buckets: number): number[] {
    const samples = Math.floor(pcm.length / 2);
    if (samples === 0) return [];
    const per = Math.max(1, Math.floor(samples / buckets));
    const out: number[] = [];

    for (let b = 0; b < buckets; b++) {
      let sum = 0;
      let count = 0;
      for (let i = b * per; i < Math.min((b + 1) * per, samples); i++) {
        const v = pcm.readInt16LE(i * 2) / 32768;
        sum += v * v;
        count++;
      }
      out.push(count ? Math.sqrt(sum / count) : 0);
    }
    const peak = Math.max(...out, 0.0001);
    return out.map((v) => Math.round((v / peak) * 100));
  }

  /**
   * `originalname` is client-controlled and the extension ends up in both a
   * temp path and the Bunny storage key, so anything but plain alphanumerics
   * is dropped and we fall back to the declared MIME type.
   */
  private safeExt(file: Express.Multer.File): string {
    const raw = path.extname(path.basename(file.originalname ?? ''));
    return /^\.[a-zA-Z0-9]{1,8}$/.test(raw)
      ? raw.toLowerCase()
      : this.extFor(file.mimetype);
  }

  private extFor(mime: string): string {
    const map: Record<string, string> = {
      'audio/mp4': '.m4a',
      'audio/m4a': '.m4a',
      'audio/mpeg': '.mp3',
      'audio/aac': '.aac',
      'audio/ogg': '.ogg',
      'audio/webm': '.webm',
      'video/mp4': '.mp4',
      'video/quicktime': '.mov',
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'application/pdf': '.pdf',
    };
    return map[mime] ?? '.bin';
  }
}
