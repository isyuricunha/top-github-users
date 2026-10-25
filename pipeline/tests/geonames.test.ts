import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig, repoRoot } from '../src/config.ts';
import { slugify } from '../src/slug.ts';
import type { CountrySnapshot } from '../src/types.ts';

/**
 * Canonical English display names for the 138 locations, derived from the ISO
 * 3166 short names plus a small set of deliberate overrides (common English
 * names and full display names). Any change to a display name must update this
 * map first, because the site renders geoName as the visible country name.
 */
export const EXPECTED_GEO_NAMES: Record<string, string> = {
  'afghanistan': 'Afghanistan',
  'albania': 'Albania',
  'algeria': 'Algeria',
  'andorra': 'Andorra',
  'angola': 'Angola',
  'argentina': 'Argentina',
  'armenia': 'Armenia',
  'australia': 'Australia',
  'austria': 'Austria',
  'azerbaijan': 'Azerbaijan',
  'bahrain': 'Bahrain',
  'bangladesh': 'Bangladesh',
  'belarus': 'Belarus',
  'belgium': 'Belgium',
  'benin': 'Benin',
  'bhutan': 'Bhutan',
  'bolivia': 'Bolivia',
  'bosnia_and_herzegovina': 'Bosnia and Herzegovina',
  'botswana': 'Botswana',
  'brazil': 'Brazil',
  'bulgaria': 'Bulgaria',
  'burkina_faso': 'Burkina Faso',
  'burundi': 'Burundi',
  'cambodia': 'Cambodia',
  'cameroon': 'Cameroon',
  'canada': 'Canada',
  'chad': 'Chad',
  'chile': 'Chile',
  'china': 'China',
  'hong_kong': 'Hong Kong',
  'taiwan': 'Taiwan',
  'colombia': 'Colombia',
  'congo': 'Congo',
  'croatia': 'Croatia',
  'cuba': 'Cuba',
  'cyprus': 'Cyprus',
  'czechia': 'Czechia',
  'denmark': 'Denmark',
  'dominican_republic': 'Dominican Republic',
  'ecuador': 'Ecuador',
  'egypt': 'Egypt',
  'el_salvador': 'El Salvador',
  'estonia': 'Estonia',
  'ethiopia': 'Ethiopia',
  'finland': 'Finland',
  'france': 'France',
  'georgia': 'Georgia',
  'germany': 'Germany',
  'ghana': 'Ghana',
  'greece': 'Greece',
  'guatemala': 'Guatemala',
  'honduras': 'Honduras',
  'hungary': 'Hungary',
  'iceland': 'Iceland',
  'india': 'India',
  'indonesia': 'Indonesia',
  'iran': 'Iran',
  'iraq': 'Iraq',
  'ireland': 'Ireland',
  'israel': 'Israel',
  'italy': 'Italy',
  'jamaica': 'Jamaica',
  'japan': 'Japan',
  'jordan': 'Jordan',
  'kazakhstan': 'Kazakhstan',
  'kenya': 'Kenya',
  'kuwait': 'Kuwait',
  'laos': 'Laos',
  'latvia': 'Latvia',
  'lithuania': 'Lithuania',
  'luxembourg': 'Luxembourg',
  'madagascar': 'Madagascar',
  'malawi': 'Malawi',
  'malaysia': 'Malaysia',
  'maldives': 'Maldives',
  'mali': 'Mali',
  'malta': 'Malta',
  'mauritania': 'Mauritania',
  'mauritius': 'Mauritius',
  'mexico': 'Mexico',
  'moldova': 'Moldova',
  'mongolia': 'Mongolia',
  'montenegro': 'Montenegro',
  'morocco': 'Morocco',
  'mozambique': 'Mozambique',
  'myanmar': 'Myanmar',
  'namibia': 'Namibia',
  'nepal': 'Nepal',
  'netherlands': 'Netherlands',
  'new_zealand': 'New Zealand',
  'nicaragua': 'Nicaragua',
  'nigeria': 'Nigeria',
  'norway': 'Norway',
  'oman': 'Oman',
  'pakistan': 'Pakistan',
  'palestine': 'Palestine',
  'panama': 'Panama',
  'paraguay': 'Paraguay',
  'peru': 'Peru',
  'philippines': 'Philippines',
  'poland': 'Poland',
  'portugal': 'Portugal',
  'qatar': 'Qatar',
  'romania': 'Romania',
  'russia': 'Russia',
  'rwanda': 'Rwanda',
  'san_marino': 'San Marino',
  'saudi_arabia': 'Saudi Arabia',
  'senegal': 'Senegal',
  'serbia': 'Serbia',
  'sierra_leone': 'Sierra Leone',
  'singapore': 'Singapore',
  'slovakia': 'Slovakia',
  'slovenia': 'Slovenia',
  'south_africa': 'South Africa',
  'south_korea': 'South Korea',
  'spain': 'Spain',
  'sri_lanka': 'Sri Lanka',
  'sudan': 'Sudan',
  'sweden': 'Sweden',
  'switzerland': 'Switzerland',
  'syria': 'Syria',
  'tanzania': 'Tanzania',
  'thailand': 'Thailand',
  'tunisia': 'Tunisia',
  'turkey': 'Turkey',
  'uganda': 'Uganda',
  'ukraine': 'Ukraine',
  'united_arab_emirates': 'United Arab Emirates',
  'united_kingdom': 'United Kingdom',
  'united_states': 'United States of America',
  'uruguay': 'Uruguay',
  'uzbekistan': 'Uzbekistan',
  'venezuela': 'Venezuela',
  'vietnam': 'Vietnam',
  'yemen': 'Yemen',
  'zambia': 'Zambia',
  'zimbabwe': 'Zimbabwe',
};

const currentDir = resolve(repoRoot(), 'data', 'current');
const describeIfData = existsSync(currentDir) ? describe : describe.skip;

describeIfData('display names', () => {
  const config = loadConfig();
  const configNames = new Map(
    config.locations.map((location) => [slugify(location.country), location.geoName]),
  );

  it('covers every configured location and nothing else', () => {
    const configSlugs = config.locations.map((location) => slugify(location.country));
    expect(Object.keys(EXPECTED_GEO_NAMES).sort()).toEqual(configSlugs.slice().sort());
  });

  it('config geoName matches the canonical display name', () => {
    for (const [slug, geoName] of configNames) {
      expect(geoName, `config ${slug}`).toBe(EXPECTED_GEO_NAMES[slug]);
    }
  });

  it('every snapshot geoName matches the canonical display name', () => {
    for (const file of readdirSync(currentDir).filter((f) => f.endsWith('.json'))) {
      const slug = file.slice(0, -5);
      const snapshot = JSON.parse(readFileSync(join(currentDir, file), 'utf8')) as CountrySnapshot;
      expect(snapshot.geoName, `data/current/${file}`).toBe(EXPECTED_GEO_NAMES[slug]);
    }
  });

  it('city terms have no leading or trailing whitespace', () => {
    for (const location of config.locations) {
      for (const city of location.cities) {
        expect(city, `config ${location.country}`).toBe(city.trim());
      }
    }
    for (const file of readdirSync(currentDir).filter((f) => f.endsWith('.json'))) {
      const snapshot = JSON.parse(readFileSync(join(currentDir, file), 'utf8')) as CountrySnapshot;
      for (const city of snapshot.cities) {
        expect(city, `data/current/${file}`).toBe(city.trim());
      }
    }
  });
});