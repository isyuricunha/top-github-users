import type { CountrySnapshot, HistoryEntry, MetricLeader, RankedUser } from './types.ts';

function leader(users: RankedUser[], value: (u: RankedUser) => number): MetricLeader | null {
  if (users.length === 0) return null;
  let best = users[0];
  for (const user of users) {
    if (value(user) > value(best)) best = user;
  }
  return { login: best.login, value: value(best) };
}

export function partialCollectionWarning(failures: number, attempted: number): string {
  return `::warning title=Partial collection::${failures} of ${attempted} country collections failed. See per-country logs.`;
}

/** Daily history summary derived from a completed snapshot. */
export function historyEntryFromSnapshot(snapshot: CountrySnapshot): HistoryEntry {
  return {
    date: snapshot.collectedAt.slice(0, 10),
    collectedAt: snapshot.collectedAt,
    users: snapshot.users.length,
    minimumFollowers: snapshot.minimumFollowers,
    leaders: {
      followers: leader(snapshot.users, (u) => u.followers),
      totalContributions: leader(snapshot.users, (u) => u.totalContributions),
      publicContributions: leader(snapshot.users, (u) => u.publicContributions),
    },
  };
}
