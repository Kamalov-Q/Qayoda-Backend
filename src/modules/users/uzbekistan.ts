// Generated from MIMAXUZ/uzbekistan-regions-data (JSON/regions.json and
// JSON/districts.json), which carries the official SOATO classifier codes.
// Do not hand-edit — regenerate from the source.
//
// SOATO is the state's own code, so it is what a profile stores: a label can
// be respelled or transliterated differently without orphaning the rows that
// chose it. A district's code nests under its region's (1703202 sits under
// 1703), which is why ONE stored code is enough to know both.
//
// One source row is excluded: "Toshkent shahrining tumanlari" (a grouping
// header with no Russian name, not a place anybody lives in).

export interface UzDistrict {
  /** SOATO, as a string — these are identifiers, never arithmetic. */
  code: string;
  uz: string;
  ru: string;
}

export interface UzRegion extends UzDistrict {
  districts: readonly UzDistrict[];
}

export const UZ_REGIONS: readonly UzRegion[] = [
  {
    code: '1726',
    uz: 'Toshkent shahri',
    ru: 'город Ташкент',
    districts: [
      { code: '1726264', uz: 'Bektemir tumani', ru: 'Бектемирский район' },
      { code: '1726294', uz: 'Chilonzor tumani', ru: 'Чиланзарский район' },
      { code: '1726273', uz: 'Mirobod tumani', ru: 'Мирабадский район' },
      { code: '1726269', uz: 'Mirzo Ulug\'bek tumani', ru: 'Мирзо-Улугбекский район' },
      { code: '1726280', uz: 'Olmazor tumani', ru: 'Алмазарский район' },
      { code: '1726277', uz: 'Shayxontohur tumani', ru: 'Шайхантахурский район' },
      { code: '1726283', uz: 'Sirg\'ali tumani', ru: 'Сергелийский район' },
      { code: '1726262', uz: 'Uchtepa tumani', ru: 'Учтепинский район' },
      { code: '1726287', uz: 'Yakkasaroy tumani', ru: 'Яккасарайский район' },
      { code: '1726292', uz: 'Yangihayot tumani', ru: 'Янгихаётский район' },
      { code: '1726290', uz: 'Yashnobod tumani', ru: 'Яшнабадский район' },
      { code: '1726266', uz: 'Yunusobod tumani', ru: 'Юнусабадский район' },
    ],
  },
  {
    code: '1703',
    uz: 'Andijon viloyati',
    ru: 'Андижанская область',
    districts: [
      { code: '1703401', uz: 'Andijon', ru: 'Андижан' },
      { code: '1703203', uz: 'Andijon tumani', ru: 'Андижанский район' },
      { code: '1703224', uz: 'Asaka tumani', ru: 'Асакинский район' },
      { code: '1703206', uz: 'Baliqchi tumani', ru: 'Балыкчинский район' },
      { code: '1703209', uz: 'Bo\'z tumani', ru: 'Бозский район' },
      { code: '1703210', uz: 'Buloqboshi tumani', ru: 'Булакбашинский район' },
      { code: '1703214', uz: 'Izboskan tumani', ru: 'Избасканский район' },
      { code: '1703211', uz: 'Jalaquduq tumani', ru: 'Джалалкудукский район' },
      { code: '1703227', uz: 'Marxamat tumani', ru: 'Мархаматский район' },
      { code: '1703202', uz: 'Oltinko\'l tumani', ru: 'Алтынкульский район' },
      { code: '1703232', uz: 'Paxtaobod tumani', ru: 'Пахтаабадский район' },
      { code: '1703220', uz: 'Qo\'rg\'ontepa tumani', ru: 'Кургантепинский район' },
      { code: '1703230', uz: 'Shahrixon tumani', ru: 'Шахриханский район' },
      { code: '1703217', uz: 'Ulug\'nor tumani', ru: 'Улугноpский район' },
      { code: '1703236', uz: 'Xo\'jaobod tumani', ru: 'Ходжаабадский район' },
      { code: '1703408', uz: 'Xonobod', ru: 'Ханабад' },
    ],
  },
  {
    code: '1706',
    uz: 'Buxoro viloyati',
    ru: 'Бухарская область',
    districts: [
      { code: '1706401', uz: 'Buxoro', ru: 'Бухара' },
      { code: '1706207', uz: 'Buxoro tumani', ru: 'Бухарский район' },
      { code: '1706215', uz: 'G\'ijduvon tumani', ru: 'Гиждуванский район' },
      { code: '1706246', uz: 'Jondor tumani', ru: 'Жандарский район' },
      { code: '1706403', uz: 'Kogon', ru: 'Каган' },
      { code: '1706219', uz: 'Kogon tumani', ru: 'Каганский район' },
      { code: '1706204', uz: 'Olot tumani', ru: 'Алатский район' },
      { code: '1706240', uz: 'Peshku tumani', ru: 'Пешкунский район' },
      { code: '1706230', uz: 'Qorako\'l tumani', ru: 'Каракульский район' },
      { code: '1706232', uz: 'Qorovulbozor tumani', ru: 'Караулбазарский район' },
      { code: '1706242', uz: 'Romitan tumani', ru: 'Ромитанский район' },
      { code: '1706258', uz: 'Shofirkon tumani', ru: 'Шафирканский район' },
      { code: '1706212', uz: 'Vobkent tumani', ru: 'Вабкентский район' },
    ],
  },
  {
    code: '1730',
    uz: 'Farg\'ona viloyati',
    ru: 'Ферганская область',
    districts: [
      { code: '1730215', uz: 'Beshariq tumani', ru: 'Бешарыкский район' },
      { code: '1730209', uz: 'Bog\'dod tumani', ru: 'Багдадский район' },
      { code: '1730212', uz: 'Buvayda tumani', ru: 'Бувайдинский район' },
      { code: '1730236', uz: 'Dang\'ara tumani', ru: 'Дангаринский район' },
      { code: '1730401', uz: 'Farg\'ona', ru: 'Фергана' },
      { code: '1730233', uz: 'Farg\'ona tumani', ru: 'Ферганский район' },
      { code: '1730238', uz: 'Furqat tumani', ru: 'Фуркатский район' },
      { code: '1730412', uz: 'Marg\'ilon', ru: 'Маpгилан' },
      { code: '1730230', uz: 'O\'zbekiston tumani', ru: 'Узбекистанский район' },
      { code: '1730203', uz: 'Oltiariq tumani', ru: 'Алтыарыкский район' },
      { code: '1730405', uz: 'Qo\'qon', ru: 'Коканд' },
      { code: '1730206', uz: 'Qo\'shtepa tumani', ru: 'Куштепинский район' },
      { code: '1730218', uz: 'Quva tumani', ru: 'Кувинский район' },
      { code: '1730408', uz: 'Quvasoy', ru: 'Кувасай' },
      { code: '1730224', uz: 'Rishton tumani', ru: 'Риштанский район' },
      { code: '1730226', uz: 'So\'x tumani', ru: 'Сохский район' },
      { code: '1730227', uz: 'Toshloq tumani', ru: 'Ташлакский район' },
      { code: '1730221', uz: 'Uchko\'prik tumani', ru: 'Учкуприкский район' },
      { code: '1730242', uz: 'Yozyovon tumani', ru: 'Язъяванский район' },
    ],
  },
  {
    code: '1708',
    uz: 'Jizzax viloyati',
    ru: 'Джизакская область',
    districts: [
      { code: '1708201', uz: 'Arnasoy tumani', ru: 'Арнасайский район' },
      { code: '1708204', uz: 'Baxmal tumani', ru: 'Бахмальский район' },
      { code: '1708215', uz: 'Do\'stlik tumani', ru: 'Дустликский район' },
      { code: '1708235', uz: 'Forish tumani', ru: 'Фаришский район' },
      { code: '1708209', uz: 'G\'allaorol tumani', ru: 'Галляаральский район' },
      { code: '1708401', uz: 'Jizzax', ru: 'Джизак' },
      { code: '1708223', uz: 'Mirzacho\'l tumani', ru: 'Мирзачульский район' },
      { code: '1708228', uz: 'Paxtakor tumani', ru: 'Пахтакорский район' },
      { code: '1708212', uz: 'Sh.Rashidov tumani', ru: 'Ш.Рашидовский район' },
      { code: '1708237', uz: 'Yangiobod tumani', ru: 'Янгиабадский район' },
      { code: '1708225', uz: 'Zafarobod tumani', ru: 'Зафарабадский район' },
      { code: '1708220', uz: 'Zarbdor tumani', ru: 'Зарбдарский район' },
      { code: '1708218', uz: 'Zomin tumani', ru: 'Зааминский район' },
    ],
  },
  {
    code: '1714',
    uz: 'Namangan viloyati',
    ru: 'Наманганская область',
    districts: [
      { code: '1714236', uz: 'Chortoq tumani', ru: 'Чартакский район' },
      { code: '1714237', uz: 'Chust tumani', ru: 'Чустский район' },
      { code: '1714401365', uz: 'Davlatobod tumani', ru: 'Давлатабадский район' },
      { code: '1714207', uz: 'Kosonsoy tumani', ru: 'Касансайский район' },
      { code: '1714204', uz: 'Mingbuloq tumani', ru: 'Мингбулакский pайон' },
      { code: '1714401', uz: 'Namangan', ru: 'Наманган' },
      { code: '1714212', uz: 'Namangan tumani', ru: 'Наманганский район' },
      { code: '1714216', uz: 'Norin tumani', ru: 'Нарынский район' },
      { code: '1714219', uz: 'Pop tumani', ru: 'Папский район' },
      { code: '1714224', uz: 'To\'raqo\'rg\'on tumani', ru: 'Туракурганский район' },
      { code: '1714234', uz: 'Uchqo\'rg\'on tumani', ru: 'Учкурганский район' },
      { code: '1714229', uz: 'Uychi tumani', ru: 'Уйчинский район' },
      { code: '1714401367', uz: 'Yangi Namangan tumani', ru: 'Янги Наманганский район' },
      { code: '1714242', uz: 'Yangiqo\'rg\'on tumani', ru: 'Янгикурганский район' },
    ],
  },
  {
    code: '1712',
    uz: 'Navoiy viloyati',
    ru: 'Навоийская область',
    districts: [
      { code: '1712412', uz: 'G‘ozg‘on tumani', ru: 'Газганский район' },
      { code: '1712234', uz: 'Karmana tumani', ru: 'Карманинский район' },
      { code: '1712211', uz: 'Konimex tumani', ru: 'Канимехский район' },
      { code: '1712230', uz: 'Navbahor tumani', ru: 'Навбахорский район' },
      { code: '1712401', uz: 'Navoiy', ru: 'Навои' },
      { code: '1712238', uz: 'Nurota tumani', ru: 'Нуратинский район' },
      { code: '1712216', uz: 'Qiziltepa tumani', ru: 'Кызылтепинский район' },
      { code: '1712244', uz: 'Tomdi tumani', ru: 'Тамдынский район' },
      { code: '1712248', uz: 'Uchquduq tumani', ru: 'Учкудукский район' },
      { code: '1712251', uz: 'Xatirchi tumani', ru: 'Хатырчинский район' },
      { code: '1712408', uz: 'Zarafshon', ru: 'Заpафшан' },
    ],
  },
  {
    code: '1710',
    uz: 'Qashqadaryo viloyati',
    ru: 'Кашкадарьинская область',
    districts: [
      { code: '1710242', uz: 'Chiroqchi tumani', ru: 'Чиракчинский район' },
      { code: '1710212', uz: 'Dehqonobod tumani', ru: 'Дехканабадский район' },
      { code: '1710207', uz: 'G\'uzor tumani', ru: 'Гузарский район' },
      { code: '1710237', uz: 'Kasbi tumani', ru: 'Касбинский район' },
      { code: '1710232', uz: 'Kitob tumani', ru: 'Китабский район' },
      { code: '1710229', uz: 'Koson tumani', ru: 'Касанский район' },
      { code: '1710240', uz: 'Ko‘kdala tumani', ru: 'Кукдалинский район' },
      { code: '1710233', uz: 'Mirishkor tumani', ru: 'Миришкорский район' },
      { code: '1710234', uz: 'Muborak tumani', ru: 'Мубарекский район' },
      { code: '1710235', uz: 'Nishon tumani', ru: 'Нишанский район' },
      { code: '1710220', uz: 'Qamashi tumani', ru: 'Камашинский район' },
      { code: '1710401', uz: 'Qarshi', ru: 'Карши' },
      { code: '1710224', uz: 'Qarshi tumani', ru: 'Каршинский район' },
      { code: '1710405', uz: 'Shahrisabz', ru: 'Шахрисабз' },
      { code: '1710245', uz: 'Shahrisabz tumani', ru: 'Шахрисабзский район' },
      { code: '1710250', uz: 'Yakkabog\' tumani', ru: 'Яккабагский район' },
    ],
  },
  {
    code: '1735',
    uz: 'Qoraqalpog\'iston Respublikasi',
    ru: 'Республика Каракалпакстан',
    districts: [
      { code: '1735204', uz: 'Amudaryo tumani', ru: 'Амударьинский район' },
      { code: '1735207', uz: 'Beruniy tumani', ru: 'Берунийский район' },
      { code: '1735209', uz: 'Bo‘zatov tumani', ru: 'Бузатовский район' },
      { code: '1735240', uz: 'Chimboy tumani', ru: 'Чимбайский район' },
      { code: '1735250', uz: 'Ellikqal\'a tumani', ru: 'Элликкалинский район' },
      { code: '1735212', uz: 'Kegeyli tumani', ru: 'Кегейлийский район' },
      { code: '1735222', uz: 'Mo\'ynoq tumani', ru: 'Муйнакский район' },
      { code: '1735401', uz: 'Nukus', ru: 'Нукус' },
      { code: '1735225', uz: 'Nukus tumani', ru: 'Нукусский район' },
      { code: '1735218', uz: 'Qanliko\'l tumani', ru: 'Канлыкульский район' },
      { code: '1735215', uz: 'Qo\'ng\'irot tumani', ru: 'Кунградский район' },
      { code: '1735211', uz: 'Qorao\'zak tumani', ru: 'Караузякский район' },
      { code: '1735243', uz: 'Shumanay tumani', ru: 'Шуманайский район' },
      { code: '1735228', uz: 'Taxiatosh tumani', ru: 'Тахиаташский район' },
      { code: '1735230', uz: 'Taxtako\'pir tumani', ru: 'Тахтакупырский район' },
      { code: '1735233', uz: 'To\'rtko\'l tumani', ru: 'Турткульский район' },
      { code: '1735236', uz: 'Xo\'jayli tumani', ru: 'Ходжейлийский район' },
    ],
  },
  {
    code: '1718',
    uz: 'Samarqand viloyati',
    ru: 'Самаркандская область',
    districts: [
      { code: '1718206', uz: 'Bulung\'ur tumani', ru: 'Булунгурский район' },
      { code: '1718212', uz: 'Ishtixon tumani', ru: 'Иштыханский район' },
      { code: '1718209', uz: 'Jomboy tumani', ru: 'Джамбайский район' },
      { code: '1718406', uz: 'Kattaqo\'rg\'on', ru: 'Каттакурган' },
      { code: '1718215', uz: 'Kattaqo\'rg\'on tumani', ru: 'Каттакурганский район' },
      { code: '1718218', uz: 'Narpay tumani', ru: 'Нарпайский район' },
      { code: '1718235', uz: 'Nurobod tumani', ru: 'Нурабадский район' },
      { code: '1718203', uz: 'Oqdaryo tumani', ru: 'Акдарьинский район' },
      { code: '1718227', uz: 'Pastdarg\'om tumani', ru: 'Пастдаргомский район' },
      { code: '1718230', uz: 'Paxtachi tumani', ru: 'Пахтачийский район' },
      { code: '1718224', uz: 'Payariq tumani', ru: 'Пайарыкский район' },
      { code: '1718216', uz: 'Qo\'shrabot tumani', ru: 'Кушрабадский район' },
      { code: '1718401', uz: 'Samarqand', ru: 'Самарканд' },
      { code: '1718233', uz: 'Samarqand tumani', ru: 'Самаркандский район' },
      { code: '1718238', uz: 'Tayloq tumani', ru: 'Тайлякский район' },
      { code: '1718236', uz: 'Urgut tumani', ru: 'Ургутский район' },
    ],
  },
  {
    code: '1724',
    uz: 'Sirdaryo viloyati',
    ru: 'Сырдарьинская область',
    districts: [
      { code: '1724414', uz: 'Baxt shaxar', ru: 'город Бахт' },
      { code: '1724212', uz: 'Boyovut tumani', ru: 'Баяутский район' },
      { code: '1724401', uz: 'Guliston', ru: 'Гулистан' },
      { code: '1724220', uz: 'Guliston tumani', ru: 'Гулистанский район' },
      { code: '1724228', uz: 'Mirzaobod tumani', ru: 'Мирзаабадский район' },
      { code: '1724206', uz: 'Oqoltin tumani', ru: 'Акалтынский район' },
      { code: '1724226', uz: 'Sardoba tumani', ru: 'Сардобинский район' },
      { code: '1724216', uz: 'Sayxunobod tumani', ru: 'Сайхунабадский район' },
      { code: '1724410', uz: 'Shirin', ru: 'Шиpин' },
      { code: '1724231', uz: 'Sirdaryo tumani', ru: 'Сырдарьинский район' },
      { code: '1724235', uz: 'Xovos tumani', ru: 'Хавастский район' },
      { code: '1724413', uz: 'Yangiyer', ru: 'Янгиеp' },
    ],
  },
  {
    code: '1722',
    uz: 'Surxondaryo viloyati',
    ru: 'Сурхандарьинская область',
    districts: [
      { code: '1722202', uz: 'Angor tumani', ru: 'Ангорский район' },
      { code: '1722203', uz: 'Bandixon tumani', ru: 'Бандиханский район' },
      { code: '1722204', uz: 'Boysun tumani', ru: 'Байсунский район' },
      { code: '1722210', uz: 'Denov tumani', ru: 'Денауский район' },
      { code: '1722212', uz: 'Jarqo\'rg\'on tumani', ru: 'Джаркурганский район' },
      { code: '1722207', uz: 'Muzrabot tumani', ru: 'Музрабадский район' },
      { code: '1722201', uz: 'Oltinsoy tumani', ru: 'Алтынсайский район' },
      { code: '1722215', uz: 'Qiziriq tumani', ru: 'Кизирикский район' },
      { code: '1722214', uz: 'Qumqo\'rg\'on tumani', ru: 'Кумкурганский район' },
      { code: '1722217', uz: 'Sariosiyo tumani', ru: 'Сариасийский район' },
      { code: '1722223', uz: 'Sherobod tumani', ru: 'Шерабадский район' },
      { code: '1722226', uz: 'Sho\'rchi tumani', ru: 'Шурчинский район' },
      { code: '1722401', uz: 'Termiz', ru: 'Термез' },
      { code: '1722220', uz: 'Termiz tumani', ru: 'Термезский район' },
      { code: '1722221', uz: 'Uzun tumani', ru: 'Узунский район' },
    ],
  },
  {
    code: '1727',
    uz: 'Toshkent viloyati',
    ru: 'Ташкентская область',
    districts: [
      { code: '1727407', uz: 'Angren', ru: 'Ангрен' },
      { code: '1727413', uz: 'Bekobod', ru: 'Бекабад' },
      { code: '1727220', uz: 'Bekobod tumani', ru: 'Бекабадский район' },
      { code: '1727228', uz: 'Bo\'ka tumani', ru: 'Букинский район' },
      { code: '1727224', uz: 'Bo\'stonliq tumani', ru: 'Бостанлыкский район' },
      { code: '1727256', uz: 'Chinoz tumani', ru: 'Чиназский район' },
      { code: '1727419', uz: 'Chirchiq', ru: 'Чиpчик' },
      { code: '1727401', uz: 'Nurafshon', ru: 'Нурафшон' },
      { code: '1727253', uz: 'O\'rtachirchiq tumani', ru: 'Уртачирчикский район' },
      { code: '1727415', uz: 'Ohangaron', ru: 'Ахангаран' },
      { code: '1727212', uz: 'Ohangaron tumani', ru: 'Ахангаранский район' },
      { code: '1727404', uz: 'Olmaliq', ru: 'Алмалык' },
      { code: '1727206', uz: 'Oqqo\'rg\'on tumani', ru: 'Аккурганский район' },
      { code: '1727249', uz: 'Parkent tumani', ru: 'Паркентский район' },
      { code: '1727250', uz: 'Piskent tumani', ru: 'Пскентский район' },
      { code: '1727248', uz: 'Qibray tumani', ru: 'Кибрайский район' },
      { code: '1727233', uz: 'Quyichirchiq tumani', ru: 'Куйичирчикский район' },
      { code: '1727265', uz: 'Toshkent tumani', ru: 'Ташкентский район' },
      { code: '1727424', uz: 'Yangiyo\'l', ru: 'Янгиюль' },
      { code: '1727259', uz: 'Yangiyo\'l tumani', ru: 'Янгиюльский район' },
      { code: '1727239', uz: 'Yuqorichirchiq tumani', ru: 'Юкоричирчикский район' },
      { code: '1727237', uz: 'Zangiota tumani', ru: 'Зангиатинский район' },
    ],
  },
  {
    code: '1733',
    uz: 'Xorazm viloyati',
    ru: 'Хорезмская область',
    districts: [
      { code: '1733204', uz: 'Bog\'ot tumani', ru: 'Багатский район' },
      { code: '1733208', uz: 'Gurlan tumani', ru: 'Гурленский район' },
      { code: '1733212', uz: 'Qo\'shko\'pir tumani', ru: 'Кошкупырский район' },
      { code: '1733230', uz: 'Shovot tumani', ru: 'Шаватский район' },
      { code: '1733221', uz: 'Tuproqqal’a tumani', ru: 'Тупроккалинский район' },
      { code: '1733401', uz: 'Urganch', ru: 'Ургенч' },
      { code: '1733217', uz: 'Urganch tumani', ru: 'Ургенчский район' },
      { code: '1733220', uz: 'Xazorasp tumani', ru: 'Хазараспский район' },
      { code: '1733406', uz: 'Xiva', ru: 'Хива' },
      { code: '1733226', uz: 'Xiva tumani', ru: 'Хивинский район' },
      { code: '1733223', uz: 'Xonqa tumani', ru: 'Ханкинский район' },
      { code: '1733233', uz: 'Yangiariq tumani', ru: 'Янгиарыкский район' },
      { code: '1733236', uz: 'Yangibozor tumani', ru: 'Янгибазарский район' },
    ],
  },
] as const;

/** Every valid code: the regions and all their districts. */
export const UZ_PLACE_CODES: readonly string[] = UZ_REGIONS.flatMap((r) => [
  r.code,
  ...r.districts.map((d) => d.code),
]);

const BY_CODE = new Map<string, { uz: string; ru: string; region: UzRegion }>();
for (const region of UZ_REGIONS) {
  BY_CODE.set(region.code, { uz: region.uz, ru: region.ru, region });
  for (const d of region.districts) {
    BY_CODE.set(d.code, { uz: d.uz, ru: d.ru, region });
  }
}

export const isUzPlace = (code: string): boolean => BY_CODE.has(code);

/**
 * One code as a line of text: the district with its region behind it, or just
 * the region when that is all somebody gave. Unknown codes come back as
 * themselves — better to show something odd than to render blank while
 * holding data.
 */
export function placeLabel(
  code: string | null | undefined,
  lang: 'uz' | 'ru' = 'uz',
): string | null {
  if (!code) return null;

  const hit = BY_CODE.get(code);
  if (!hit) return code;

  const own = lang === 'ru' ? hit.ru : hit.uz;
  if (code === hit.region.code) return own;

  return `${lang === 'ru' ? hit.region.ru : hit.region.uz}, ${own}`;
}
