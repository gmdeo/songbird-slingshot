// Species, places and level design.
// Bird facts: RSPB species pages. Squirrel: The Wildlife Trusts. Places: Wikipedia + OpenStreetMap.

export const BIRDS = {
  robin: {
    name: 'Robin', latin: 'Erithacus rubecula', status: 'Green',
    radius: 0.9, mass: 3, colors: { body: 0x8a6a4a, belly: 0xd9542b, face: 0xd9542b, wing: 0x6e5236, beak: 0x2a2018 },
    power: 'Steady flyer. No power.', powerKey: null,
    fact: 'Robins sing nearly all year round, even at night beside street lights. Despite the cute look they are fiercely territorial.',
  },
  bluetit: {
    name: 'Blue Tit', latin: 'Cyanistes caeruleus', status: 'Green',
    radius: 0.75, mass: 2.4, colors: { body: 0x7aa05a, belly: 0xf2d33a, face: 0xffffff, cap: 0x3a7fd0, wing: 0x3a7fd0, beak: 0x1b1b1b },
    power: 'Tap mid-flight: dash forward.', powerKey: 'dash',
    fact: 'About 12 cm long. Blue Tits can lay up to 16 eggs, timed to the arrival of caterpillars.',
  },
  goldfinch: {
    name: 'Goldfinch', latin: 'Carduelis carduelis', status: 'Green',
    radius: 0.78, mass: 2.2, colors: { body: 0xc9a27a, belly: 0xf1e6d6, face: 0xd8262a, wing: 0x1b1b1b, bar: 0xf2c200, beak: 0xe8d8c0 },
    power: 'Tap mid-flight: split into a charm of three.', powerKey: 'split',
    fact: 'Very sociable, often breeding in loose groups. Its fine beak reaches seeds in thistles and teasels other birds cannot.',
  },
  thrush: {
    name: 'Song Thrush', latin: 'Turdus philomelos', status: 'Amber',
    radius: 1.0, mass: 4.5, colors: { body: 0x8a6a45, belly: 0xf1e4c8, face: 0xf1e4c8, wing: 0x7a5a38, spots: 0x3a2a1a, beak: 0x3a2a1a },
    power: 'Tap mid-flight: anvil strike, straight down.', powerKey: 'anvil',
    fact: 'Song Thrushes smash snails open on a favourite stone, called an anvil. Broken shells around a stone give them away.',
  },
  wren: {
    name: 'Wren', latin: 'Troglodytes troglodytes', status: 'Amber',
    radius: 0.65, mass: 2.6, colors: { body: 0x8a5a36, belly: 0xc49a6c, face: 0xc49a6c, wing: 0x6a4428, beak: 0x2a1a10 },
    power: 'Tap mid-flight: sing a shockwave.', powerKey: 'song',
    fact: 'Tiny, with a remarkably loud voice. More than 60 Wrens were once found huddled in a single nest box to keep warm.',
  },
};

export const SQUIRREL = {
  name: 'Grey Squirrel', latin: 'Sciurus carolinensis', status: 'Invasive non-native',
  radius: 1.1, mass: 1.6, health: 55,
  fact: 'Introduced to the UK in the 1800s, grey squirrels have contributed to the decline of the native red squirrel. They are notorious for cracking open bird feeders.',
};

// Block materials. density in mass units per cubic metre; health = impact energy a
// 1 m^3 block absorbs before breaking (scaled by volume at build time).
export const MATERIALS = {
  twig:  { density: 14, health: 1800,  color: 0x9a7448, rough: 0.95, score: 300 },
  wood:  { density: 24, health: 5200,  color: 0xb58a55, rough: 0.8,  score: 500 },
  stone: { density: 70, health: 16000, color: 0xa8a18e, rough: 1.0,  score: 800 }, // Peak District gritstone
};

export const BIRD_MASS = { robin: 40, bluetit: 32, goldfinch: 30, thrush: 60, wren: 36 };
export const SQUIRREL_MASS = 14;
export const SQUIRREL_HEALTH = 1400;

export const SCORE = { squirrel: 5000, birdLeft: 10000 };

// 1 world unit = 1 metre. Camps sit at real distances on real ground, so birds launch
// far faster than any songbird could fly. Gravity is boosted for snappier arcs.
export const PHYS = { gravity: -22, maxSpeed: 110, drag: 0.035, windScale: 2.5, step: 1 / 180 };

// The slingshot stands on the Hollins Cross saddle of the Great Ridge.
// Each camp is placed by compass bearing (degrees) and distance (metres) on real terrain.
// Positions were chosen so the camp is in line of sight from the slingshot.
// build: [template, offset across the camp in metres, material]
export const LEVELS = [
  {
    id: 1, title: 'Ridge Feeder',
    blurb: 'Squirrels have raided a feeder on the Great Ridge, on the way to Mam Tor.',
    tip: 'Drag down from the bird to pull, let go to fling. Set the angle with ▲▼ and follow the dots.',
    birds: ['robin', 'robin', 'robin'],
    camps: [{ name: 'Great Ridge West', bearing: 250, dist: 170, build: [['hut', 0, 'wood']] }],
  },
  {
    id: 2, title: 'Back Tor Wall',
    blurb: 'A drystone wall along the ridge towards Back Tor and Lose Hill.',
    tip: 'This camp is behind you. Swivel round: drag the sky or use the arrow keys.',
    birds: ['robin', 'robin', 'robin'],
    camps: [{ name: 'Back Tor Wall', bearing: 75, dist: 200, build: [['wall', -5, 'stone'], ['tower2', 4, 'wood']] }],
  },
  {
    id: 3, title: 'Edale Hedgerow',
    blurb: 'A twiggy camp on the slope above the Vale of Edale.',
    tip: 'Meet the Blue Tit. Tap while it flies to dash forward.',
    birds: ['bluetit', 'bluetit', 'robin'],
    camps: [{ name: 'Edale Hedgerow', bearing: 300, dist: 140, build: [['hut', -4, 'twig'], ['tower2', 4, 'twig']] }],
  },
  {
    id: 4, title: 'Odin Mine',
    blurb: 'Above the old lead workings under Mam Tor, the Shivering Mountain.',
    tip: 'Meet the Goldfinch. Tap while it flies to split into a charm of three.',
    birds: ['goldfinch', 'goldfinch', 'robin'],
    camps: [{ name: 'Odin Mine', bearing: 195, dist: 140, build: [['tower1', -7, 'wood'], ['tower2', 0, 'twig'], ['tower1', 7, 'wood']] }],
  },
  {
    id: 5, title: 'Barber Booth Barn',
    blurb: 'A field barn with a gritstone roof, above the hamlet of Barber Booth.',
    tip: 'Meet the Song Thrush. Tap above the roof to strike straight down, like a snail on an anvil.',
    birds: ['thrush', 'thrush', 'robin'],
    camps: [{ name: 'Barber Booth Barn', bearing: 270, dist: 240, build: [['barn', 0, 'wood']] }],
  },
  {
    id: 6, title: 'Mam Tor Hill Fort',
    blurb: 'On the flank of Mam Tor, crowned by a Bronze Age and Iron Age hill fort.',
    tip: 'Meet the Wren. Tap near the camp to sing a shockwave.',
    birds: ['wren', 'wren', 'goldfinch'],
    camps: [{ name: 'Mam Tor Flank', bearing: 225, dist: 280, build: [['tower2', -6, 'twig'], ['tower3', 0, 'twig'], ['hut', 7, 'wood']] }],
  },
  {
    id: 7, title: 'Two Fronts',
    blurb: 'Squirrels are dug in on both sides of the ridge. You will have to turn right round.',
    tip: 'Follow the red markers on the compass.',
    birds: ['robin', 'bluetit', 'goldfinch', 'thrush'],
    camps: [
      { name: 'Back Tor Flank', bearing: 90, dist: 240, build: [['tower2', 0, 'wood']] },
      { name: 'Rushup Side', bearing: 255, dist: 240, build: [['tower2', -4, 'twig'], ['hut', 4, 'wood']] },
    ],
  },
  {
    id: 8, title: 'Squirrel HQ',
    blurb: 'Three camps all around Hollins Cross. The ringleaders are here.',
    tip: 'Use everything you have. The spyglass helps you pick targets.',
    birds: ['thrush', 'wren', 'goldfinch', 'bluetit', 'robin', 'robin'],
    camps: [
      { name: 'Lose Hill Path', bearing: 60, dist: 280, build: [['wall', -6, 'stone'], ['tower3', 3, 'twig']] },
      { name: 'Rushup Barn', bearing: 240, dist: 330, build: [['barn', 0, 'wood']] },
      { name: 'Edale Lookout', bearing: 15, dist: 140, build: [['tower2', 0, 'wood']] },
    ],
  },
];

// Short place notes shown on the compass and in the scouting view.
export const PLACE_NOTES = {
  'Mam Tor': '517 m. The name means "mother hill". Landslips on its east face earn it the name Shivering Mountain.',
  'Kinder Scout': '636 m. The highest point in the Peak District, a moorland plateau and National Nature Reserve.',
  'Lose Hill': 'Eastern end of the Great Ridge, facing Win Hill across the Hope Valley.',
  'Back Tor': 'A crag on the Great Ridge between Hollins Cross and Lose Hill.',
  'Win Hill': 'Legend says a battle between Win Hill and Lose Hill gave both hills their names. Historians find no evidence of it.',
  'Castleton': 'Village at the head of the Hope Valley, ringed by show caves.',
  'Edale': 'Start of the Pennine Way, in the Vale of Edale.',
  'Hope': 'Village in the Hope Valley.',
  'Barber Booth': 'A hamlet in the Vale of Edale.',
  'Peveril Castle': 'A ruined 11th-century castle above Castleton.',
  'Winnats Pass': 'A limestone gorge. The name comes from "wind gates", after the winds swirling through it.',
  'Mam Farm': 'A farm on the slope below Hollins Cross.',
  'Odin Mine': 'An old lead mine beneath Mam Tor.',
  'Mam Nick': 'A gap in the ridge made by a landslide, carrying the road into Edale.',
};
