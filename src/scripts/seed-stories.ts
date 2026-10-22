/**
 * Thirty stories, for a tray that has nothing in it.
 *
 *   npm run seed:stories                      # spreads them over existing users
 *   npm run seed:stories -- --count 12
 *   npm run seed:stories -- --author +998901234567
 *   npm run seed:stories -- --clear           # removes seeded ones and stops
 *
 * Safe to re-run: every row it writes is tagged (see SEED_TAG), so a second
 * run counts what is already there and tops up to `--count` rather than
 * doubling it. `--clear` takes them all away again.
 *
 * Written straight through the repository rather than StoriesService, which
 * is the opposite of what seed:listings does — and for a reason. Posting a
 * story CHARGES the author's wallet for the STORY_POST tariff, so seeding
 * thirty of them through the service would either drain two test accounts or
 * stop on INSUFFICIENT_FUNDS half way. Nothing else in that method is load
 * bearing here: it emits no events, and the one rule worth keeping — at most
 * MAX_LIVE stories live per author — is enforced below instead.
 *
 * Photos are hotlinked from Unsplash and the clips from test-videos.co.uk,
 * the same bet seed:listings makes: real pictures of real rooms say more
 * about how the app looks with content in it than grey placeholders do.
 */
import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { In, LessThan, MoreThan, Repository } from 'typeorm';
import { AppModule } from '../app.module';
import { User } from '../modules/users/entities/user.entity';
import { Story, type StoryType } from '../modules/stories/story.entity';

/**
 * Mirrors MAX_LIVE_PER_AUTHOR in StoriesService.
 *
 * Not imported, because that constant is private to the module and a seed
 * has no business widening its exports. Kept in step by hand: if the service
 * ever allows more, this only means the seed spreads wider than it has to.
 */
const MAX_LIVE = 20;

/**
 * How a seeded story is recognised later.
 *
 * Appended to the body, which every seeded story has — including the photo
 * ones, where it rides as a caption. A dedicated column would be cleaner and
 * would also mean a migration to carry demo data, which is worse.
 */
const SEED_TAG = '​'; // zero-width space: invisible in the app, greppable in SQL

const photo = (id: string) => ({
  mediaUrl: `https://images.unsplash.com/${id}?w=1400&q=80`,
  thumbUrl: `https://images.unsplash.com/${id}?w=360&q=70`,
  width: 1400,
  height: 2100,
});

/** Verified reachable; see the videos tab, which uses the same three. */
const clip = (name: string, n: string) => ({
  mediaUrl: `https://test-videos.co.uk/vids/${name}/mp4/h264/720/${n}_720_10s_1MB.mp4`,
  thumbUrl: null,
  width: 1280,
  height: 720,
});

type Seed = {
  type: StoryType;
  body: string;
  background?: number;
  mediaUrl?: string | null;
  thumbUrl?: string | null;
  width?: number | null;
  height?: number | null;
  durationSec?: number | null;
};

const IMAGES = [
  'photo-1502672260266-1c1ef2d93688',
  'photo-1560448204-e02f11c3d0e2',
  'photo-1560185007-cde436f6a4d0',
  'photo-1568605114967-8130f3a36994',
  'photo-1570129477492-45c003edd2be',
  'photo-1583608205776-bfd35f0d9f83',
  'photo-1522708323590-d24dbb6b0267',
  'photo-1600607687939-ce8a6c25118c',
  'photo-1600566753086-00f18fb6b3ea',
  'photo-1497366216548-37526070297c',
  'photo-1566073771259-6a8506099945',
  'photo-1441986300917-64674bd600d8',
  'photo-1512917774080-9991f1c4c750',
  'photo-1493809842364-78817add7ffb',
  'photo-1484154218962-a197022b5858',
  'photo-1586023492125-27b2c045efd7',
  'photo-1484101403633-562f891dc89a',
  'photo-1505691938895-1758d7feb511',
];

/** Captions, in the register a realtor actually posts in. */
const CAPTIONS = [
  'Chilonzor 9-kvartal, 3 xonali — bugun ko‘rsatamiz',
  'Yangi bino, 2/9/9 — kalit topshirildi',
  'Yunusobod 12-kvartal, remont tugadi',
  'Mirzo Ulug‘bek, hovli uy — 6 sotix',
  'Sergeli, yangi qurilish — narx kelishiladi',
  'Shayxontohur, 2 xonali — tez sotiladi',
  'Olmazor tumani, 4 xonali kvartira',
  'Yakkasaroy, biznes uchun ofis',
  'Uchtepa, 3 sotix — hujjatlar tayyor',
  'Bektemir, yangi ta’mirdan chiqqan',
  'Mirobod, markazda — metroga yaqin',
  'Qibray, bog‘ bilan — 8 sotix',
  'Yashnobod, 2/5/5 — o‘rta holatda',
  'Chilonzor, kunlik ijaraga',
  'Yangihayot, oilaviy uy',
  'Zangiota, yer uchastkasi',
  'Toshkent markazi, yevroremont',
  'Mirzo Ulug‘bek, ofis — 120 m²',
];

const TEXT_STORIES = [
  'Bugun 3 ta yangi e’lon qo‘shildi',
  'Narxlar yangilandi — ko‘rib chiqing',
  'Dam olish kunlari ham ishlaymiz',
  'Ipoteka bo‘yicha maslahat bepul',
  'Yangi bino — to‘g‘ridan-to‘g‘ri quruvchidan',
  'Hujjatlar bilan to‘liq yordam beramiz',
];

const CLIPS = [
  clip('bigbuckbunny', 'Big_Buck_Bunny'),
  clip('sintel', 'Sintel'),
  clip('jellyfish', 'Jellyfish'),
];

/** The pool the seed draws from, in a deliberate mix of the three types. */
function buildPool(): Seed[] {
  const pool: Seed[] = [];

  IMAGES.forEach((id, i) => {
    pool.push({ type: 'IMAGE', body: CAPTIONS[i % CAPTIONS.length], ...photo(id) });
  });

  TEXT_STORIES.forEach((body, i) => {
    pool.push({ type: 'TEXT', body, background: i % 6 });
  });

  CLIPS.forEach((c, i) => {
    pool.push({
      type: 'VIDEO',
      body: CAPTIONS[(i + 3) % CAPTIONS.length],
      durationSec: 10,
      ...c,
    });
  });

  return pool;
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? (argv[i + 1] ?? null) : null;
  };
  const clear = argv.includes('--clear');
  const wanted = Number(flag('--count') ?? 30);
  const authorPhone = flag('--author');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const users = app.get<Repository<User>>(getRepositoryToken(User));
    const stories = app.get<Repository<Story>>(getRepositoryToken(Story));

    if (clear) {
      const { affected } = await stories
        .createQueryBuilder()
        .delete()
        .where('body LIKE :tag', { tag: `%${SEED_TAG}%` })
        .execute();
      console.log(`Removed ${affected ?? 0} seeded story(s).`);
      return;
    }

    // Authors: the given phone, or every real account in turn — a tray where
    // every ring is the same person is a demo of one person.
    const authors = authorPhone
      ? await users.find({
          where: { phoneNumber: `+${authorPhone.replace(/\D/g, '')}` },
        })
      : await users.find({ take: 20, order: { createdAt: 'ASC' } });

    if (!authors.length) {
      console.error(
        authorPhone
          ? `No account with phone ${authorPhone}.`
          : 'No users in the database — sign up once in the app first.',
      );
      process.exitCode = 1;
      return;
    }

    // What each author is already carrying, seeded or not: the service caps
    // live stories per author and a seed that ignored that would put the
    // database in a state the app itself would refuse to create.
    const live = await stories.find({
      where: { authorId: In(authors.map((a) => a.id)), expiresAt: MoreThan(new Date()) },
      select: { id: true, authorId: true, body: true },
    });

    const liveByAuthor = new Map<string, number>();
    for (const s of live) {
      liveByAuthor.set(s.authorId, (liveByAuthor.get(s.authorId) ?? 0) + 1);
    }
    const alreadySeeded = live.filter((s) => s.body?.includes(SEED_TAG)).length;

    const room = authors.reduce(
      (sum, a) => sum + Math.max(0, MAX_LIVE - (liveByAuthor.get(a.id) ?? 0)),
      0,
    );
    const target = Math.max(0, Math.min(wanted - alreadySeeded, room));

    if (!target) {
      console.log(
        alreadySeeded >= wanted
          ? `Already ${alreadySeeded} seeded story(s) up — nothing to do.`
          : `No room: ${authors.length} author(s) are at the ${MAX_LIVE}-story cap.`,
      );
      return;
    }

    const pool = buildPool();
    const rows: Story[] = [];

    for (let i = 0; rows.length < target; i++) {
      // Round robin, skipping anyone already at the cap.
      const author = authors[i % authors.length];
      const held = liveByAuthor.get(author.id) ?? 0;
      if (held >= MAX_LIVE) continue;
      liveByAuthor.set(author.id, held + 1);

      const seed = pool[rows.length % pool.length];
      // Staggered so the tray has an order to it and the rings do not all
      // expire in the same minute.
      const ageMin = rows.length * 7;
      const hours = [6, 12, 24, 48][rows.length % 4];

      rows.push(
        stories.create({
          authorId: author.id,
          type: seed.type,
          mediaUrl: seed.mediaUrl ?? null,
          thumbUrl: seed.thumbUrl ?? null,
          width: seed.width ?? null,
          height: seed.height ?? null,
          durationSec: seed.durationSec ?? null,
          body: `${seed.body}${SEED_TAG}`,
          background: seed.background ?? 0,
          listingId: null,
          viewCount: Math.floor(Math.random() * 90),
          reactionCount: Math.floor(Math.random() * 12),
          createdAt: new Date(Date.now() - ageMin * 60_000),
          expiresAt: new Date(Date.now() + hours * 3_600_000),
        }),
      );
    }

    await stories.save(rows, { chunk: 50 });

    const perAuthor = new Map<string, number>();
    for (const r of rows) {
      perAuthor.set(r.authorId, (perAuthor.get(r.authorId) ?? 0) + 1);
    }
    for (const a of authors) {
      const n = perAuthor.get(a.id);
      if (n) console.log(`+ ${n} story(s) for ${a.name ?? a.phoneNumber}`);
    }
    console.log(`Done: ${rows.length} story(s) created.`);
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
