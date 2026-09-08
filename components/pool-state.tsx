'use client';
import {useCallback,useEffect,useState} from 'react';
import {ArrowsClockwise} from '@phosphor-icons/react';
import type {Pool} from '@/lib/types';
import {amount} from '@/lib/format';
type State={block:number;balance0:string|null;balance1:string|null;reserves:string[]|null;activeLiquidity:string|null;partial:boolean};
export default function PoolState({pool}:{pool:Pool}){
 const [state,setState]=useState<State|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 const refresh=useCallback(async(signal?:AbortSignal)=>{setLoading(true);try{
  const response=await fetch(`/api/pools/${pool.address}`,{signal});const data=await response.json();
  if(!response.ok)throw new Error(data.error||'Could not load current pool state');setState(data);setError('');
 }catch(e){if(!signal?.aborted)setError(e instanceof Error?e.message:'Could not load pool state');}finally{setLoading(false);}},[pool.address]);
 useEffect(()=>{setState(null);const controller=new AbortController();void refresh(controller.signal);return()=>controller.abort();},[refresh]);
 return <section className="current-state"><div className="state-heading"><h3>Current on-chain liquidity</h3><button className="icon-button" aria-label="Refresh current liquidity" disabled={loading} onClick={()=>refresh()}><ArrowsClockwise size={16} className={loading?'spin':''}/></button></div>{error?<p role="status">{error}</p>:!state?<p>Reading current pool state…</p>:<><dl className="details"><div><dt>At block</dt><dd>{state.block.toLocaleString()}</dd></div><div><dt>{pool.symbol0} {pool.kind==='V2'?'reserve':'balance'}</dt><dd>{amount(pool.kind==='V2'?(state.reserves?.[0]??null):state.balance0,pool.decimals0)}</dd></div><div><dt>{pool.symbol1} {pool.kind==='V2'?'reserve':'balance'}</dt><dd>{amount(pool.kind==='V2'?(state.reserves?.[1]??null):state.balance1,pool.decimals1)}</dd></div>{pool.kind==='Slipstream'&&<div><dt>In-range liquidity</dt><dd>{state.activeLiquidity===null?'Unavailable':BigInt(state.activeLiquidity)>0n?'Nonzero':'Zero'}</dd></div>}</dl><p className="modal-note">{pool.kind==='V2'?'Reserves may have changed since the first deposit.':'Balances include out-of-range positions. Nonzero balances alone do not establish in-range liquidity.'}{state.partial?' Some contract reads failed.':''}</p></>}</section>;
}
