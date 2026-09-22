import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Amenity } from './amenity.entity';
import { DEFAULT_AMENITIES } from './amenities.constants';
import { CreateAmenityDto, UpdateAmenityDto } from './dto/amenity.dto';

@Injectable()
export class AmenitiesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AmenitiesService.name);

  /**
   * Every amenity, by key. Tiny and read on every listing write and every
   * app launch, so it is held in memory and rebuilt after any change made
   * through this service — same shape as CategoriesService.
   */
  private cache: Map<string, Amenity> | null = null;

  constructor(
    @InjectRepository(Amenity) private readonly amenities: Repository<Amenity>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * First boot only: the twelve amenities the mobile app used to hard-code,
   * under the same keys existing listings already store. Only when the table
   * is EMPTY — re-seeding would resurrect a default an admin had deleted.
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      if ((await this.amenities.count()) > 0) return;
      await this.amenities.insert(
        DEFAULT_AMENITIES.map((a, i) => ({ ...a, sortOrder: i, isActive: true })),
      );
      this.logger.log(`Seeded ${DEFAULT_AMENITIES.length} default amenities.`);
    } catch (e) {
      // Never block startup over seed data.
      this.logger.error(`Amenity seed failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  private async all(): Promise<Map<string, Amenity>> {
    if (!this.cache) {
      const rows = await this.amenities.find({
        order: { sortOrder: 'ASC', nameUz: 'ASC' },
      });
      this.cache = new Map(rows.map((a) => [a.key, a]));
    }
    return this.cache;
  }

  private invalidate() {
    this.cache = null;
  }

  /** What the app offers on the post form: active amenities, in order. */
  async listPublic() {
    return [...(await this.all()).values()]
      .filter((a) => a.isActive)
      .map(({ key, nameUz, nameRu, sortOrder }) => ({ key, nameUz, nameRu, sortOrder }));
  }

  /** Everything, with how many listings picked each — the dashboard's table. */
  async listAdmin() {
    const counts = await this.dataSource.query<{ key: string; count: string }[]>(
      // jsonb `?` tests "array contains this string" — properties is a jsonb
      // array of amenity keys.
      `SELECT a.key, COUNT(l.id) AS count
         FROM amenities a
         LEFT JOIN listings l ON l.properties ? a.key
        GROUP BY a.key`,
    );
    const countByKey = new Map(counts.map((r) => [r.key, Number(r.count)]));
    return [...(await this.all()).values()].map((a) => ({
      key: a.key,
      nameUz: a.nameUz,
      nameRu: a.nameRu,
      sortOrder: a.sortOrder,
      isActive: a.isActive,
      listingCount: countByKey.get(a.key) ?? 0,
    }));
  }

  /**
   * Listing writes call this: every key must exist in the catalogue. Hidden
   * amenities stay valid — hiding one must not break edits of the listings
   * that already have it.
   */
  async assertValidKeys(keys: string[] | undefined): Promise<void> {
    if (!keys?.length) return;
    const known = await this.all();
    const bad = keys.filter((k) => !known.has(k));
    if (bad.length) {
      throw new BadRequestException({
        code: 'UNKNOWN_AMENITY',
        message: `Unknown amenity key(s): ${bad.join(', ')}`,
      });
    }
  }

  async create(dto: CreateAmenityDto) {
    if (await this.amenities.existsBy({ key: dto.key })) {
      throw new ConflictException({
        code: 'AMENITY_EXISTS',
        message: `${dto.key} already exists`,
      });
    }
    await this.amenities.insert({
      key: dto.key,
      nameUz: dto.nameUz,
      nameRu: dto.nameRu,
      sortOrder: dto.sortOrder ?? (await this.amenities.count()),
      isActive: dto.isActive ?? true,
    });
    this.invalidate();
    return (await this.listAdmin()).find((a) => a.key === dto.key)!;
  }

  async update(key: string, dto: UpdateAmenityDto) {
    const amenity = await this.amenities.findOneBy({ key });
    if (!amenity) throw new NotFoundException({ code: 'AMENITY_NOT_FOUND' });
    await this.amenities.update({ key }, { ...dto });
    this.invalidate();
    return (await this.listAdmin()).find((a) => a.key === key)!;
  }

  /**
   * Unlike categories there is nothing to refile: deleting an amenity simply
   * strips it from the listings that picked it, in the same transaction.
   */
  async remove(key: string) {
    const amenity = await this.amenities.findOneBy({ key });
    if (!amenity) throw new NotFoundException({ code: 'AMENITY_NOT_FOUND' });

    const [{ count }] = await this.dataSource.query<{ count: string }[]>(
      `SELECT COUNT(*) AS count FROM listings WHERE properties ? $1`,
      [key],
    );
    const inUse = Number(count);

    await this.dataSource.transaction(async (m) => {
      if (inUse > 0) {
        // jsonb `-` removes the string element from the array.
        await m.query(
          `UPDATE listings SET properties = properties - $1 WHERE properties ? $1`,
          [key],
        );
      }
      await m.delete(Amenity, { key });
    });
    this.invalidate();
    return { deleted: key, strippedFrom: inUse };
  }
}
