import type { PlayerBio } from '../espn/parse'

/**
 * Positions for players ESPN lists as "Not Available", read from other sources by hand. ESPN has
 * no position for most players from before 2012, and a season only gets position averages and
 * ranks once every qualified player that year has one (league_seasons.qualified_with_position) —
 * these entries are what let 2009–2011 clear that bar. ESPN's own position always wins when it has
 * one; an entry here is consulted only where ESPN says "NA" (storedPosition below).
 *
 * How each letter was chosen: Wikidata's position claim where its item also lists a WNBA team the
 * player was on (2009–2011 checked 2026-09-30), otherwise the Wikipedia infobox; every letter was
 * then checked against the player's WNBA.com page. Where a listing gives two positions
 * ("Forward-Center") the first is taken, the convention of the league's site and of
 * Basketball-Reference — and for the players whose sources ordered the two differently, both of
 * those listings were read and agree. One letter per player, as ESPN stores it: G, F or C.
 */
export type Position = 'G' | 'F' | 'C'

export interface PositionOverride {
  /** For reading the list; the key is what identifies the player. */
  name: string
  position: Position
  /** Where the letter was read, so any entry can be re-checked. */
  source: string
}

export const POSITION_OVERRIDES: Readonly<Record<string, PositionOverride>> = {
  '884': { name: 'Abi Olajuwon', position: 'C', source: 'Wikidata Q2821600; WNBA.com agrees, read 2026-09-30' },
  '706': { name: 'Alison Bales', position: 'C', source: 'Wikidata Q275762; WNBA.com agrees, read 2026-09-30' },
  '908': { name: 'Alison Lacey', position: 'G', source: 'Wikidata Q4727116; WNBA.com agrees, read 2026-09-30' },
  '631': { name: 'Anna Montanana', position: 'F', source: 'Wikidata Q524509; WNBA.com agrees, read 2026-09-30' },
  '619': {
    name: 'Ashley Battle',
    position: 'F',
    source: 'Wikipedia "Ashley Battle"; WNBA.com agrees, read 2026-09-30',
  },
  '930': { name: 'Ashley Houts', position: 'G', source: 'Wikidata Q2866546; WNBA.com agrees, read 2026-09-30' },
  '750': {
    name: 'Brooke Smith',
    position: 'F',
    source: 'WNBA.com and Basketball-Reference agree on the order, read 2026-09-30',
  },
  '442': { name: 'Brooke Wyckoff', position: 'F', source: 'Wikidata Q3645355; WNBA.com agrees, read 2026-09-30' },
  '911': { name: 'Chanel Mokango', position: 'F', source: 'Wikidata Q5071536; WNBA.com agrees, read 2026-09-30' },
  '289': {
    name: 'Chasity Melvin',
    position: 'C',
    source: 'WNBA.com and Basketball-Reference agree on the order, read 2026-09-30',
  },
  '637': { name: 'Chelsea Newton', position: 'G', source: 'Wikidata Q3667075; WNBA.com agrees, read 2026-09-30' },
  '857': { name: 'Chen Nan', position: 'C', source: 'Wikidata Q715431; WNBA.com agrees, read 2026-09-30' },
  '861': {
    name: 'Christina Wirth',
    position: 'F',
    source: 'Wikipedia "Christina Wirth"; WNBA.com agrees, read 2026-09-30',
  },
  '785': {
    name: 'Crystal Kelly',
    position: 'F',
    source: 'WNBA.com and Basketball-Reference agree on the order, read 2026-09-30',
  },
  '643': { name: 'Edwige Lawson-Wade', position: 'G', source: 'Wikidata Q621757; WNBA.com agrees, read 2026-09-30' },
  '878': { name: 'Erin Perperoglou', position: 'F', source: 'Wikidata Q3056630; WNBA.com agrees, read 2026-09-30' },
  '270': { name: 'Hamchetou Maiga-Ba', position: 'F', source: 'Wikidata Q3126374; WNBA.com agrees, read 2026-09-30' },
  '150': { name: 'Helen Darling', position: 'G', source: 'Wikidata Q389506; WNBA.com agrees, read 2026-09-30' },
  '929': {
    name: 'Jacinta Monroe',
    position: 'F',
    source: 'WNBA.com and Basketball-Reference agree on the order, read 2026-09-30',
  },
  '955': { name: 'Jana Vesela', position: 'F', source: 'Wikidata Q2553281; WNBA.com agrees, read 2026-09-30' },
  '35': { name: 'Janell Burse', position: 'C', source: 'Wikidata Q432836; WNBA.com agrees, read 2026-09-30' },
  '494': { name: 'K.B. Sharp', position: 'G', source: 'Wikidata Q2396810; WNBA.com agrees, read 2026-09-30' },
  '710': {
    name: 'Katie Gearlds',
    position: 'G',
    source: 'WNBA.com and Basketball-Reference agree on the order, read 2026-09-30',
  },
  '536': { name: 'Kelly Mazzante', position: 'G', source: 'Wikidata Q3814402; WNBA.com agrees, read 2026-09-30' },
  '721': { name: 'Kerri Gardin', position: 'F', source: 'Wikidata Q3814757; WNBA.com agrees, read 2026-09-30' },
  '108': { name: 'Kiesha Brown', position: 'G', source: 'Wikidata Q3196482; WNBA.com agrees, read 2026-09-30' },
  '203': { name: 'Kristi Harrower', position: 'G', source: 'Wikidata Q622734; WNBA.com agrees, read 2026-09-30' },
  '636': { name: 'Kristin Haynie', position: 'G', source: 'Wikidata Q529613; WNBA.com agrees, read 2026-09-30' },
  '6': { name: 'Lisa Leslie', position: 'C', source: 'Wikidata Q257980; WNBA.com agrees, read 2026-09-30' },
  '950': { name: 'Marion Jones', position: 'G', source: 'Wikidata Q209396; WNBA.com agrees, read 2026-09-30' },
  '563': {
    name: 'Nicole Ohlde',
    position: 'F',
    source: 'WNBA.com and Basketball-Reference agree on the order, read 2026-09-30',
  },
  '683': { name: 'Nikki Blue', position: 'G', source: 'Wikipedia "Nikki Blue"; WNBA.com agrees, read 2026-09-30' },
  '10': { name: 'Nikki Teasley', position: 'G', source: 'Wikidata Q3341538; WNBA.com agrees, read 2026-09-30' },
  '832': {
    name: 'Olayinka Sanni',
    position: 'F',
    source: 'WNBA.com and Basketball-Reference agree on the order, read 2026-09-30',
  },
  '1015': {
    name: 'Porsha Phillips',
    position: 'F',
    source: 'Wikipedia "Porsha Phillips"; WNBA.com agrees, read 2026-09-30',
  },
  '863': {
    name: 'Rashanda McCants',
    position: 'F',
    source: 'Wikipedia "Rashanda McCants"; WNBA.com agrees, read 2026-09-30',
  },
  '626': { name: 'Sandora Irvin', position: 'F', source: 'Wikidata Q529627; WNBA.com agrees, read 2026-09-30' },
  '871': {
    name: 'Shalee Lehning',
    position: 'G',
    source: 'Wikipedia "Shalee Lehning"; WNBA.com agrees, read 2026-09-30',
  },
  '230': { name: 'Shannon Johnson', position: 'G', source: 'Wikidata Q454550; WNBA.com agrees, read 2026-09-30' },
  '385': { name: 'Sheryl Swoopes', position: 'F', source: 'Wikidata Q270683; WNBA.com agrees, read 2026-09-30' },
  '742': { name: 'Sidney Spencer', position: 'G', source: 'Wikidata Q2001928; WNBA.com agrees, read 2026-09-30' },
  '3': { name: 'Tamecka Dixon', position: 'G', source: 'Wikidata Q971891; WNBA.com agrees, read 2026-09-30' },
  '21': { name: 'Tamika Whitmore', position: 'F', source: 'Wikidata Q275305; WNBA.com agrees, read 2026-09-30' },
  '829': { name: 'Tasha Humphrey', position: 'C', source: 'Wikidata Q3981265; WNBA.com agrees, read 2026-09-30' },
  '949': {
    name: 'Taylor Lilley',
    position: 'G',
    source: 'Wikipedia "Taylor Lilley"; WNBA.com agrees, read 2026-09-30',
  },
  '561': {
    name: 'Vanessa Hayden-Johnson',
    position: 'C',
    source: 'Wikidata Q4008547; WNBA.com agrees, read 2026-09-30',
  },
}

/** The position to store for a bio: ESPN's, or the hand-read one where ESPN has none. */
export function storedPosition(bio: Pick<PlayerBio, 'espnId' | 'position'>): string | null {
  return bio.position ?? POSITION_OVERRIDES[bio.espnId]?.position ?? null
}
