export interface LocationConfig {
  country: string;
  geoName: string;
  cities: string[];
  imageUrl: string;
}

export interface RootConfig {
  devMode: boolean;
  locations: LocationConfig[];
}

export interface RankedUser {
  login: string;
  name: string | null;
  avatarUrl: string;
  location: string | null;
  company: string | null;
  twitterUsername: string | null;
  followers: number;
  totalContributions: number;
  privateContributions: number;
  publicContributions: number;
}

export interface CountrySnapshot {
  country: string;
  geoName: string;
  cities: string[];
  collectedAt: string;
  minimumFollowers: number;
  users: RankedUser[];
}

export interface MetricLeader {
  login: string;
  value: number;
}

export interface HistoryEntry {
  date: string;
  collectedAt: string;
  users: number;
  minimumFollowers: number;
  leaders: {
    followers: MetricLeader | null;
    totalContributions: MetricLeader | null;
    publicContributions: MetricLeader | null;
  };
}

export interface PipelineMeta {
  checkpoint: number;
  lastRunAt: string | null;
  countries: Record<string, { lastCollectedAt: string | null }>;
}
