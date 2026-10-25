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

Two phases per location, shaped by the documented per-query resource limits: the contributionsCollection object is expensive server-side, and a query asking for it on a full 100-user search page is rejected with "resource limits exceeded".

1. Light search: one GraphQL `search(type: USER)` over the country and its cities. Repeated `location:` qualifiers union; `sort:followers-desc` rides inside the query string (verified live against the API). Pages of 100 users collect up to `MAX_USERS = 500` per country with id, login, avatar, profile fields and follower counts.
2. Contributions: `nodes(ids)` lookups in batches of 10, each node returning the contribution calendar total and the restricted (private) count. Public contributions are derived: total minus restricted.

Rankings are three orderings of the same set: followers, public contributions, total contributions (public plus private). The search `userCount` is kept so country pages can state the tracked total honestly; the set is capped at 500 users per country.

### Cadence and budgets

- The workflow runs hourly and collects a batch of countries round-robin from the checkpoint in `data/meta.json` (6 per run). A full cycle over all 138 countries completes in about a day.
- Cost per country: roughly 7 search pages plus 50 contribution batches, about 57 requests at about 1 GraphQL point each.
- Official limits (docs.github.com): `GITHUB_TOKEN` in Actions gets 1,000 GraphQL points per hour per repository; secondary limits allow no more than 2,000 points per minute and require no concurrency. Six countries per hourly run stays near 350 points, inside both budgets.
- Retries honor `retry-after` and `x-ratelimit-reset`; a run whose every country fails exits nonzero so the workflow fails visibly instead of silently skipping data.

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
