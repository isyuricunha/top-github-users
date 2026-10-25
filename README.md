# Top GitHub Users

Live rankings of the most followed and most active GitHub users per country, built on the official GitHub GraphQL API and refreshed through hourly country batches. The site lives at [isyuricunha.github.io/top-github-users](https://isyuricunha.github.io/top-github-users/).

The dataset currently covers **138 countries and 677 configured city query entries** with **122,799 country-ranking entries**. The global total sums country-ranking entries, not distinct GitHub accounts, because the same profile can match more than one country's location queries.

## What is ranked

For each country the pipeline tracks users whose profile location matches the country or one of its listed cities in [config.json](config.json), ordered by followers. New collections cap the result at 500 users per country; existing snapshots may contain more. Each tracked user carries three metrics:

| Metric | Definition |
| --- | --- |
| Followers | `followers.totalCount` |
| Total contributions | contribution calendar total for the last year, public plus private |
| Public contributions | calendar total minus the restricted (private) count |

Each country page presents the profiles in its snapshot ordered three ways: by followers, by public contributions, and by total contributions. Raw snapshots are served as JSON at `/data/{country}.json` on the site, for example [/data/brazil.json](https://isyuricunha.github.io/top-github-users/data/brazil.json), and the definitions come straight from the [GitHub GraphQL API documentation](https://docs.github.com/en/graphql).

## How it works

- `pipeline/` is a dependency-free TypeScript collector. Per country it runs a light user search ordered by followers (the `sort:followers-desc` qualifier inside the search query string), then fetches contribution counts through `nodes()` lookups in small batches, because the API rejects heavy contribution fields on full search pages.
- An hourly scheduled [workflow](.github/workflows/rankings.yml) collects a round-robin batch of six countries per run using only the repository's built-in `GITHUB_TOKEN`, subject to the [official GraphQL rate limits](https://docs.github.com/en/graphql/overview/rate-limits-and-node-limits-for-the-graphql-api). It commits the collected batch and checkpoint, then deploys the site.
- `data/current/` holds one canonical snapshot per country, `data/history/` one summary line per collection day, and `data/meta.json` the round-robin checkpoint. Every successful batch refreshes the collected snapshots and checkpoint metadata, even when ranking values stay the same. Only the batch's country files and metadata change, not every country file.
- `site/` is a static Astro 7 site that renders every country page at build time. No client framework or analytics scripts; profile avatars load from GitHub's CDN.

The collection cadence, API budget math and data contract are documented in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Development

Requires Node 24 LTS and pnpm 12.

```sh
pnpm install                # workspace install
pnpm lint                   # ESLint 10 across pipeline and site
pnpm --filter @top-github-users/pipeline typecheck
pnpm --filter @top-github-users/pipeline test
pnpm site:build             # builds site/dist (local preview via pnpm --filter @top-github-users/site preview)
```

The CLI caps manual round-robin batches at six countries, matching the scheduled workload budget. The workflow&rsquo;s `dry_run` input queries data without writing snapshots, committing, building or deploying the site. For local collection, set `GITHUB_TOKEN` to a token with public read access:

```sh
export GITHUB_TOKEN='<read-only-token>'
node pipeline/src/cli.ts collect --country brazil          # single country
node pipeline/src/cli.ts collect --countries 6             # round-robin batch
node pipeline/src/cli.ts collect --country brazil --dry-run
```

## History

The initial migrated snapshots retain their country-specific collection dates, ranging from October 6, 2025 through January 28, 2026. January 28 is the newest seed date; each country has its own timestamp.

## License

[AGPL-3.0](LICENSE). Data comes from public GitHub profiles through the public GitHub API.
