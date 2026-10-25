# Architecture

Top GitHub Users is a TypeScript data pipeline and an Astro static site. The pipeline collects public profile data through GitHub's official GraphQL API. The site renders one ranking page per configured country.

## Goal

Top GitHub Users presents rankings of the most followed and most active GitHub users per country. The static site is built from snapshots collected by the hourly round-robin workflow.

## Components

| Path | Role |
| --- | --- |
| `config.json` | Source of truth for locations (countries and cities) and flag image sources. |
| `pipeline/` | TypeScript collector: queries the GitHub API, ranks users, writes data. |
| `data/` | Generated data: current snapshots, history summaries, run metadata. |
| `site/` | Astro static site (YuTheme v2), deployed to GitHub Pages. |
| `.github/workflows/rankings.yml` | Orchestration: collect, commit data, build site, deploy Pages. |

Country slugs are trimmed and lowercased, with consecutive whitespace replaced by underscores, matching the data filenames.

## Data contract

`data/current/{country}.json` (full snapshot, canonical key order, stable formatting):

```json
{
  "country": "afghanistan",
  "geoName": "Afghanistan",
  "cities": ["kabul", "kandahar", "herat", "Kunduz", "lashkargah", "ghazni", "khost", "zaranj"],
  "collectedAt": "2025-11-08T02:20:00.000Z",
  "minimumFollowers": 2,
  "users": [
    {
      "login": "afgprogrammer",
      "name": "Mohammad Rahmani",
      "avatarUrl": "https://avatars.githubusercontent.com/u/17293422?s=72&u=2dd877b8540845630912b829038ada345fecbe00&v=4",
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

`data/history/{country}.jsonl`: one line per UTC collection date, containing the date, user count, minimum followers and the three metric leaders. The country summaries power the site trend views.

`data/meta.json`: round-robin checkpoint (index of the next country), last run timestamps per country.

Rules:

- Missing profile fields are `null`.
- `publicContributions` is derived: `totalContributions - privateContributions`.
- Writers use stable keys and formatting. Each successful collection updates the snapshot timestamp and run metadata, even if rankings are unchanged.

## Collection strategy

Two phases per location, shaped by the documented per-query resource limits: the contributionsCollection object is expensive server-side, and a query asking for it on a full 100-user search page is rejected with "resource limits exceeded".

1. Light search: one GraphQL `search(type: USER)` query with `location:` qualifiers for the country and listed cities. `sort:followers-desc` rides inside the query string (verified live against the API). Pages of 100 users collect up to `MAX_USERS = 500` per country with id, login, avatar, profile fields and follower counts.
2. Contributions: `nodes(ids)` lookups in batches of 10, each node returning the contribution calendar total and the restricted (private) count. Public contributions are derived: total minus restricted.

Rankings are three orderings of each country's collected list: followers, public contributions and total contributions (public plus private). The global total sums these country-ranking entries, not distinct accounts, because a profile can match more than one country's search terms. New collections request up to 500 users per country; existing snapshots may contain more.

### Cadence and budgets

- The workflow runs hourly and collects a batch of countries round-robin from the checkpoint in `data/meta.json` (6 per run). A full cycle over all 138 countries completes in about a day.
- Request-count baseline: one live Brazil probe returned 500 unique profiles after 7 search pages and 50 contribution batches of 10. With `first: 100`, five pages would be enough only if each page yields 100 distinct profiles. That probe used 57 GraphQL calls; its point cost was not recorded.
- Official limits: the [GraphQL rate-limit documentation](https://docs.github.com/en/graphql/overview/rate-limits-and-node-limits-for-the-graphql-api) gives `GITHUB_TOKEN` 1,000 points per hour per repository; secondary limits allow no more than 2,000 points per minute and require sequential requests. Six countries per hourly batch is a request-count planning estimate, not a measured point-budget guarantee. The CLI caps manual batches at six and the client honors rate-limit headers.
- Retries honor `retry-after` and `x-ratelimit-reset`; a run whose every country fails exits nonzero so the workflow fails visibly instead of silently skipping data.

## Site

- Astro static output, TypeScript, pnpm, no client framework. Tables render at build time; a small vanilla script handles the metric tab switch and client-side filtering.
- YuTheme v2 (AMOLED default) with the standalone kit CSS: Geist typography, surface ladder, shimmer/rise/lift/glow effects within the per-viewport effect budget.
- Self-hosted flag SVGs, lazy-loaded avatars from the GitHub CDN with shimmer placeholders.
- Routes: home (hero, global stats, country index), one page per country with the three ranking views, an about page documenting methodology with links to the official GitHub docs, and a 404. Sitemap, canonical URLs, Open Graph and JSON-LD.

## Operations

- Pages artifacts are built and uploaded in a read-only build job, then deployed by a separate job using the `github-pages` environment, following [GitHub's custom workflow guidance](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
- Dry runs query the API without writing snapshots, committing data or publishing the site.
- Data commits are made by `github-actions[bot]`; a successful collection updates its country snapshots and checkpoint metadata, even if ranking values do not change.
- Failure handling: rate-limit-aware backoff. Individual country failures are logged and annotated as workflow warnings, following [GitHub's workflow warning command](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands#setting-a-warning-message); the checkpoint advances by the scheduled batch size so the rotation continues. If every country fails, the collection step fails and the checkpoint is not committed.

## Security

- Workflow permissions are scoped by job: collection gets `contents: write`, the build reads repository contents and Pages metadata, and the deployment job gets `pages: write` plus `id-token: write` through the `github-pages` environment.
- Config parsed with schema validation; generated JSON is canonicalized.
- No IP addresses, internal hostnames, tool names or infrastructure details in the repository or the site.

## Toolchain (latest stable at build time)

Node 24 LTS (Krypton), pnpm 12, Astro 7, TypeScript 6.x (newest compatible with `@astrojs/check`), first-party GitHub Actions at their current majors. Pinned per package file; upgrades are deliberate bumps, not drift.
