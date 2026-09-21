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
import { Category } from './category.entity';
import { DEFAULT_CATEGORIES } from './categories.constants';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';

@Injectable()
export class CategoriesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CategoriesService.name);

  /**
   * Every category, by slug. The list is tiny and read on every listing
   * write and every app launch, so it is held in memory and rebuilt after
   * any change made through this service.
   */
  private cache: Map<string, Category> | null = null;

  constructor(
    @InjectRepository(Category) private readonly categories: Repository<Category>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * First boot only: the seven categories that used to be hard-coded, under
   * the same keys existing listings already store. Only when the table is
   * EMPTY — re-seeding on every boot would resurrect a default an admin had
   * deliberately deleted.
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      if ((await this.categories.count()) > 0) return;
      await this.categories.insert(
        DEFAULT_CATEGORIES.map((c, i) => ({ ...c, sortOrder: i, isActive: true })),
      );
      this.logger.log(`Seeded ${DEFAULT_CATEGORIES.length} default categories.`);
    } catch (e) {
      // Never block startup over seed data.
      this.logger.error(`Category seed failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  private async all(): Promise<Map<string, Category>> {
    if (!this.cache) {
      const rows = await this.categories.find({
        order: { sortOrder: 'ASC', nameUz: 'ASC' },
      });
      this.cache = new Map(rows.map((c) => [c.slug, c]));
    }
    return this.cache;
  }

  private invalidate() {
    this.cache = null;
  }

  /** What the app offers: active categories, in display order. */
  async listPublic() {
    return [...(await this.all()).values()]
      .filter((c) => c.isActive)
      .map(({ slug, nameUz, nameRu, icon, sortOrder, floorCapable }) => ({
        slug,
        nameUz,
        nameRu,
        icon,
        sortOrder,
        floorCapable,
      }));
  }

  /** Every category, hidden ones included, with how many listings use each. */
  async listAdmin() {
    const counts = await this.dataSource.query<{ category: string; count: string }[]>(
      `SELECT category, COUNT(*) AS count FROM listings GROUP BY category`,
    );
    const bySlug = new Map(counts.map((r) => [r.category, Number(r.count)]));
    return [...(await this.all()).values()].map((c) => ({
      ...c,
      listingCount: bySlug.get(c.slug) ?? 0,
    }));
  }

  async find(slug: string): Promise<Category | null> {
    return (await this.all()).get(slug) ?? null;
  }

  /**
   * For listing create/update: the category must exist and be offered.
   * A hidden category still validates for listings already in it (see
   * `allowHidden`) — hiding must not make their owners' edits fail.
   */
  async requireUsable(slug: string, { allowHidden = false } = {}): Promise<Category> {
    const category = await this.find(slug);
    if (!category || (!category.isActive && !allowHidden)) {
      throw new BadRequestException({
        code: 'CATEGORY_UNKNOWN',
        message: `Unknown category "${slug}"`,
      });
    }
    return category;
  }

  async create(dto: CreateCategoryDto) {
    if (await this.categories.existsBy({ slug: dto.slug })) {
      throw new ConflictException({
        code: 'CATEGORY_EXISTS',
        message: `Category "${dto.slug}" already exists`,
      });
    }
    // New categories go to the end unless told otherwise.
    const last = await this.categories
      .createQueryBuilder('c')
      .select('COALESCE(MAX(c.sort_order), -1)', 'max')
      .getRawOne<{ max: number }>();

    const saved = await this.categories.save(
      this.categories.create({
        ...dto,
        sortOrder: dto.sortOrder ?? Number(last?.max ?? -1) + 1,
        isActive: dto.isActive ?? true,
        floorCapable: dto.floorCapable ?? false,
      }),
    );
    this.invalidate();
    return { ...saved, listingCount: 0 };
  }

  async update(slug: string, dto: UpdateCategoryDto) {
    const category = await this.categories.findOneBy({ slug });
    if (!category) throw new NotFoundException({ code: 'CATEGORY_NOT_FOUND' });

    const losesFloors = category.floorCapable && dto.floorCapable === false;

    await this.dataSource.transaction(async (m) => {
      await m.update(Category, { slug }, dto);
      if (losesFloors) {
        // The same rule a single listing follows when refiled into a
        // floor-less category: the stored floors are stale data now, not
        // wrong input, so they are cleared rather than left to contradict it.
        await m.query(
          `UPDATE listings SET floor = NULL, total_floors = NULL WHERE category = $1`,
          [slug],
        );
      }
    });
    this.invalidate();
    return (await this.listAdmin()).find((c) => c.slug === slug)!;
  }

  /**
   * Deleting a category that listings use would leave them pointing at
   * nothing, so it requires `moveTo`: those listings (and their map points)
   * are refiled there first, in the same transaction as the delete.
   */
  async remove(slug: string, moveTo?: string) {
    const category = await this.categories.findOneBy({ slug });
    if (!category) throw new NotFoundException({ code: 'CATEGORY_NOT_FOUND' });

    if ((await this.categories.count()) <= 1) {
      throw new ConflictException({
        code: 'LAST_CATEGORY',
        message: 'The last category cannot be deleted',
      });
    }

    const [{ count }] = await this.dataSource.query<{ count: string }[]>(
      `SELECT COUNT(*) AS count FROM listings WHERE category = $1`,
      [slug],
    );
    const inUse = Number(count);

    let target: Category | null = null;
    if (inUse > 0) {
      if (!moveTo) {
        throw new ConflictException({
          code: 'CATEGORY_IN_USE',
          message: `${inUse} listing(s) use this category — choose where to move them`,
          count: inUse,
        });
      }
      if (moveTo === slug) {
        throw new BadRequestException({ code: 'CATEGORY_MOVE_TO_SELF' });
      }
      target = await this.categories.findOneBy({ slug: moveTo });
      if (!target) throw new NotFoundException({ code: 'CATEGORY_NOT_FOUND' });
    }

    await this.dataSource.transaction(async (m) => {
      if (target) {
        await m.query(
          `UPDATE listings SET category = $1${
            target.floorCapable ? '' : ', floor = NULL, total_floors = NULL'
          } WHERE category = $2`,
          [target.slug, slug],
        );
        // The map's read model carries the category too.
        await m.query(`UPDATE listing_map_points SET category = $1 WHERE category = $2`, [
          target.slug,
          slug,
        ]);
      }
      await m.delete(Category, { slug });
    });
    this.invalidate();
    return { deleted: slug, moved: inUse, moveTo: target?.slug ?? null };
  }
}
