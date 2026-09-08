import { type Address, type PublicClient, erc20Abi, hexToString, parseAbi } from 'viem';
import { REGISTRY, approval, v2Created, clCreated, v2Mint, clMint } from './contracts.ts';
import { db, firstMint, getPool, savePool, rewind, transaction } from './db.ts';
import type { Pool } from './types.ts';

export type ChainClient = Pick<PublicClient, 'getLogs' | 'readContract'> & { getBlock: (args: { blockNumber: bigint }) => Promise<{ hash: string | null; timestamp: bigint }> };
const bytesSymbolAbi = parseAbi(['function symbol() view returns (bytes32)']);
export async function readToken(client: ChainClient, address: Address) {
  const cached = db().prepare('SELECT symbol, decimals FROM tokens WHERE address=?').get(address.toLowerCase()) as { symbol: string; decimals: number | null } | undefined;
  if (cached) return cached;
  const [s, d] = await Promise.allSettled([
    client.readContract({ address, abi: erc20Abi, functionName: 'symbol' }),
    client.readContract({ address, abi: erc20Abi, functionName: 'decimals' }),
  ]);
  let symbol = s.status === 'fulfilled' ? s.value : '';
  if (!symbol) {
    try { symbol = hexToString(await client.readContract({ address, abi: bytesSymbolAbi, functionName: 'symbol' })).replaceAll('\0', ''); } catch {}
  }
  const result = { symbol: symbol.replace(/[\x00-\x1f\x7f]/g, '').slice(0,32) || `${address.slice(0,6)}…`, decimals: d.status === 'fulfilled' ? d.value : null };
  // Retry failed metadata on a later scan; do not permanently cache RPC outages.
  if (symbol && result.decimals !== null) db().prepare('INSERT OR REPLACE INTO tokens VALUES (?,?,?)').run(address.toLowerCase(), result.symbol, result.decimals);
  return result;
}
export async function scanRange(client: ChainClient, from: number, to: number, options: { rewindFrom?: number; beforeRequest?: () => void; beforeCommit?: () => void; commit?: (hash: string) => void } = {}) {
  if (from > to) return;
  options.beforeRequest?.();
  const end = await client.getBlock({ blockNumber: BigInt(to) });
  const range = { fromBlock: BigInt(from), toBlock: BigInt(to) };
  options.beforeRequest?.();
  const approvals = await client.getLogs({ ...range, address: REGISTRY, event: approval, strict: true });
  const discovered = approvals.map(e => e.args.poolFactory.toLowerCase());
  const factories = [...new Set([...(db().prepare('SELECT address FROM factories').all() as {address:string}[]).map(f=>f.address), ...discovered])] as Address[];
  if (!factories.length) throw new Error('No factories have been discovered');
  options.beforeRequest?.();
  const creations = await client.getLogs({ ...range, address: factories, events: [v2Created, clCreated], strict: true });
  const staged = new Map<string, Pool>();
  const timestamps = new Map<number, number>([[to, Number(end.timestamp)]]);
  const at = async (block: number) => {
    if (!timestamps.has(block)) timestamps.set(block, Number((await client.getBlock({ blockNumber: BigInt(block) })).timestamp));
    return timestamps.get(block)!;
  };
  for (const log of creations) {
    options.beforeRequest?.();
    const args = log.args;
    const previous = getPool(args.pool);
    if (previous && (options.rewindFrom === undefined || previous.block < options.rewindFrom)) continue;
    const [t0, t1, createdAt] = await Promise.all([readToken(client, args.token0), readToken(client, args.token1), at(Number(log.blockNumber))]);
    const pool: Pool = { address: args.pool.toLowerCase(), token0: args.token0, token1: args.token1, symbol0: t0.symbol, symbol1: t1.symbol,
      decimals0: t0.decimals, decimals1: t1.decimals, kind: 'tickSpacing' in args ? 'Slipstream' : 'V2', stable: 'stable' in args ? args.stable : false,
      tickSpacing: 'tickSpacing' in args ? args.tickSpacing : null, factory: log.address.toLowerCase(), block: Number(log.blockNumber), createdAt, tx: log.transactionHash,
      mintBlock: null, mintAt: null, mintTx: null, amount0: null, amount1: null };
    staged.set(pool.address, pool);
  }
  const waiting = [...new Set([...(db().prepare('SELECT address FROM pools WHERE block<=? AND (mintBlock IS NULL OR mintBlock>=?)').all(to, from) as {address:Address}[]).map(p=>p.address), ...staged.keys()])] as Address[];
  const deposits: { address: string; block: number; at: number; tx: string; amount0: string; amount1: string }[] = [];
  for (let i=0; i<waiting.length; i+=100) {
    options.beforeRequest?.();
    const logs = await client.getLogs({ ...range, address: waiting.slice(i,i+100), events: [v2Mint,clMint], strict:true });
    logs.sort((a,b) => Number(a.blockNumber-b.blockNumber) || a.logIndex-b.logIndex);
    for (const log of logs) {
      options.beforeRequest?.();
      const address = log.address.toLowerCase();
      const pool = staged.get(address) || getPool(address);
      if (!pool || Number(log.blockNumber) < pool.block || (pool.kind === 'V2') === ('owner' in log.args)) continue;
      if (log.args.amount0 === 0n && log.args.amount1 === 0n) continue;
      deposits.push({ address, block: Number(log.blockNumber), at: await at(Number(log.blockNumber)), tx: log.transactionHash, amount0: log.args.amount0.toString(), amount1: log.args.amount1.toString() });
    }
  }
  // Do not commit logs collected across a changing canonical chain.
  options.beforeRequest?.();
  if ((await client.getBlock({ blockNumber: BigInt(to) })).hash !== end.hash) throw new Error('Chain changed during scan');
  transaction(() => {
    options.beforeCommit?.();
    if (options.rewindFrom !== undefined) rewind(options.rewindFrom);
    for (const address of discovered) db().prepare('INSERT OR IGNORE INTO factories VALUES (?,0)').run(address);
    for (const pool of staged.values()) if (!getPool(pool.address)) savePool(pool);
    for (const deposit of deposits) { const pool=getPool(deposit.address); if (pool) firstMint(pool,deposit); }
    options.commit?.(end.hash!);
  });
  return { created: staged.size, mints: deposits.length };
}
