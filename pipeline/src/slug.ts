/**
 * File and route slug: trim, lowercase, and replace consecutive whitespace
 * with underscores (`bosnia and herzegovina` -> `bosnia_and_herzegovina`).
 */
export function slugify(country: string): string {
  return country.trim().toLowerCase().replace(/\s+/g, '_');
}
