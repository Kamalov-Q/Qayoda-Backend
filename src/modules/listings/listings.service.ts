import { Injectable, NotFoundException } from '@nestjs/common';
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

@Injectable()
export class ListingsService {
  constructor(
    private readonly listings: ListingRepository,
    private readonly geo: ListingsGeoService,
    private readonly outbox: OutBoxService,
    private readonly dataSource: DataSource,
  ) {}

  async create(ownerId: string, dto: CreateListingDto) {
    const geomLiteral = await this.geo.toGeographyLiteral(dto.coordinates);

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
          areaM2: dto.areaM2 ?? null,
          floor: dto.floor ?? null,
          totalFloors: dto.totalFloors ?? null,
          address: dto.address ?? null,
          contactPhone: dto.contactPhone ?? null,
          geom: geomLiteral,
          status: ListingStatus.ACTIVE,
          publishedAt: new Date(),
        }),
      );

      await manager.query(
        `UPDATE listings SET centroid = ST_Centroid(geom::geometry)::geography WHERE id = $1`,
        [listing.id],
      );

      await offerRepo.save(
        dto.offers.map((o) =>
          offerRepo.create({ ...o, listingId: listing.id }),
        ),
      );

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

  async update(listing: Listing, dto: UpdateListingDto) {
    const patch: Partial<Listing> = { ...dto };

    if (dto.descriptionHtml !== undefined) {
      patch.descriptionText = dto.descriptionHtml
        ? stripHtml(dto.descriptionHtml)
        : null;
    }

    await this.listings.update(listing.id, patch);
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
    const geomLiteral = await this.geo.toGeographyLiteral(dto.coordinates);

    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `UPDATE listings
         SET geom = $1, centroid = ST_Centroid($1::geometry)::geography, updated_at = now()
         WHERE id = $2`,
        [geomLiteral, listing.id],
      );

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
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
