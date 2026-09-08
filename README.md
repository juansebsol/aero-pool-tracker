# Aerowatch

A local Next.js app for tracking Aerodrome pool creation and first liquidity on Base. Real on-chain data only. Uses npm, viem and Node's built-in SQLite; no Turso, wallet key, hosted database, or third-party pool index is required.

## Run

Requires **Node.js 24+**.

```sh
npm install
npm run dev
```

`npm run dev` starts the Next.js dashboard and persistent indexer together. Open the localhost URL printed by Next.js. Use **Start scanning / Stop scanning** at the top of the dashboard. While on, the scanner follows each new Base block over WebSocket with a 2-second HTTP polling fallback. The last-scan age, scan count, and indexed block show that it is active, even when no new pool has been created. The 24-hour setting is only historical coverage, never a scan schedule.

Stop pauses live scanning, historical backfill, and the block subscription, and preserves all data/checkpoints. Start resumes and catches up on missed blocks. A scan already in flight may finish its network request, but a stopped batch cannot commit. The setting persists across reloads and worker restarts. Closing the browser does not stop scanning. Keep the local server/worker running. If the worker is offline, Start launches it from the local server. Such a worker can outlive the server terminal; use Stop scanning before closing the app when you want all scanning paused.

Production:

```sh
npm run build
npm start
```

If a dashboard is already running, `npm run indexer` starts only the worker. `npm run dev:web` and `npm run start:web` start only Next.js. One worker may write to a database at a time. A lease prevents accidental duplicate workers; after a crash it expires in 30 seconds.

## Configuration

Copy `.env.example` to `.env.local` when setting up a new checkout. This checkout already has the supplied Alchemy endpoints configured in the ignored `.env.local` file. Never commit that file or put RPC credentials in `NEXT_PUBLIC_` variables.

| Variable | Default | Purpose |
| --- | --- | --- |
| `BASE_HTTP_RPC_URL` | `https://mainnet.base.org` | Base mainnet reads and live logs |
| `BASE_WS_RPC_URL` | unset | Base new-block subscription; HTTP polling is the fallback |
| `BASE_HISTORY_RPC_URL` | `https://mainnet.base.org` | Historical scans and large reconnect catch-up |
| `DATABASE_PATH` | `./data/aerodrome.sqlite` | Local SQLite database |
| `RECENT_BLOCKS` | `43200` | Initial historical window, approximately one day |
| `START_BLOCK` | unset | Explicit initial history start; `0` requests all history |
| `BLOCK_CHUNK` | `2000` | Maximum batch size; log queries split to provider limits |
| `POLL_INTERVAL_MS` | `2000` | HTTP fallback interval |
| `REORG_DEPTH` | `20` | Safety distance for historical handover |

Alchemy's supplied plan was verified to allow only 10-block `eth_getLogs` queries. Live queries automatically split to comply. The public endpoint handles background history without consuming the Alchemy log-query allowance. No speed/uptime guarantee is made for either provider. You can set `BASE_HISTORY_RPC_URL` to a dedicated endpoint if needed. Endpoints must serve Base mainnet, chain 8453.

### Coverage

The default is **the initial recent window plus every newly created pool thereafter**, across dynamically discovered factories. The dashboard shows the start block and backfill progress. This keeps a personal sniping/discovery monitor small and gets it current quickly.

For all historical pools, stop the app and set `START_BLOCK=0` plus a **new** `DATABASE_PATH` in `.env.local`, then restart. This performs a resumable historical scan and takes substantially more time/RPC traffic. Keep the previous file until the new index is complete. START_BLOCK/RECENT_BLOCKS are applied only when initializing a new database; restarting never silently discards or resets existing coverage.

SQLite stores data in one main file. Its `-wal` and `-shm` sidecars are temporary concurrency files, not separate databases. Shut down both processes before copying the database for a backup, or use SQLite's backup tools. Data, credentials, build artifacts, and dependency folders are ignored by Git. Pool history is retained; this file will grow with the number of pools rather than every swap or block.

## Dashboard

- All indexed pools are searchable by exact token/pool address or symbol.
- V2 stable/volatile and Slipstream filters; oldest/newest ordering; pagination.
- First nonzero mint status and exact integer deposit amounts, formatted using token decimals.
- WETH/USDC quote filters with a minimum first deposit. Quote tokens match **contract addresses**, so a spoofed symbol cannot satisfy the filter.
- Pool details show creation/mint transactions, token contract links, and current V2 reserves or CL token balances and in-range liquidity. Current-state reads are pinned to one block and refreshed on demand.
- Browser-local watchlist and opt-in in-app first-mint notifications. Notifications use the current token search, quote and minimum-deposit filters, require a recent verified first mint, and work while the tab/feed is running. No email, Telegram, OS notifications, or automatic trades.
- CSV export of the current filtered pool set. Raw amounts retain full precision.
- SQLite/API updates reach the browser over Server-Sent Events, with polling as a fallback.

## Indexing behavior

1. Read all currently approved pool factories from the registry and refresh the set every minute. Retain historically discovered approvals, including factories later unapproved.
2. Subscribe to Base blocks over WebSocket. Fetch canonical V2 and Slipstream `PoolCreated` logs through HTTP; recover missing ranges after interruptions.
3. Scan both Mint signatures for known/new pools, including the creation block itself. Ignore all-zero deposits. Metadata failures fall back to the contract address and unknown decimals rather than fabricated values.
4. Commit a complete scanned batch and its checkpoint atomically. Failed requests do not advance checkpoints. Replayed logs are idempotent, and history can replace a later mint with an earlier one.
5. Follow live blocks independently of historical backfill. Replay the history/live handover interval so older pools discovered late do not lose their initial mint.
6. Verify canonical endpoint hashes before committing. Compare saved block anchors on live passes, roll back orphaned pools/mints on a detected reorg, and halt if no retained common anchor can be found. Recent events are provisional; this is not a finalized-chain guarantee.

A first Mint is **not** current TVL, a USD valuation, token deployment age, proof of a safe token, or proof of usable liquidity. CL positions can be one-sided or out of range. Current reserves/balances are available in details. This app observes creation and funding; it does not execute snipes or determine whether a token is genuinely newly deployed.

## Verification

```sh
npm test
npm run typecheck
npm run build
```

Tests also cover persistent scanner controls, invalidating in-flight work on stop, and preserving data on restart. Tests cover V2/CL decoding, same-transaction create+mint, idempotency, failed-batch rollback, changing block hashes, historical ordering, zero/one-sided deposits, reorg rollback and contract-address deposit filters. Live verification covered factory discovery, HTTP/WebSocket connectivity, chain-head catch-up, real creation/mint events, current pool reserves, exact-address search, minimum deposit exclusion, and adding/removing a watchlist entry.

## Contract sources

- [Factory registry and deployment addresses](https://github.com/aerodrome-finance/contracts)
- [V2 PoolCreated interface](https://github.com/aerodrome-finance/contracts/blob/main/contracts/interfaces/factories/IPoolFactory.sol)
- [V2 pool and Mint interface](https://github.com/aerodrome-finance/contracts/blob/main/contracts/interfaces/IPool.sol)
- [Slipstream factory interface](https://github.com/aerodrome-finance/slipstream/blob/main/contracts/core/interfaces/ICLFactory.sol)
- [Slipstream Mint interface](https://github.com/aerodrome-finance/slipstream/blob/main/contracts/core/interfaces/pool/ICLPoolEvents.sol)
