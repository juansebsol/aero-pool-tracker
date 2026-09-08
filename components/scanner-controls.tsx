'use client';
import {useState} from 'react';
import {Play,Stop,ArrowsClockwise} from '@phosphor-icons/react';
import type {IndexerStatus} from '@/lib/types';
export default function ScannerControls({status,now,onStatus}:{status?:IndexerStatus;now:number;onStatus:(status:IndexerStatus)=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const enabled=status?.scanEnabled??true;
 const workerAlive=!!status&&now-status.heartbeat<15000&&!['offline','halted'].includes(status.state);
 const running=enabled&&workerAlive&&['live','syncing'].includes(status?.state||'');
 const stopping=!enabled&&workerAlive&&status?.state!=='paused';
 const title=stopping?'Stopping scanner…':!enabled?'Scanner stopped':running?status?.state==='syncing'?'Scanning · catching up':'Scanning continuously':workerAlive?'Connecting to Base…':'Scanner is offline';
 async function toggle(next:boolean){setBusy(true);setError('');try{
  const response=await fetch('/api/scanner',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:next}),signal:AbortSignal.timeout(10000)});
  const result=await response.json();if(!response.ok)throw new Error(result.error||'Could not control scanner');onStatus(result.status);
 }catch(e){setError(e instanceof Error?e.message:'Could not control scanner');}finally{setBusy(false);}}
 return <section className={`scanner-panel ${running?'running':''}`} aria-label="Live scanner">
  <div className="scanner-info"><div className="scanner-title"><span className="scanner-light"/><strong>{title}</strong></div><p>{!enabled?'Your pools are saved. Start again to catch up and scout new pairs.':`Watches every new block · ${((status?.pollIntervalMs||2000)/1000).toLocaleString()}s polling fallback · runs until stopped · keep the local server running`}</p><div className="scanner-telemetry"><span>Last successful scan <strong>{status?.lastScanAt?`${Math.max(0,Math.floor((now-status.lastScanAt)/1000))}s ago`:'Waiting'}</strong></span><span>Indexed block <strong>{status?.indexed?status.indexed.toLocaleString():'—'}</strong></span><span>Checks completed <strong>{(status?.scanCount||0).toLocaleString()}</strong></span></div></div>
  <button className={`button ${enabled&&workerAlive?'stop-scanner':'primary'}`} onClick={()=>toggle(!(enabled&&workerAlive))} disabled={busy||stopping}>{busy?<ArrowsClockwise size={17} className="spin"/>:enabled&&workerAlive?<Stop size={17} weight="fill"/>:<Play size={17} weight="fill"/>}{busy?'Updating…':enabled&&workerAlive?'Stop scanning':'Start scanning'}</button>
  {error&&<p className="scanner-error" role="alert">{error}</p>}
 </section>;
}
