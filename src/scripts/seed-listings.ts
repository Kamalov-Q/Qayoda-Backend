/**
 * Ten believable Tashkent listings, for a database that has nothing to look at.
 *
 *   npm run seed:listings                  # spreads them over existing users
 *   npm run seed:listings -- --owner +998901234567
 *
 * Created through ListingsService, not SQL: that is what validates the
 * category, derives the area from a drawn boundary, normalises prices to USD
 * and publishes the event that puts a listing on the map. Seed rows written
 * behind its back would be invisible to the map and wrong in the feed.
 *
 * Photos are hotlinked from Unsplash. They are real photographs of real
 * rooms, which is the point — a seed full of grey placeholders tells you
 * nothing about how the app looks with content in it.
 */
import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppModule } from '../app.module';
import { User } from '../modules/users/entities/user.entity';
import { ListingsService } from '../modules/listings/listings.service';
import { CategoriesService } from '../modules/categories/categories.service';
import { CreateListingDto } from '../modules/listings/dto/create-listing.dto';
import { OfferPurpose } from '../modules/listings/enums/offer-purpose.enum';

/** A square boundary around a point, roughly `metres` across — what a drawn plot looks like. */
function plot(lng: number, lat: number, metres: number): [number, number][][] {
  const dLat = metres / 111_320;
  const dLng = metres / (111_320 * Math.cos((lat * Math.PI) / 180));
  return [
    [
      [lng - dLng / 2, lat - dLat / 2],
      [lng + dLng / 2, lat - dLat / 2],
      [lng + dLng / 2, lat + dLat / 2],
      [lng - dLng / 2, lat + dLat / 2],
      [lng - dLng / 2, lat - dLat / 2], // closed ring
    ],
  ];
}

const photo = (id: string, i: number) => ({
  url: `https://images.unsplash.com/${id}?w=1600&q=80`,
  thumbUrl: `https://images.unsplash.com/${id}?w=480&q=70`,
  width: 1600,
  height: 1067,
  position: i,
  isPrimary: i === 0,
});

const IMAGES = {
  flat: ['photo-1502672260266-1c1ef2d93688', 'photo-1560448204-e02f11c3d0e2', 'photo-1560185007-cde436f6a4d0'],
  house: ['photo-1568605114967-8130f3a36994', 'photo-1570129477492-45c003edd2be', 'photo-1583608205776-bfd35f0d9f83'],
  land: ['photo-1500382017468-9049fed747ef', 'photo-1464822759023-fed622ff2c3b'],
  office: ['photo-1497366216548-37526070297c', 'photo-1497366811353-6870744d04b2'],
  hotel: ['photo-1566073771259-6a8506099945', 'photo-1618773928121-c32242e63f39'],
  shop: ['photo-1441986300917-64674bd600d8', 'photo-1604719312566-8912e9227c6a'],
};

/** Real districts and streets; coordinates are the actual neighbourhoods. */
const LISTINGS: (Omit<CreateListingDto, 'images'> & { images: string[] })[] = [
  {
    category: 'APARTMENT',
    title: '3 xonali kvartira, Chilonzor 9-kvartal',
    descriptionHtml:
      '<p>Chilonzor 9-kvartalda, metroga 7 daqiqa. Yevro ta\'mir, ikkita konditsioner, oshxona mebeli qoladi. Uy oldida maktab va bog\'cha, hovlida avtoturargoh.</p>',
    rooms: 3,
    floor: 4,
    totalFloors: 9,
    areaM2: 72,
    address: "Toshkent, Chilonzor tumani, Chilonzor 9-kvartal, Qatortol ko'chasi 24",
    properties: ['REPAIRED', 'FURNISHED', 'AC', 'ELEVATOR', 'PARKING'],
    contactPhone: '+998901234501',
    point: [69.2035, 41.2756],
    offers: [{ purpose: OfferPurpose.SALE, price: 78000, currency: 'USD' }],
    images: IMAGES.flat,
  },
  {
    category: 'APARTMENT',
    title: '2 xonali kvartira, Yunusobod 4-mavze',
    descriptionHtml:
      '<p>Yunusobod 4-mavzeda yangi binoda ijaraga beriladi. Mebel va texnika to\'liq, internet ulangan. Kommunal to\'lovlar alohida.</p>',
    rooms: 2,
    floor: 7,
    totalFloors: 12,
    areaM2: 58,
    address: "Toshkent, Yunusobod tumani, 4-mavze, Amir Temur shoh ko'chasi 108",
    properties: ['FURNISHED', 'AC', 'INTERNET', 'ELEVATOR', 'SECURITY'],
    contactPhone: '+998901234502',
    point: [69.2891, 41.3625],
    offers: [{ purpose: OfferPurpose.RENT_MONTHLY, price: 5500000, currency: 'UZS' }],
    images: IMAGES.flat,
  },
  {
    category: 'HOUSE',
    title: "Hovli uy, Qibray, 6 sotix",
    descriptionHtml:
      '<p>Qibrayda 6 sotix yer, ikki qavatli uy. Mevali daraxtlar, tok, alohida garaj. Gaz, svet, suv doimiy. Hujjatlari tayyor.</p>',
    rooms: 5,
    areaM2: 180,
    address: "Toshkent viloyati, Qibray tumani, Salar ko'chasi 15",
    properties: ['GARDEN', 'GARAGE', 'HEATING', 'PARKING'],
    contactPhone: '+998901234503',
    coordinates: plot(69.3762, 41.3889, 25),
    offers: [{ purpose: OfferPurpose.SALE, price: 1450000000, currency: 'UZS' }],
    images: IMAGES.house,
  },
  {
    category: 'APARTMENT',
    title: '1 xonali kvartira, Mirzo Ulug\'bek, kunlik',
    descriptionHtml:
      '<p>Kunlik ijaraga. Toza, yangi ta\'mirlangan, hammasi bor: konditsioner, kir yuvish mashinasi, Wi-Fi. Metro Buyuk Ipak Yo\'li yonida.</p>',
    rooms: 1,
    floor: 3,
    totalFloors: 5,
    areaM2: 36,
    address: "Toshkent, Mirzo Ulug'bek tumani, Buyuk Ipak Yo'li 45",
    properties: ['REPAIRED', 'FURNISHED', 'AC', 'INTERNET'],
    contactPhone: '+998901234504',
    point: [69.3401, 41.3255],
    offers: [{ purpose: OfferPurpose.RENT_DAILY, price: 35, currency: 'USD' }],
    images: IMAGES.flat,
  },
  {
    category: 'NON_RESIDENTIAL',
    title: "Ofis, Mustaqillik maydoni yaqinida, 120 m²",
    descriptionHtml:
      '<p>Biznes markazda ofis. Ochiq planirovka, 12 ta ish o\'rni, yig\'ilish xonasi. Konditsioner, tezkor internet, qo\'riqlanadigan avtoturargoh.</p>',
    rooms: 4,
    floor: 5,
    totalFloors: 8,
    areaM2: 120,
    address: "Toshkent, Shayxontohur tumani, Islom Karimov ko'chasi 12",
    properties: ['REPAIRED', 'AC', 'INTERNET', 'SECURITY', 'PARKING', 'ELEVATOR'],
    contactPhone: '+998901234505',
    point: [69.2685, 41.3111],
    offers: [{ purpose: OfferPurpose.RENT_MONTHLY, price: 1200, currency: 'USD' }],
    images: IMAGES.office,
  },
  {
    category: 'LAND',
    title: "Yer uchastkasi, Zangiota, 10 sotix",
    descriptionHtml:
      '<p>Zangiota tumanida 10 sotix yer. Qurilishga tayyor, yo\'l asfalt, elektr va gaz chegarada. Toshkentga 25 daqiqa.</p>',
    address: 'Toshkent viloyati, Zangiota tumani, Qorasuv',
    properties: [],
    contactPhone: '+998901234506',
    coordinates: plot(69.1428, 41.2103, 32),
    offers: [{ purpose: OfferPurpose.SALE, price: 42000, currency: 'USD' }],
    images: IMAGES.land,
  },
  {
    category: 'HOTEL',
    title: "Mini mehmonxona, Sergeli, 8 xona",
    descriptionHtml:
      '<p>Ishlab turgan mini mehmonxona sotiladi. 8 ta xona, hammasi ta\'mirlangan va mebellangan. Doimiy mijozlar bazasi bor.</p>',
    rooms: 8,
    floor: 1,
    totalFloors: 3,
    areaM2: 340,
    address: "Toshkent, Sergeli tumani, Yangi Sergeli ko'chasi 7",
    properties: ['REPAIRED', 'FURNISHED', 'AC', 'PARKING', 'SECURITY'],
    contactPhone: '+998901234507',
    point: [69.2224, 41.2237],
    offers: [{ purpose: OfferPurpose.SALE, price: 6200000000, currency: 'UZS' }],
    images: IMAGES.hotel,
  },
  {
    category: 'NON_RESIDENTIAL',
    title: "Do'kon, Olmazor bozori yonida, 45 m²",
    descriptionHtml:
      '<p>Bozor yonida savdo do\'koni. Vitrina oynalari, sklad xonasi, alohida kirish. Oziq-ovqat yoki kiyim savdosi uchun qulay.</p>',
    floor: 1,
    totalFloors: 2,
    areaM2: 45,
    address: "Toshkent, Olmazor tumani, Do'stlik ko'chasi 3",
    properties: ['AC', 'SECURITY'],
    contactPhone: '+998901234508',
    point: [69.2043, 41.3486],
    offers: [{ purpose: OfferPurpose.RENT_MONTHLY, price: 7000000, currency: 'UZS' }],
    images: IMAGES.shop,
  },
  {
    category: 'DACHA',
    title: "Dacha, Chimyon yo'lida, basseyn bilan",
    descriptionHtml:
      '<p>Chimyon yo\'lida dacha. Basseyn, tandir, soyabon, mevali bog\'. Dam olish kunlari uchun ijaraga ham beriladi.</p>',
    rooms: 4,
    areaM2: 150,
    address: "Toshkent viloyati, Bo'stonliq tumani, Chimyon yo'li 12-km",
    properties: ['POOL', 'GARDEN', 'PARKING', 'HEATING'],
    contactPhone: '+998901234509',
    coordinates: plot(70.0102, 41.5426, 28),
    offers: [{ purpose: OfferPurpose.RENT_DAILY, price: 1800000, currency: 'UZS' }],
    images: IMAGES.house,
  },
  {
    category: 'APARTMENT',
    title: "4 xonali kvartira, Yakkasaroy, Oybek metrosi",
    descriptionHtml:
      '<p>Yakkasaroyda keng 4 xonali kvartira. Oybek metrosiga 5 daqiqa piyoda. Ikki balkon, alohida oshxona, yangi lift.</p>',
    rooms: 4,
    floor: 6,
    totalFloors: 9,
    areaM2: 96,
    address: "Toshkent, Yakkasaroy tumani, Shota Rustaveli ko'chasi 58",
    properties: ['REPAIRED', 'BALCONY', 'ELEVATOR', 'AC', 'PARKING'],
    contactPhone: '+998901234510',
    point: [69.2529, 41.2896],
    offers: [{ purpose: OfferPurpose.SALE, price: 112000, currency: 'USD' }],
    images: IMAGES.flat,
  },
];

async function main() {
  const wanted = process.argv.slice(2);
  const ownerFlag = wanted.indexOf('--owner');
  const ownerPhone = ownerFlag >= 0 ? wanted[ownerFlag + 1] : null;

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const users = app.get<Repository<User>>(getRepositoryToken(User));
    const listings = app.get(ListingsService, { strict: false });
    const categories = app.get(CategoriesService, { strict: false });

    // Owners: the given phone, or every real account in turn — listings all
    // owned by one person make the app look like a demo of one person.
    const owners = ownerPhone
      ? await users.find({
          where: { phoneNumber: `+${ownerPhone.replace(/\D/g, '')}` },
        })
      : await users.find({ take: 5, order: { createdAt: 'ASC' } });

    if (!owners.length) {
      console.error(
        ownerPhone
          ? `No account with phone ${ownerPhone}.`
          : 'No users yet — sign in on the app once, then run this again.',
      );
      process.exitCode = 1;
      return;
    }

    // Categories are admin-managed: skip anything the database no longer has
    // rather than failing the whole run.
    const live = new Set((await categories.listPublic()).map((c) => c.slug));

    let created = 0;
    for (const [i, seed] of LISTINGS.entries()) {
      if (!live.has(seed.category)) {
        console.warn(`- skipped "${seed.title}": category ${seed.category} is not active`);
        continue;
      }
      const owner = owners[i % owners.length];
      const { images, ...rest } = seed;
      await listings.create(owner.id, {
        ...rest,
        images: images.map((id, n) => photo(id, n)),
      });
      created++;
      console.log(`+ ${seed.title}  (${owner.name ?? owner.phoneNumber})`);
    }

    // The map projection runs off the outbox relay, which polls once a second.
    // Closing immediately would leave these listings off the map until the
    // next server restart picks the events up.
    console.log('Waiting for the map projection…');
    await new Promise((r) => setTimeout(r, 4000));
    console.log(`Done: ${created} listing(s).`);
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
