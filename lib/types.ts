export type Pool = {
  address: string; token0: string; token1: string; symbol0: string; symbol1: string;
  decimals0: number | null; decimals1: number | null; kind: 'V2' | 'Slipstream';
  stable: boolean; tickSpacing: number | null; factory: string;
  block: number; createdAt: number; tx: string;
  mintBlock: number | null; mintAt: number | null; mintTx: string | null;
  amount0: string | null; amount1: string | null;
  mintVerified?: boolean;
};
export type Factory = { address: string; approved: boolean; pools: number };
export type IndexerStatus = {
  state: string; heartbeat: number; head: number; indexed: number; history: number;
  historyTarget: number; startBlock: number; liveStart: number; transport: string;
  error: string | null; historyError: string | null; historyComplete: boolean;
  lastScanAt: number; scanCount: number; pollIntervalMs: number; scanEnabled: boolean; controlUpdatedAt: number;
  lastIndexedAt: number; rpcConfigured: boolean; wsConfigured: boolean;
};
export const OFFLINE_STATUS: IndexerStatus = {
  state: 'offline', heartbeat: 0, head: 0, indexed: 0, history: 0, historyTarget: 0,
  startBlock: 0, liveStart: 0, transport: 'Not connected', error: null, historyError: null,
  historyComplete: false, lastScanAt: 0, scanCount: 0, pollIntervalMs: 2000, scanEnabled: true, controlUpdatedAt: 0,
  lastIndexedAt: 0, rpcConfigured: false, wsConfigured: false,
};
export type Snapshot = {
  pools: Pool[]; factories: Factory[]; status: IndexerStatus;
  stats: { total: number; minted: number; waiting: number; today: number };
  activity: { hour: number; created: number; minted: number }[];
};
