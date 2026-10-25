/**
 * File and route slug: lowercase country name with spaces replaced by
 * underscores, matching the legacy cache and markdown file naming so the
 * v2 paths stay predictable (`bosnia and herzegovina` -> `bosnia_and_herzegovina`).
 */
export function slugify(country: string): string {
  return country.toLowerCase().replace(/ /g, '_');
}
