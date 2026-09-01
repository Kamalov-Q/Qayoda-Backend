import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ListingRepository } from './repositories/listing.repository';
import { ListingsGeoService } from './listings-geo.service';
import { OutBoxService } from 'src/shared/events/outbox.service';
import { DataSource } from 'typeorm';
import { CreateListingDto } from './dto/create-listing.dto';
import { Listing } from './entities/listing.entity';
import { ListingOffer } from './entities/listing-offer.entity';
import { ListingStatus } from './enums/listing-status.enum';
import { UpdateListingDto } from './dto/update-listing.dto';
import { UpdateOffersDto } from './dto/update-offers.dto';
import { UpdateGeometryDto } from './dto/update-geometry.dto';
import { ListingImage } from './entities/listing-image.entity';
import { UpdateImagesDto } from './dto/update-images.dto';
import { ListingSaveRepository } from './repositories/listing-save.repository';
import { categoryHasFloors } from './listings.constants';

@Injectable()
export class ListingsService {
  constructor(
    private readonly listings: ListingRepository,
    private readonly saves: ListingSaveRepository,
    private readonly geo: ListingsGeoService,
    private readonly outbox: OutBoxService,
    private readonly dataSource: DataSource,
  ) {}

  async create(ownerId: string, dto: CreateListingDto) {
    // Exactly one location shape: a drawn boundary (POLYGON) or a dropped
    // pin (PIN). Neither is a listing nobody can find; both is ambiguous.
    if (!dto.coordinates === !dto.point) {
      throw new BadRequestException(
        'Send exactly one of `coordinates` (boundary) or `point` (pin)',
      );
    }
    const geom = dto.coordinates
      ? await this.geo.toValidatedPolygon(dto.coordinates)
      : null;

    const listingId = await this.dataSource.transaction(async (manager) => {
      const listingRepo = manager.getRepository(Listing);
      const offerRepo = manager.getRepository(ListingOffer);

      const listing = await listingRepo.save(
        listingRepo.create({
          ownerId,
          category: dto.category,
          title: dto.title ?? null,
          descriptionHtml: dto.descriptionHtml ?? null,
          descriptionText: dto.descriptionHtml
            ? stripHtml(dto.descriptionHtml)
            : null,
          rooms: dto.rooms ?? null,
          // Derived, never client-supplied: the drawn boundary IS the area.
          // Computed from the geography column right below, in the same
          // transaction; stays null for listings posted without a polygon.
          areaM2: null,
          floor: dto.floor ?? null,
          totalFloors: dto.totalFloors ?? null,
          address: dto.address ?? null,
          landmark: dto.landmark ?? null,
          contactPhone: dto.contactPhone ?? null,
          geom,
          status: ListingStatus.ACTIVE,
          publishedAt: new Date(),
        }),
      );

      if (geom) {
        await manager.query(
          `UPDATE listings
           SET centroid = ST_Centroid(geom::geometry)::geography,
               area_m2  = ROUND(ST_Area(geom)::numeric, 1)
           WHERE id = $1`,
          [listing.id],
        );
      } else {
        // Pin: the point IS the location. No boundary, no derived area.
        await manager.query(
          `UPDATE listings
           SET centroid = ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
           WHERE id = $3`,
          [dto.point![0], dto.point![1], listing.id],
        );
      }

      await offerRepo.save(
        dto.offers.map((o) =>
          offerRepo.create({ ...o, listingId: listing.id }),
        ),
      );

      if (dto.images?.length) {
        const imageRepo = manager.getRepository(ListingImage);
        await imageRepo.save(
          dto.images.map((img, i) =>
            imageRepo.create({
              ...img,
              listingId: listing.id,
              isPrimary: dto.images!.some((x) => x.isPrimary)
                ? img.isPrimary
                : i === 0,
            }),
          ),
        );
      }

      await this.outbox.publish(
        'listing.published',
        { listingId: listing.id },
        manager,
      );

      return listing.id;
    });

    return this.findById(listingId);
  }

  async findById(id: string) {
    const listing = await this.listings.findWithRelations(id);
    if (!listing) throw new NotFoundException('Listing not found');
    return listing;
  }

  findMine(ownerId: string) {
    return this.listings.findMine(ownerId);
  }

  findFeed(dto: import('./dto/list-listings.dto').ListListingsDto) {
    return this.listings.findFeed({
      purpose: dto.purpose,
      category: dto.category,
      priceMin: dto.priceMin,
      priceMax: dto.priceMax,
      search: dto.q?.trim() || undefined,
      sort: dto.sort ?? 'newest',
      limit: Math.min(dto.limit ?? 20, 50),
      offset: dto.offset ?? 0,
    });
  }

  /** Clamped so a crafted limit cannot pull the whole table. */
  findLatest(limit: number) {
    return this.listings.findLatest(Math.min(Math.max(limit, 1), 30));
  }

  findPublicByOwner(ownerId: string) {
    return this.listings.findPublicByOwner(ownerId);
  }

  // ---- Saved listings ------------------------------------------------------

  /** 404s on a missing listing; saving an existing one twice is a no-op. */
  async saveListing(userId: string, listingId: string) {
    const exists = await this.listings.existsBy({ id: listingId });
    if (!exists) throw new NotFoundException('Listing not found');
    await this.saves.saveFor(userId, listingId);
    return { saved: true };
  }

  async unsaveListing(userId: string, listingId: string) {
    await this.saves.unsaveFor(userId, listingId);
    return { saved: false };
  }

  findSaved(userId: string) {
    return this.saves.findSavedFor(userId);
  }

  async update(listing: Listing, dto: UpdateListingDto) {
    const patch: Partial<Listing> = { ...dto };

    if (dto.descriptionHtml !== undefined) {
      patch.descriptionText = dto.descriptionHtml
        ? stripHtml(dto.descriptionHtml)
        : null;
    }

    applyFloors(listing, dto, patch);

    await this.listings.update(listing.id, patch);
    return this.findById(listing.id);
  }

  async updateImages(listing: Listing, dto: UpdateImagesDto) {
    await this.dataSource.transaction(async (manager) => {
      const imageRepo = manager.getRepository(ListingImage);

      const existing = await imageRepo.findBy({ listingId: listing.id });
      const keptUrls = new Set(dto.images.map((i) => i.url));
      const removed = existing
        .filter((img) => !keptUrls.has(img.url))
        .flatMap((img) => [img.url, img.thumbUrl]);

      await imageRepo.delete({ listingId: listing.id });
      await imageRepo.save(
        dto.images.map((img, i) =>
          imageRepo.create({
            ...img,
            listingId: listing.id,
            isPrimary: dto.images.some((x) => x.isPrimary)
              ? img.isPrimary
              : i === 0,
          }),
        ),
      );

      await this.outbox.publish(
        'listing.images_changed',
        { listingId: listing.id },
        manager,
      );

      if (removed.length) {
        await this.outbox.publish(
          'media.files_orphaned',
          { urls: removed },
          manager,
        );
      }
    });

    return this.findById(listing.id);
  }

  async updateOffers(listing: Listing, dto: UpdateOffersDto) {
    await this.dataSource.transaction(async (manager) => {
      const offerRepo = manager.getRepository(ListingOffer);
      await offerRepo.delete({ listingId: listing.id });
      await offerRepo.save(
        dto.offers.map((o) =>
          offerRepo.create({ ...o, listingId: listing.id }),
        ),
      );
      await this.outbox.publish(
        'listing.price_changed',
        { listingId: listing.id },
        manager,
      );
    });
    return this.findById(listing.id);
  }

  async updateGeometry(listing: Listing, dto: UpdateGeometryDto) {
    if (!dto.coordinates === !dto.point) {
      throw new BadRequestException(
        'Send exactly one of `coordinates` (boundary) or `point` (pin)',
      );
    }
    const geom = dto.coordinates
      ? await this.geo.toValidatedPolygon(dto.coordinates)
      : null;

    await this.dataSource.transaction(async (manager) => {
      if (geom) {
        await manager.query(
          `UPDATE listings
           SET geom     = ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)::geography,
               centroid = ST_Centroid(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326))::geography,
               -- The area follows the boundary, always — it is not editable.
               area_m2  = ROUND(ST_Area(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)::geography)::numeric, 1),
               updated_at = now()
           WHERE id = $2`,
          [JSON.stringify(geom), listing.id],
        );
      } else {
        // Switching to (or moving) a pin drops the boundary and its area.
        await manager.query(
          `UPDATE listings
           SET geom     = NULL,
               centroid = ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
               area_m2  = NULL,
               updated_at = now()
           WHERE id = $3`,
          [dto.point![0], dto.point![1], listing.id],
        );
      }

      await this.outbox.publish(
        'listing.geometry_changed',
        {
          listingId: listing.id,
        },
        manager,
      );
    });

    return this.findById(listing.id);
  }

  async archive(listing: Listing) {
    await this.dataSource.transaction(async (manager) => {
      await manager.update(Listing, listing.id, {
        status: ListingStatus.ARCHIVED,
      });
      await this.outbox.publish(
        'listing.archived',
        { listingId: listing.id },
        manager,
      );
    });

    return { success: true };
  }

  /**
   * The inverse of archive(): back to `ACTIVE`, and back onto the map.
   *
   * `listing.published` is the event to re-emit — the map-point projector
   * treats it as "rebuild this listing's point from scratch", and its INSERT
   * only fires for `ACTIVE` rows, which this transaction has committed by the
   * time the outbox relay dispatches.
   *
   * Caveat: archiving also deletes the image FILES from Bunny (see
   * DeleteListingImageListener) while keeping the `listing_images` rows, so a
   * restored listing comes back pointing at deleted files and needs its photos
   * re-uploaded. If archive is meant to be reversible, that listener is the
   * thing to reconsider.
   */
  async restore(listing: Listing) {
    // Idempotent: restoring a live listing is a no-op rather than an error, so
    // a double tap over a flaky connection cannot fail the second time.
    if (listing.status !== ListingStatus.ARCHIVED) {
      return this.findById(listing.id);
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.update(Listing, listing.id, {
        status: ListingStatus.ACTIVE,
      });
      await this.outbox.publish(
        'listing.published',
        { listingId: listing.id },
        manager,
      );
    });

    return this.findById(listing.id);
  }

  async getSummaries(listingIds: string[]) {
    if (listingIds.length === 0) return [];

    return this.listings.find({
      where: listingIds.map((id) => ({ id })),
      select: { id: true, ownerId: true, title: true, status: true },
    });
  }
}

/**
 * Resolves the floors half of a patch against the row already in the database.
 *
 * Two things the DTO cannot see on a partial update:
 *
 *  - the category may not be in the body, so `@FloorAllowedForCategory` waves
 *    the values through. Re-checked here against the effective category — and
 *    when the category itself is being *moved* out of the floor-capable set
 *    (a `BUILDING` refiled as a `HOUSE`), the stored floors are cleared rather
 *    than rejected: they are no longer wrong input, just stale data.
 *  - `floor` may arrive alone, to be compared against a stored `totalFloors`.
 */
function applyFloors(
  listing: Listing,
  dto: UpdateListingDto,
  patch: Partial<Listing>,
): void {
  const category = dto.category ?? listing.category;

  if (!categoryHasFloors(category)) {
    patch.floor = null;
    patch.totalFloors = null;
    return;
  }

  const floor = patch.floor ?? listing.floor;
  const totalFloors = patch.totalFloors ?? listing.totalFloors;

  if (floor != null && totalFloors != null && floor > totalFloors) {
    throw new BadRequestException('floor cannot be above totalFloors');
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
