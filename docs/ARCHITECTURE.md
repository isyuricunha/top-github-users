# Architecture

Rebuild of the Top GitHub Users project: an in-repo TypeScript data pipeline and an Astro static site replace the frozen third-party action (`gayanvoice/top-github-users-action`, last upstream release May 2023).

## Goal

Daily-refreshed rankings of the most followed and most active GitHub users per country, rendered as a fast static site, with a repository that no longer grows by gigabytes per year.

## Components

| Path | Role |
| --- | --- |
| `config.json` | Source of truth for locations (countries and cities) and flag image sources. Unchanged from the legacy project. |
| `pipeline/` | TypeScript collector: queries the GitHub API, ranks users, writes data. |
| `data/` | Generated data: current snapshots, append-only history, run metadata. |
| `site/` | Astro static site (YuTheme v2), deployed to GitHub Pages. |
| `.github/workflows/rankings.yml` | Orchestration: collect, commit data, build site, deploy Pages. |

Legacy `cache/`, `markdown/`, `checkpoint.json` and `docs/index.html` are removed after the first successful run of the new pipeline.

## Data contract

`data/current/{country}.json` (full snapshot, canonical key order, stable formatting):

```json
{
  "country": "afghanistan",
  "geoName": "Afghanistan",
  "cities": ["kabul", "kandahar"],
  "collectedAt": "2026-10-25T03:30:00Z",
  "minimumFollowers": 2,
  "users": [
    {
      "login": "afgprogrammer",
      "name": "Mohammad Rahmani",
      "avatarUrl": "https://avatars.githubusercontent.com/u/17293422?v=4",
      "location": "Kabul, Afghanistan",
      "company": "@openafg",
      "twitterUsername": null,
      "followers": 3396,
      "totalContributions": 6398,
      "privateContributions": 6239,
      "publicContributions": 159
    }
  ]
}
```

`data/history/{country}.jsonl`: one line per collection run, containing the date, user count, minimum followers and the three metric leaders. Daily summaries stay in the kilobyte range and power the site trend views.

`data/meta.json`: round-robin checkpoint (index of the next country), last run timestamps per country.

Rules:

- Absent profile fields are `null`, never the string `"undefined value"` used by the legacy pipeline.
- `publicContributions` is derived: `totalContributions - privateContributions`.
- Writers are deterministic: same input produces byte-identical output, so unchanged days produce no commit.

## Collection strategy

One GraphQL `search(type: USER)` per country. The query string repeats the `location:` qualifier for the country and each city (repeated same-qualifier terms union), and requests `sort:followers-desc` inside the query string, exactly as the legacy engine did. Pagination uses `first: 100` (GraphQL maximum) with a page cap of 10, matching the documented 1,000-result search limit.

Per user the query fetches:

- `followers { totalCount }` → followers ranking.
- `contributionsCollection { contributionCalendar { totalContributions } }` → total contributions ranking.
- `contributionsCollection { restrictedContributionsCount }` → private contributions, used to derive public contributions.

Rankings are three orderings of the same user set: followers, public contributions, total contributions (public + private). This matches the legacy product definitions; the sample cache confirms `public + private = calendar total`.

### Cadence and budgets

- The workflow runs hourly and collects a batch of countries round-robin from the checkpoint. A full cycle over all countries completes in roughly a day.
- Official limits (docs.github.com, GraphQL rate and node limits): `GITHUB_TOKEN` in Actions gets 1,000 GraphQL points per hour per repository; a page of 100 users with the fields above costs roughly 3 points. A full cycle costs a few thousand points per day, comfortably inside the budget when spread hourly.
- REST search (30 requests/minute authenticated) is used for the live probe and as a fallback ordering source.
- Secondary limits: no concurrency, at least 1 second between requests, retries honor `x-ratelimit-reset` and `retry-after`, hard stop after repeated errors without advancing the checkpoint.

## Site

- Astro static output, TypeScript, pnpm, no client framework. Tables render at build time; a small vanilla script handles the metric tab switch, client-side filtering and lazy avatar loading.
- YuTheme v2 (AMOLED default) with the standalone kit CSS: Geist typography, surface ladder, shimmer/rise/lift/glow effects within the per-viewport effect budget.
- Self-hosted flag SVGs (downloaded from the configured Wikimedia sources), lazy-loaded avatars from the GitHub CDN with shimmer placeholders.
- Routes: home (hero, global stats, country index), one page per country with the three ranking views, an about page documenting methodology with links to the official GitHub docs, and a 404. Sitemap, canonical URLs, Open Graph and JSON-LD.
- Legacy markdown files at `markdown/{followers,public_contributions,total_contributions}/{country}.md` keep being generated with the top 100 rows so previously shared links continue to resolve, at roughly a tenth of the legacy weight.

## Operations

- Pages deploys through GitHub Actions (`actions/deploy-pages`) with the repository `GITHUB_TOKEN`; no personal access tokens, no repository secrets. The legacy `CUSTOM_TOKEN` and `TOKEN` secrets become unused and are proposed for removal.
- Data commits are made by `github-actions[bot]`; a run that finds no changes makes no commit.
- Failure handling: rate-limit-aware backoff, visible run failure, checkpoint advances only on success. Rollback: revert the data commit; Pages deploys are atomic.

## Security

- Least-privilege workflow permissions: `contents: write`, `pages: write`, `id-token: write`. Nothing else.
- Config parsed with schema validation; generated JSON is canonicalized.
- No IP addresses, internal hostnames, tool names or infrastructure details in the repository or the site.

## Toolchain (latest stable at build time)

Node 24 LTS (Krypton), pnpm 12, Astro 7, TypeScript 6.x (newest compatible with `@astrojs/check`), first-party GitHub Actions at their current majors. Pinned per package file; upgrades are deliberate bumps, not drift.
