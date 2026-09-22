import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** base64url random token; 32 bytes = 256 bits (PAIR-01). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** 256 short, distinct, easy-to-say words for the admission verification phrase (SPEC §7.1). */
export const PHRASE_WORDS: readonly string[] = (
  'acorn amber anchor apple arch arrow aspen atlas autumn badge bamboo banner barley basin beacon bear ' +
  'berry birch bison blade bloom boat bolt brass bread breeze brick bridge brook brush bubble cabin ' +
  'cactus camel candle canoe canyon cargo castle cedar chalk cherry cider circle citrus cliff clock cloud ' +
  'clover coast cobalt comet copper coral cotton crane crater creek cricket crown crystal cup dawn delta ' +
  'desert dew dune eagle echo ember falcon fern ferry field finch flame flint forest fossil fountain fox ' +
  'frost garden garnet ginger glacier globe gold grain granite grape grove harbor harvest hazel heron hill ' +
  'honey horizon island ivory jade jasmine jet juniper kettle kite koala lagoon lake lamp lantern lark ' +
  'laurel lemon lily lime linen lotus lunar maple marble meadow melon mesa meteor mint mist moon moss ' +
  'mountain nectar nest noble north oak oasis ocean olive onyx opal orbit orchid otter owl palm panda ' +
  'paper pearl pebble pepper piano pine planet plum polar pond poppy prairie prism pumpkin quail quartz ' +
  'quill rain raven reed ridge river robin rocket rose ruby saffron sage sail salt sand sapphire ' +
  'shadow shell shore silk silver sky slate snow solar sparrow spice spruce star stone storm stream ' +
  'summit sun swan tango thistle thunder tiger timber topaz torch tulip tundra valley velvet violet ' +
  'walnut water wave wheat willow wind winter wolf wren yarrow zebra zenith zinc basil lava lichen ' +
  'magnet mango nutmeg orange papaya parrot peach petal pilot puffin radish ribbon saddle scarf ' +
  'seed sierra sonnet spark spring tidal toucan trail tree trumpet turtle umber vapor vine whale yak'
).split(' ');

export function verificationPhrase(): string {
  const w = PHRASE_WORDS;
  return `${w[randomInt(w.length)]}-${w[randomInt(w.length)]}-${String(randomInt(10, 100))}`;
}
