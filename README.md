# Top GitHub Users

Live rankings of the most followed and most active GitHub users per country, built on the official GitHub GraphQL API and refreshed every day. The site lives at [isyuricunha.github.io/top-github-users](https://isyuricunha.github.io/top-github-users/).

The dataset currently tracks **138 countries and 677 cities** with **122,799 ranked users**, and grows or shrinks as profiles and locations change.

## What is ranked

For each country the pipeline tracks users whose profile location matches the country or one of its listed cities in [config.json](config.json), ordered by followers, capped at 500 users per country. Every tracked user carries three metrics:

| Metric | Definition |
| --- | --- |
| Followers | `followers.totalCount` |
| Total contributions | contribution calendar total for the last year, public plus private |
| Public contributions | calendar total minus the restricted (private) count |

Each country page presents the same tracked set ordered three ways: by followers, by public contributions, and by total contributions. Raw snapshots are served as JSON at `/data/{country}.json` on the site, for example [/data/brazil.json](https://isyuricunha.github.io/top-github-users/data/brazil.json), and the definitions come straight from the [GitHub GraphQL API documentation](https://docs.github.com/en/graphql).

## How it works

- `pipeline/` is a dependency-free TypeScript collector. Per country it runs a light user search ordered by followers (the `sort:followers-desc` qualifier inside the search query string), then fetches contribution counts through `nodes()` lookups in small batches, because the API rejects heavy contribution fields on full search pages.
- An hourly scheduled [workflow](.github/workflows/rankings.yml) collects a round-robin batch of six countries per run using only the repository's built-in `GITHUB_TOKEN` (1,000 GraphQL points per hour per repository, per the documented limits), commits snapshots that actually changed, and redeploys the site.
- `data/current/` holds one canonical snapshot per country, `data/history/` one summary line per collection day, and `data/meta.json` the round-robin checkpoint. Snapshots are written with stable key order and stable formatting, so unchanged days produce no diff and the repository stays small.
- `site/` is a static Astro 7 site that renders every country page at build time. No client framework, no tracking, no external scripts.

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

To collect data locally you need a GitHub token with public read access:

```sh
export GITHUB_TOKEN=ghp_...
node pipeline/src/cli.ts collect --country brazil          # single country
node pipeline/src/cli.ts collect --countries 6             # round-robin batch
node pipeline/src/cli.ts collect --country brazil --dry-run
```

## History

The dataset was seeded from this repository's earlier frozen dataset (last collected on 2026-01-28, per-country dates preserved in the snapshots) and continues from there with the current pipeline. The repository history was reset on 2026-10-25 to a single snapshot commit, which removed the multi-gigabyte commit history that daily full-file rewrites had accumulated.

## License

[AGPL-3.0](LICENSE). Data comes from public GitHub profiles through the public GitHub API.
