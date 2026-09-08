'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pulse, ArrowDown, ArrowDownRight, ArrowRight, ArrowSquareOut, ArrowsClockwise, Bell, BookOpen, CaretDown, CaretLeft, CaretRight, Check, CheckCircle, CirclesThree, Clock, Copy, Database, DownloadSimple, Funnel, GearSix, GlobeHemisphereWest, Info, MagnifyingGlass, Pause, Play, Plus, Radio, SlidersHorizontal, Star, Stack, Waves, X } from '@phosphor-icons/react';
import ScannerControls from '@/components/scanner-controls';
import PoolState from '@/components/pool-state';
import { matchesDeposit, quoteDeposit, QUOTES, type Quote } from '@/lib/signals';
import type { Pool, Snapshot } from '@/lib/types';
import { age, amount, csvCell, short } from '@/lib/format';
type View = 'All pools' | 'Watchlist' | 'Factories' | 'Event log';
const colors: Record<string, string> = { WETH: '#72849c', USDC: '#2775ca', AERO: '#154cff', cbBTC: '#ed922b', BRETT: '#4ba4ff', DEGEN: '#905cdf', VIRTUAL: '#3b8d88', EURC: '#2b71ba', CLANKER: '#bbbcbb', cbETH: '#254edb', TOSHI: '#2b55df', DAI: '#d9a847', MORPHO: '#367cef', WELL: '#8a70c6', USDbC: '#3479bc' };
function Token({ symbol, small = false }: {
    symbol: string;
    small?: boolean;
}) { return <span className={`token ${small ? 'small' : ''}`} style={{ background: colors[symbol] || '#4c6966' }}>{symbol.includes('ETH') ? 'Ξ' : symbol === 'USDC' || symbol === 'USDbC' ? '$' : symbol.includes('BTC') ? '₿' : symbol.slice(0, 1)}</span>; }
function Pair({ pool }: {
    pool: Pool;
}) { return <div className="pair"><div className="token-pair"><Token symbol={pool.symbol0}/><Token symbol={pool.symbol1}/></div><div><strong>{pool.symbol0} <span className="pair-slash">/</span> {pool.symbol1}</strong><span className="sub mono">{short(pool.address)}</span></div></div>; }
function Badge({ minted }: {
    minted: boolean;
}) { return <span className={`badge ${minted ? 'green' : 'amber'}`}><span className="dot"/>{minted ? 'Mint observed' : 'Awaiting mint'}</span>; }
export default function Dashboard() {
    const [live, setLive] = useState<Snapshot | null>(null);
    const [error, setError] = useState('');
    const [view, setView] = useState<View>('All pools');
    const [query, setQuery] = useState('');
    const [kind, setKind] = useState('All types');
    const [mint, setMint] = useState('All statuses');
    const [sort, setSort] = useState('Newest first');
    const [quote, setQuote] = useState<Quote | 'Any'>('Any');
    const [minimum, setMinimum] = useState('0');
    const [range, setRange] = useState('24h');
    const [page, setPage] = useState(0);
    const [stars, setStars] = useState<string[]>([]);
    const [now, setNow] = useState(0);
    const [modal, setModal] = useState<'setup' | 'about' | 'alerts' | Pool | null>(null);
    const [copied, setCopied] = useState('');
    const [toast, setToast] = useState('');
    const [alerts, setAlerts] = useState(false);
    const [loading, setLoading] = useState(false);
    const dialog = useRef<HTMLDialogElement>(null);
    const seen = useRef<Set<string> | null>(null);
    const data = live;
    const fetching = useRef(false);
    const fetchLive = useCallback(async () => {
        if (fetching.current) return;
        fetching.current = true;
        setLoading(true);
        try {
            const response = await fetch('/api/pools', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
            if (!response.ok)
                throw new Error('Pool data is temporarily unavailable.');
            const result: Snapshot = await response.json();
            setLive(result);
            setError('');
        }
        catch {
            setError('Could not refresh pool data. Check the server and try again.');
        }
        finally {
            fetching.current = false;
            setLoading(false);
        }
    }, []);
    useEffect(() => {
        setNow(Date.now());
        try {
            setAlerts(localStorage.getItem('aerowatch-alerts') === 'true');
            const saved = JSON.parse(localStorage.getItem('aerowatch-stars') || '[]');
            if (Array.isArray(saved))
                setStars(saved.filter(v => typeof v === 'string'));
        }
        catch { }
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, []);
    useEffect(() => {
        void fetchLive();
        const stream = new EventSource('/api/stream');
        stream.onmessage = () => { void fetchLive(); };
        // Poll as a backup when a proxy or background tab interrupts SSE.
        const timer = setInterval(fetchLive, 10000);
        return () => { stream.close(); clearInterval(timer); };
    }, [fetchLive]);
    useEffect(() => { setModal(current => current && typeof current === 'object' ? live?.pools.find(p => p.address === current.address) || current : current); }, [live]);
    useEffect(() => { if (modal)
        { if (!dialog.current?.open) dialog.current?.showModal(); }
    else
        dialog.current?.close(); }, [modal]);
    useEffect(() => { if (!toast)
        return; const timer = setTimeout(() => setToast(''), 3000); return () => clearTimeout(timer); }, [toast]);
    useEffect(() => {
        if (!live) {
            seen.current = null;
            return;
        }
        const ids = new Set(live.pools.filter(p => p.mintBlock !== null).map(p => p.address));
        if (alerts && seen.current)
            for (const p of live.pools)
                if (ids.has(p.address) && !seen.current.has(p.address) && p.mintAt && p.mintAt > Date.now() / 1000 - 60 && p.mintVerified && matchesDeposit(p, quote, minimum) && `${p.token0} ${p.token1} ${p.symbol0} ${p.symbol1} ${p.address}`.toLowerCase().includes(query.toLowerCase()))
                    setToast(`First mint observed: ${p.symbol0} / ${p.symbol1}`);
        seen.current = ids;
    }, [live, alerts, quote, minimum, query]);
    const toggleStar = (address: string) => setStars(prev => { const next = prev.includes(address) ? prev.filter(a => a !== address) : [...prev, address]; try {
        localStorage.setItem('aerowatch-stars', JSON.stringify(next));
    }
    catch {
        setToast('Browser storage is unavailable. Watchlist saved for this session.');
    } return next; });
    const filtered = useMemo(() => (data?.pools || []).filter(p => (view !== 'Watchlist' || stars.includes(p.address)) &&
        (kind === 'All types' || (kind === 'Slipstream' ? p.kind === 'Slipstream' : kind === 'V2 stable' ? p.kind === 'V2' && p.stable : p.kind === 'V2' && !p.stable)) &&
        (mint === 'All statuses' || (mint === 'Mint observed' ? p.mintBlock !== null : p.mintBlock === null)) &&
        matchesDeposit(p, quote, minimum) && `${p.symbol0} ${p.symbol1} ${p.address} ${p.token0} ${p.token1}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => sort === 'Newest first' ? b.block - a.block : a.block - b.block), [data, view, stars, kind, mint, query, sort, quote, minimum]);
    useEffect(() => setPage(0), [query, kind, mint, view, sort, quote, minimum]);
    const totalPages = Math.max(1, Math.ceil(filtered.length / 8));
    const safePage = Math.min(page, totalPages - 1);
    const visible = filtered.slice(safePage * 8, safePage * 8 + 8);
    const fresh = !!data && now - data.status.heartbeat < 30000 && now - data.status.lastScanAt < 30000 && data.status.scanEnabled && ['live', 'syncing'].includes(data.status.state);
    const statusLabel = data?.status.scanEnabled === false ? 'Scanner stopped' : fresh ? data?.status.state === 'syncing' ? 'Catching up' : 'Connected' : 'Disconnected';
    const stat = data?.stats || { total: 0, minted: 0, waiting: 0, today: 0 };
    const activity = (data?.activity || []).slice(range === '1h' ? -1 : range === '6h' ? -6 : 0);
    const max = Math.max(1, ...activity.flatMap(a => [a.created, a.minted]));
    const exportCsv = () => {
        const headers = ['pool', 'token0', 'token1', 'type', 'factory', 'creation_block', 'first_mint_block', 'amount0_raw', 'amount1_raw'];
        const rows = filtered.map(p => [p.address, p.token0, p.token1, p.kind, p.factory, p.block, p.mintBlock, p.amount0, p.amount1].map(csvCell).join(','));
        const url = URL.createObjectURL(new Blob([[headers.join(','), ...rows].join('\r\n')], { type: 'text/csv;charset=utf-8;' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `aerowatch-pools.csv`;
        a.click();
        URL.revokeObjectURL(url);
        setToast(`Exported ${filtered.length} pools`);
    };
    const copy = async (text: string) => { try {
        await navigator.clipboard.writeText(text);
        setCopied(text);
        setTimeout(() => setCopied(''), 2000);
    }
    catch {
        setToast('Clipboard unavailable. Select and copy the address below.');
    } };
    const nav = (v: View) => { setView(v); setQuery(''); };
    return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="Aerowatch home"><span className="brand-mark"><Waves size={25} weight="bold"/></span>aerowatch<span className="brand-dot">.</span></a>
      <div className="workspace"><span className="base-symbol"/><div>Base Mainnet<span className="sub">Aerodrome Finance</span></div><CaretDown size={13}/></div>
      <span className="nav-label">WORKSPACE</span>
      <nav>
        {([['All pools', CirclesThree], ['Watchlist', Star], ['Event log', Pulse], ['Factories', Stack]] as const).map(([name, Icon]) => <button key={name} className={`nav-item ${view === name ? 'selected' : ''}`} onClick={() => nav(name)}><Icon size={19} weight={view === name ? 'fill' : 'regular'}/>{name}{name === 'All pools' ? <span className="nav-count">{stat.total}</span> : name === 'Watchlist' && stars.length > 0 ? <span className="nav-count">{stars.length}</span> : null}</button>)}
      </nav>
      <div className="sidebar-bottom"><div className="chain-card"><span className="chain-icon"><Radio size={20}/></span><strong>Direct from the chain.</strong><p>Pool creation. First liquidity.<br />One step closer to the source.</p><button onClick={() => setModal('about')}>How it works <ArrowUpRight /></button></div>
      <button className="nav-item" onClick={() => setModal('about')}><BookOpen size={19}/>Documentation<ArrowSquareOut size={14} className="push"/></button>
      <button className="nav-item" onClick={() => setModal('setup')}><GearSix size={19}/>Connection settings</button>
      <div className="sidebar-foot"><span className="dot"/>Built on Base <span className="push">v1.0</span></div></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb">Workspace <span>/</span><strong>{view}</strong></div><div className="top-actions"><span className={`connection ${fresh ? 'green' : ''}`}><span className="dot"/>{statusLabel}</span><span className="top-divider"/><button className="icon-button" aria-label="Alert preferences" onClick={() => setModal('alerts')}><Bell size={19}/>{alerts && <span className="notification-dot"/>}</button><button className="avatar" onClick={() => setModal('setup')} aria-label="Open settings">AW</button></div></header>
      <main>
        <div className="page-heading"><div><div className="eyebrow"><span className="base-symbol"/> AERODROME INTELLIGENCE</div><h1>{view === 'All pools' ? 'Every pool. From the first block.' : view === 'Watchlist' ? 'Your pools, in focus.' : view === 'Factories' ? 'Complete factory coverage.' : 'Follow the on-chain trail.'}</h1><p>{view === 'Factories' ? 'Discover approved factories directly from Aerodrome’s registry.' : 'Track new pools and their first liquidity, directly on Base.'}</p></div><button className="button" onClick={exportCsv}><DownloadSimple size={16}/>Export data</button></div>
        <ScannerControls status={data?.status} now={now} onStatus={status => setLive(current => current ? {...current,status} : current)}/>
        <p className="scan-explainer">New pools appear automatically as blocks arrive. “24h” is a history view, not a scan schedule.</p>
        {error && <div className="error-banner" role="alert">{error}<button onClick={fetchLive}>Retry</button></div>}
        {data?.status.error && <div className="error-banner" role="alert">{data.status.error}</div>}
        {data?.status.historyError && <div className="error-banner" role="status">{data.status.historyError}</div>}
        <section className="stats-grid" aria-label="Pool statistics">
          {[{ label: 'Pools indexed', value: stat.total, foot: 'Across discovered factories', icon: CirclesThree }, { label: 'New pools · 24h', value: stat.today, foot: 'Creation events observed', icon: Plus }, { label: 'First mint observed', value: stat.minted, foot: 'With a nonzero liquidity addition', icon: Waves }, { label: 'Awaiting first mint', value: stat.waiting, foot: 'No mint in indexed history', icon: Clock }].map((s, i) => <div className="stat" key={s.label}><div className="stat-label">{s.label}<s.icon size={17}/></div><div className="stat-number">{s.value.toLocaleString()} </div><div className="stat-foot"><span className={i === 2 ? 'green-text' : ''}>{i === 2 && <CheckCircle size={12}/>} {s.foot}</span></div></div>)}
        </section>
        <div className="content-grid"><div className="primary-content">
        <section className="panel activity-panel"><div className="panel-heading"><div><h2>Pool activity <span className="muted">/</span> <span className="normal">{range === '24h' ? 'Last 24 hours' : `Last ${range}`}</span></h2></div><div className="segmented">{['1h', '6h', '24h'].map(r => <button key={r} className={range === r ? 'active' : ''} onClick={() => setRange(r)}>{r}</button>)}</div></div><div className="chart-meta"><span><i className="legend-created"/>Pools created</span><span><i className="legend-minted"/>First mint</span><span className="chart-note">{'UTC · indexed events'}</span></div><div className="chart"><div className="chart-y"><span>{max}</span><span>{Math.round(max / 2)}</span><span>0</span></div><div className="plot"><div className="gridline one"/><div className="gridline two"/><div className="gridline three"/><div className="bars">{activity.map((a, i) => <div className="bar-group" key={a.hour} title={`${new Date(a.hour * 3600000).toISOString().slice(11, 16)} UTC: ${a.created} created, ${a.minted} first mints`}><div className="bar created" style={{ height: `${a.created / max * 100}%` }}/><div className="bar minted" style={{ height: `${a.minted / max * 100}%` }}/><span className="x-label">{i % Math.max(1, Math.floor(activity.length / 6)) === 0 ? `${String(a.hour % 24).padStart(2, '0')}:00` : ''}</span></div>)}</div>{!activity.length && <div className="chart-empty">Activity appears as blocks are indexed</div>}</div></div></section>
        <section className="panel pools-panel">
          <div className="pool-title"><div><h2>{view === 'All pools' ? 'Pool explorer' : view} <span className="count-badge">{view === 'Factories' ? data?.factories.length || 0 : filtered.length}</span></h2><p>{view === 'Factories' ? 'Current approvals and historical factory coverage.' : view === 'Event log' ? 'Creation and first-mint events for indexed pools.' : 'Discover what’s new. Know when liquidity arrives.'}</p></div><span className={`stream-toggle ${data?.status.scanEnabled === false ? 'paused' : ''}`}><span className="dot"/>{data?.status.scanEnabled === false ? 'Scanner stopped' : fresh ? 'Live results' : 'Waiting for scanner'}</span></div>
          {view !== 'Factories' && <><div className="pool-tabs"><button className={mint === 'All statuses' ? 'active' : ''} onClick={() => setMint('All statuses')}>All pools <span>{data?.pools.length || 0}</span></button><button className={mint === 'Mint observed' ? 'active' : ''} onClick={() => setMint('Mint observed')}>Mint observed</button><button className={mint === 'Awaiting mint' ? 'active' : ''} onClick={() => setMint('Awaiting mint')}>Awaiting mint</button></div><div className="filters"><label className="search"><MagnifyingGlass size={17}/><input placeholder="Search token or pool address…" aria-label="Search pools" value={query} onChange={e => setQuery(e.target.value)}/>{query && <button className="icon-button" aria-label="Clear search" onClick={() => setQuery('')}><X size={14}/></button>}</label><label className="select-wrap"><Funnel size={14}/><select aria-label="Pool type" value={kind} onChange={e => setKind(e.target.value)}>{['All types', 'Slipstream', 'V2 volatile', 'V2 stable'].map(v => <option key={v}>{v}</option>)}</select></label><label className="select-wrap"><select aria-label="Quote token" value={quote} onChange={e => setQuote(e.target.value as Quote | 'Any')}><option value="Any">Any quote</option><option value="WETH">WETH</option><option value="USDC">USDC</option></select></label>{quote !== 'Any' && <label className="minimum-input">Min {quote}<input aria-label="Minimum first deposit" inputMode="decimal" value={minimum} onChange={e => { if (/^\d*(\.\d*)?$/.test(e.target.value)) setMinimum(e.target.value); }}/></label>}<button className="icon-button refresh" aria-label="Refresh pool data" onClick={() => fetchLive()}><ArrowsClockwise size={17} className={loading ? 'spin' : ''}/></button></div></>}
          {view === 'Factories' ? <div className="factory-list">{data?.factories.map((f, i) => <div className="factory-row" key={f.address}><span className="factory-icon"><Stack size={20}/></span><div><strong>{short(f.address)}</strong><span className="sub mono">{short(f.address)}</span></div><span className={`badge ${f.approved ? 'green' : 'amber'}`}>{f.approved ? 'Approved' : 'Historical'}</span><span className="push">{f.pools} pools</span>{<a aria-label="View factory on Basescan" href={`https://basescan.org/address/${f.address}`} target="_blank" rel="noreferrer"><ArrowSquareOut size={16}/></a>}</div>)}{!data?.factories.length && <Empty title="No factories discovered yet" text="Start the indexer to read the on-chain factory registry."/>}</div> :
            view === 'Event log' ? <div className="event-list">{visible.map(p => <button className="event-row" key={p.address} onClick={() => setModal(p)}><span className="event-icon"><Plus size={17}/></span><div><strong>{p.symbol0} / {p.symbol1}</strong><span className="sub">Pool created at block {p.block.toLocaleString()}</span>{p.mintBlock !== null && <span className="sub green-text">First mint at block {p.mintBlock.toLocaleString()}</span>}</div><span className="push mono muted">{age(p.createdAt, now || Date.now())}</span><CaretRight size={15}/></button>)}{!visible.length && <Empty title="No matching events" text="Try another search or wait for the indexer to discover pools."/>}</div> :
                <div className="table-scroll"><table><thead><tr><th className="star-cell"/><th>Pool / address</th><th>Type</th><th>First liquidity</th><th><button className="sort-button" onClick={() => setSort(sort === 'Newest first' ? 'Oldest first' : 'Newest first')}>Created <ArrowDown size={12} style={{ transform: sort === 'Oldest first' ? 'rotate(180deg)' : undefined }}/></button></th><th /></tr></thead><tbody>{visible.map(p => <tr key={p.address}><td className="star-cell"><button className={`star-button ${stars.includes(p.address) ? 'starred' : ''}`} aria-label={`${stars.includes(p.address) ? 'Unwatch' : 'Watch'} ${p.symbol0} / ${p.symbol1}`} onClick={() => toggleStar(p.address)}><Star size={16} weight={stars.includes(p.address) ? 'fill' : 'regular'}/></button></td><td><button className="pair-button" onClick={() => setModal(p)}><Pair pool={p}/></button></td><td><span className={`type-label ${p.kind === 'Slipstream' ? 'cl' : ''}`}>{p.kind === 'Slipstream' ? 'Slipstream' : p.stable ? 'V2 · Stable' : 'V2 · Volatile'}</span><span className="sub">{p.tickSpacing !== null ? `Tick spacing ${p.tickSpacing}` : 'Classic AMM'}</span></td><td><Badge minted={p.mintBlock !== null}/>{p.mintBlock !== null && <span className="sub deposit-amount">{quoteDeposit(p,'WETH') !== null ? `${amount(quoteDeposit(p,'WETH'),18)} WETH` : quoteDeposit(p,'USDC') !== null ? `${amount(quoteDeposit(p,'USDC'),6)} USDC` : `${amount(p.amount0,p.decimals0)} ${p.symbol0}`}</span>}</td><td><span className="age">{age(p.createdAt, now || Date.now())}</span><span className="sub mono">#{p.block.toLocaleString()}</span></td><td><button className="icon-button" aria-label={`View ${p.symbol0} / ${p.symbol1} details`} onClick={() => setModal(p)}><ArrowDownRight size={16}/></button></td></tr>)}</tbody></table>{!visible.length && <Empty title={view === 'Watchlist' ? 'Your watchlist is waiting' : !fresh ? 'Ready when your indexer is' : 'No matching pools'} text={view === 'Watchlist' ? 'Star a pool in the explorer to keep it here.' : !fresh ? 'Connect a Base RPC and start the worker to see real events.' : 'Try a different token, address, or pool type.'}/>}</div>}
          {view !== 'Factories' && <div className="table-footer"><span>Showing {filtered.length ? safePage * 8 + 1 : 0}–{Math.min((safePage + 1) * 8, filtered.length)} of {filtered.length} pools</span><div><button className="icon-button" aria-label="Previous page" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}><CaretLeft size={14}/></button><span>{safePage + 1} <span className="muted">/ {totalPages}</span></span><button className="icon-button" aria-label="Next page" disabled={safePage >= totalPages - 1} onClick={() => setPage(safePage + 1)}><CaretRight size={14}/></button></div></div>}
        </section>
        </div><aside className="right-rail">
          <section className="panel network-panel"><div className="panel-heading"><h2>Network status</h2><Pulse size={17} className="muted"/></div><div className="network-name"><span className="base-symbol large"/><div><strong>Base Mainnet</strong><span className="sub">Chain ID 8453</span></div><span className={`badge ${fresh ? 'green' : 'neutral'}`}>{fresh ? 'Online' : 'Offline'}</span></div><dl><div><dt>Latest block</dt><dd className="mono">{data?.status.head ? data.status.head.toLocaleString() : '—'}</dd></div><div><dt>Connection</dt><dd>{data?.status.transport || 'Not connected'}</dd></div><div><dt>Approved factories</dt><dd>{data?.factories.filter(f => f.approved).length || 0}<span className="muted"> discovered</span></dd></div><div><dt>Data source</dt><dd>{'On-chain events'}</dd></div></dl><div className="network-foot"><span className={`dot ${fresh ? '' : 'amber-dot'}`}/>{fresh ? 'Receiving chain data' : 'Waiting for indexer'}</div></section>
          <section className="panel recent-panel"><div className="panel-heading"><h2>Recent activity</h2><span className="live-tag">{'EVENTS'}</span></div><div className="timeline">{(data?.pools || []).slice(0, 4).map((p, i) => <button className="timeline-item" key={p.address} onClick={() => setModal(p)}><span className={`timeline-icon ${p.mintBlock !== null ? 'mint-icon' : ''}`}>{p.mintBlock !== null ? <Waves size={16}/> : <Plus size={16}/>}</span><div><strong>{p.mintBlock !== null ? 'First mint observed' : 'New pool created'}</strong><span className="timeline-pair">{p.symbol0} <span>/</span> {p.symbol1}</span><span className="sub">{age(p.mintAt || p.createdAt, now || Date.now())} <span>·</span> {p.kind}</span></div></button>)}{!data?.pools.length && <p className="rail-empty">Pool events will appear here as they arrive.</p>}</div><button className="view-all" onClick={() => nav('Event log')}>View all events<ArrowRight size={14}/></button></section>
          <section className="insight-panel"><div className="insight-icon"><Info size={19}/></div><h3>Created ≠ liquid.</h3><p>A new pool can start empty. Follow its first mint to see when tokens are actually added.</p><button onClick={() => setModal('about')}>Understand the signals <ArrowRight size={14}/></button><div className="signal-diagram"><span><CirclesThree size={16}/>Created</span><span className="signal-line"/><span><Waves size={16}/>First mint</span></div></section>
          {data && <div className="backfill-info"><Database size={15}/><div>{data.status.historyComplete ? 'History up to date' : 'Backfilling history'}<span className="sub">{(data.status.historyComplete ? data.status.indexed : data.status.history).toLocaleString()} / {data.status.indexed.toLocaleString()} blocks</span><span className="sub">From block {data.status.startBlock.toLocaleString()}</span></div></div>}
        </aside></div>
        <footer className="main-footer"><span><span className="dot"/>Pool discovery, without the middleman.</span><span>Aerodrome on Base <span className="footer-divider">/</span> {'Unconfirmed chain events'}</span></footer>
      </main>
    </div>
    {toast && <div className="toast" role="status"><CheckCircle size={18}/>{toast}</div>}
    <dialog ref={dialog} onCancel={() => setModal(null)} onClick={e => { if (e.target === dialog.current)
        setModal(null); }}><div className="modal-content"><button className="icon-button modal-close" aria-label="Close dialog" onClick={() => setModal(null)}><X size={20}/></button>
      {typeof modal === 'object' && modal ? <><div className="eyebrow">{'POOL DETAILS'}</div><h2>{modal.symbol0} / {modal.symbol1}</h2><Badge minted={modal.mintBlock !== null}/><div className="detail-address"><span className="mono">{modal.address}</span><button className="icon-button" aria-label="Copy pool address" onClick={() => copy(modal.address)}>{copied === modal.address ? <Check size={17}/> : <Copy size={17}/>}</button></div><dl className="details"><div><dt>Pool type</dt><dd>{modal.kind}{modal.tickSpacing !== null ? ` · spacing ${modal.tickSpacing}` : modal.stable ? ' · Stable' : ' · Volatile'}</dd></div><div><dt>Created at</dt><dd>{new Date(modal.createdAt * 1000).toUTCString()}</dd></div><div><dt>Creation block</dt><dd>{modal.block.toLocaleString()}</dd></div><div><dt>First mint block</dt><dd>{modal.mintBlock?.toLocaleString() || 'Not observed'}</dd></div></dl><h3>First observed mint amounts</h3>{modal.mintBlock !== null && !modal.mintVerified && <p className="modal-note">Historical backfill has not yet verified that this was the earliest mint.</p>}<div className="mint-amount"><Token symbol={modal.symbol0} small/><span>{modal.symbol0}</span><strong>{amount(modal.amount0, modal.decimals0)}</strong></div><div className="mint-amount"><Token symbol={modal.symbol1} small/><span>{modal.symbol1}</span><strong>{amount(modal.amount1, modal.decimals1)}</strong></div><p className="modal-note">Amounts deposited in the first nonzero Mint event. This is not current TVL, a USD valuation, or proof of tradable liquidity. CL deposits may be out of range.</p><PoolState key={modal.address} pool={modal}/><div className="transaction-links"><a href={`https://basescan.org/tx/${modal.tx}`} target="_blank" rel="noreferrer">Creation transaction <ArrowSquareOut size={13}/></a>{modal.mintTx && <a href={`https://basescan.org/tx/${modal.mintTx}`} target="_blank" rel="noreferrer">Mint transaction <ArrowSquareOut size={13}/></a>}</div><h3>Token contracts</h3>{[modal.token0, modal.token1].map((a, i) => <div className="detail-address" key={a}><span>{i === 0 ? modal.symbol0 : modal.symbol1}</span><a className="mono" href={`https://basescan.org/token/${a}`} target="_blank" rel="noreferrer">{a}</a><button className="icon-button" aria-label={`Copy token ${i} address`} onClick={() => copy(a)}><Copy size={15}/></button></div>)}<div className="modal-actions"><button className="button primary" onClick={() => toggleStar(modal.address)}><Star size={16} weight={stars.includes(modal.address) ? 'fill' : 'regular'}/>{stars.includes(modal.address) ? 'Remove from watchlist' : 'Add to watchlist'}</button>{<a className="button" href={`https://basescan.org/address/${modal.address}`} target="_blank" rel="noreferrer">Basescan<ArrowSquareOut size={15}/></a>}</div></> :
            modal === 'setup' ? <><div className="eyebrow">CONNECTION SETTINGS</div><h2>Connect to the source.</h2><p>One command starts Next.js and the persistent worker. RPC credentials stay on the server.</p><dl className="details"><div><dt>HTTP RPC</dt><dd>{data?.status.rpcConfigured ? 'Dedicated endpoint configured' : 'Public Base RPC'}</dd></div><div><dt>WebSocket</dt><dd>{data?.status.wsConfigured ? 'Configured' : 'Optional; HTTP polling active'}</dd></div><div><dt>Database</dt><dd>Local SQLite</dd></div><div><dt>Last indexed block</dt><dd>{data?.status.indexed.toLocaleString() || 'Waiting'}</dd></div></dl><ol className="setup-steps"><li><strong>Configure your Base endpoints</strong><p>Copy <code>.env.example</code> to <code>.env.local</code> and set your HTTP and optional WebSocket RPC URLs.</p><pre>BASE_HTTP_RPC_URL=https://your-base-rpc<br />BASE_WS_RPC_URL=wss://your-base-rpc</pre></li><li><strong>Start the dashboard and indexer</strong><pre>npm run dev:live</pre><p>Or run <code>npm run indexer</code> beside an existing dashboard.</p></li><li><strong>Track live events</strong><p>The worker follows new blocks and backfills the last day by default. Set START_BLOCK=0 on a fresh database for full history. Use Start scanning and Stop scanning on the dashboard. Scanning follows every block; the history window does not affect scanning frequency.</p></li></ol><button className="button primary" onClick={() => { void fetchLive(); setModal(null); }}>Open live dashboard<ArrowRight size={16}/></button></> :
                modal === 'alerts' ? <><div className="eyebrow">ALERT PREFERENCES</div><h2>Keep an eye on first liquidity.</h2><p>Show an in-app notification when the live feed observes a recent first mint. Alerts work while this dashboard is open and the feed is running.</p><label className="alert-option"><span><strong>First mint notifications</strong><span className="sub">Uses the token search, quote token and minimum deposit filters</span></span><input type="checkbox" checked={alerts} onChange={e => { setAlerts(e.target.checked); try { localStorage.setItem('aerowatch-alerts',String(e.target.checked)); } catch {} }}/></label><p className="modal-note">Alerts follow your current token search and minimum deposit filter. Deposits are checked by contract address. Historical events older than one minute do not trigger alerts.</p><button className="button primary" onClick={() => setModal(null)}>Save preferences<Check size={16}/></button></> :
                    <><div className="eyebrow">HOW AEROWATCH WORKS</div><h2>From creation to first liquidity.</h2><div className="explain-step"><span>01</span><div><h3>Discover the factories</h3><p>Read approved factories from Aerodrome’s FactoryRegistry. Historical approval events retain coverage for older factories.</p></div></div><div className="explain-step"><span>02</span><div><h3>Listen for pool creation</h3><p>Decode V2 and Slipstream PoolCreated events. A WebSocket block subscription wakes the indexer; HTTP log scans catch up after reconnects.</p></div></div><div className="explain-step"><span>03</span><div><h3>Observe the first nonzero mint</h3><p>Record the deposited token amounts, including mints in the creation transaction. A mint does not establish current liquidity, token safety, or token novelty.</p></div></div><p className="modal-note">Recent blocks are provisional. The indexer replays a configurable 20-block window to repair shallow reorganizations. Full history requires START_BLOCK=0 on a fresh database and completed backfill. The default covers roughly one day and all future pools. No mempool visibility or indexing-speed guarantee is implied.</p><a className="button" href="https://github.com/aerodrome-finance/contracts" target="_blank" rel="noreferrer">Aerodrome contracts<ArrowSquareOut size={15}/></a></>}
    </div></dialog>
  </div>;
}
function ArrowUpRight() { return <ArrowSquareOut size={13}/>; }
function Empty({ title, text }: {
    title: string;
    text: string;
}) { return <div className="empty"><MagnifyingGlass size={25}/><h3>{title}</h3><p>{text}</p></div>; }
