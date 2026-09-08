import { config } from 'dotenv';
config({ path: '.env.local', quiet: true }); config({ quiet: true });
import {scannerControl,assertScanning,ScanInterrupted} from '../lib/scanner-control.ts';
import { randomUUID } from 'node:crypto';
import { createPublicClient, http, webSocket } from 'viem';
import { base } from 'viem/chains';
import { REGISTRY, registryAbi } from '../lib/contracts.ts';
import { db, meta, setMeta, transaction, readStatus } from '../lib/db.ts';
import { createRpc } from '../lib/rpc.ts';
import { scanRange } from '../lib/indexer-core.ts';

const integer = (name: string, fallback: number, min=0) => {
  const n=Number(process.env[name] || fallback);
  if (!Number.isSafeInteger(n) || n<min) throw new Error(`${name} must be an integer >= ${min}`);
  return n;
};
const depth=integer('REORG_DEPTH',20,2), maxChunk=integer('BLOCK_CHUNK',2000,1), lookback=integer('RECENT_BLOCKS',43200,1);
const interval=integer('POLL_INTERVAL_MS',2000,500);
const configured=!!process.env.BASE_HTTP_RPC_URL && process.env.BASE_HTTP_RPC_URL !== 'https://mainnet.base.org';
const rpc=createRpc(process.env.BASE_HTTP_RPC_URL || 'https://mainnet.base.org');
const historyRpc=createRpc(process.env.BASE_HISTORY_RPC_URL || 'https://mainnet.base.org');
let status=readStatus(), stopped=false, wsAt=0, generation=0;
let unwatch:(()=>void)|undefined;
const owner=randomUUID();
let controlTimer:ReturnType<typeof setInterval>|undefined;
let socketReady=false,socketConnecting=false;
let leaseTimer:ReturnType<typeof setInterval>|undefined;
let liveChunk=Math.min(maxChunk,100), historyChunk=maxChunk;
let nudge: (()=>void)|undefined;
const delay=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
function assertLease(){if(meta('lease',{owner:''}).owner!==owner)throw new Error('Lease lost');}
function report(){assertLease();setMeta('status',{...status,heartbeat:Date.now()});}
function acquire(){transaction(()=>{const lease=meta('lease',{owner:'',at:0});if(Date.now()-lease.at<30000)throw new Error('Another indexer is already running');setMeta('lease',{owner,at:Date.now()});});}
async function discover(){
  const addresses=await rpc.readContract({address:REGISTRY,abi:registryAbi,functionName:'poolFactories'});
  transaction(()=>{assertLease();db().exec('UPDATE factories SET approved=0');for(const a of addresses)db().prepare('INSERT OR REPLACE INTO factories VALUES (?,1)').run(a.toLowerCase());});
}
function safeError(e:unknown){
  const error=e as {details?:string;shortMessage?:string};
  let message=String(error.details||error.shortMessage||'RPC unavailable');
  for(const value of [process.env.BASE_HTTP_RPC_URL,process.env.BASE_WS_RPC_URL])if(value)message=message.replaceAll(value,'[RPC]');
  return message.replace(/https?:\/\/\S+|wss?:\/\/\S+|alch_\S+/g,'[redacted]').slice(0,250);
}
async function connectSocket(){
  if(!socketReady||socketConnecting||unwatch||!scannerControl().enabled||!process.env.BASE_WS_RPC_URL)return;
  socketConnecting=true;const revision=scannerControl().revision;
  const socket=createPublicClient({chain:base,transport:webSocket(process.env.BASE_WS_RPC_URL,{reconnect:true,timeout:8000})});
  try{
    if(await socket.getChainId()!==8453)throw new Error('Wrong WebSocket chain');
    assertScanning(revision);
    unwatch=socket.watchBlockNumber({onBlockNumber:()=>{wsAt=Date.now();nudge?.();},onError:()=>{wsAt=0;}});
  }catch{status.transport='HTTP fallback';}finally{socketConnecting=false;}
}
async function waitUntilEnabled(){
  if(scannerControl().enabled)return;
  if(status.state!=='paused'){status.state='paused';status.transport='Stopped';status.error=null;report();}
  while(!stopped&&!scannerControl().enabled)await delay(200);
}
async function liveLoop(){
  let lastRegistry=Date.now();
  while(!stopped){
    await waitUntilEnabled();if(stopped)break;
    const revision=scannerControl().revision;
    const active=()=>{assertLease();assertScanning(revision);};
    try{
      if(Date.now()-lastRegistry>60000){await discover();lastRegistry=Date.now();}
      active();
      const head=Number(await rpc.getBlockNumber());
      active();
      status.head=head;status.historyTarget=Math.max(status.startBlock-1,head-depth);
      status.transport=Date.now()-wsAt<15000?'WebSocket + HTTP logs':process.env.BASE_WS_RPC_URL?'HTTP fallback':'HTTP polling';
      let from=Math.max(status.liveStart,status.indexed+1), rewindFrom:number|undefined;
      const anchor=db().prepare('SELECT hash FROM anchors WHERE block=?').get(status.indexed) as {hash:string}|undefined;
      if(anchor && (head<status.indexed || (await rpc.getBlock({blockNumber:BigInt(status.indexed)})).hash!==anchor.hash)){
        const anchors=db().prepare('SELECT block,hash FROM anchors ORDER BY block DESC').all() as {block:number;hash:string}[];
        let ancestor:number|undefined;
        for(const a of anchors)if(a.block<=head && (await rpc.getBlock({blockNumber:BigInt(a.block)})).hash===a.hash){ancestor=a.block;break;}
        if(ancestor===undefined)throw new Error('DEEP_REORG');
        rewindFrom=ancestor+1;from=rewindFrom;generation++;
      }
      const to=Math.min(head,Math.max(from,status.indexed+liveChunk));
      if(from<=to){
        await scanRange(head-status.indexed>100?historyRpc:rpc,from,to,{rewindFrom,beforeRequest:active,beforeCommit:active,commit:(hash)=>{
          status.indexed=to;status.lastIndexedAt=Date.now();status.error=null;status.state=to<head?'syncing':'live';
          db().prepare('INSERT OR REPLACE INTO anchors VALUES (?,?)').run(to,hash);
          db().exec('DELETE FROM anchors WHERE block NOT IN (SELECT block FROM anchors ORDER BY block DESC LIMIT 64)');
          report();
        }});
      }
      liveChunk=Math.min(maxChunk,liveChunk+10);
      active();status.lastScanAt=Date.now();status.scanCount++;
      status.state=status.indexed<head?'syncing':'live';status.error=null;report();
      await new Promise<void>(resolve=>{const timer=setTimeout(()=>{nudge=undefined;resolve();},status.indexed<head?50:interval);nudge=()=>{clearTimeout(timer);nudge=undefined;resolve();};});
    }catch(e){
      if(e instanceof ScanInterrupted)continue;
      if(e instanceof Error&&e.message==='DEEP_REORG'){status.error='Reorganization exceeds retained checkpoints. Stop the app and rebuild the index using a new DATABASE_PATH.';status.state='halted';report();stopped=true;break;}
      liveChunk=Math.max(1,Math.floor(liveChunk/2));
      status.state='retrying';status.error='Base RPC request failed. Retrying the same range; check endpoint limits or add a dedicated RPC in .env.local.';report();
      console.error('[indexer] Live RPC failed; checkpoint preserved.', safeError(e));await delay(3000);
    }
  }
}
async function historyLoop(){
  while(!stopped){
    await waitUntilEnabled();if(stopped)break;
    const revision=scannerControl().revision;
    const active=()=>{assertLease();assertScanning(revision);};
    // Low priority. Recent pools and live mints continue while history catches up.
    if(status.historyComplete){await delay(1000);continue;}
    try{
      const target=Math.max(status.startBlock-1,status.indexed-depth);
      if(status.history>=target){
        // Replay the handover window for old pools discovered after live scans passed them.
        const handover=status.indexed;
        if(status.history<handover)await scanRange(historyRpc,status.history+1,handover,{beforeRequest:active,beforeCommit:active,commit:()=>{status.history=handover;}});
        status.historyComplete=true;status.historyError=null;report();continue;
      }
      const to=Math.min(target,status.history+historyChunk), version=generation;
      await scanRange(historyRpc,status.history+1,to,{beforeRequest:active,beforeCommit:()=>{active();if(version!==generation)throw new Error('Reorg during history scan');},commit:()=>{status.history=to;status.historyError=null;report();}});
      historyChunk=Math.min(maxChunk,Math.ceil(historyChunk*1.2));await delay(250);
    }catch(e){
      if(e instanceof ScanInterrupted)continue;
      historyChunk=Math.max(1,Math.floor(historyChunk/2));status.historyError='Historical RPC request failed. Retrying with a smaller block range; live tracking continues.';report();await delay(5000);
    }
  }
}
async function main(){
  acquire();
  let previous=scannerControl().revision;
  controlTimer=setInterval(()=>{
    const control=scannerControl();
    if(!control.enabled){unwatch?.();unwatch=undefined;wsAt=0;}
    if(control.revision!==previous){previous=control.revision;nudge?.();if(control.enabled)void connectSocket();}
  },200);
  leaseTimer=setInterval(()=>{try{transaction(()=>{assertLease();setMeta('lease',{owner,at:Date.now()});report();});}catch{stopped=true;}},5000);
  status={...status,state:'connecting',pollIntervalMs:interval,rpcConfigured:configured,wsConfigured:!!process.env.BASE_WS_RPC_URL,error:null};report();
  await waitUntilEnabled();if(stopped)return;
  // Keep retrying startup if a provider is temporarily unavailable.
  while(!stopped){try{
    if(await rpc.getChainId()!==8453){status.error='HTTP RPC is not Base mainnet (chain 8453).';status.state='halted';report();return;}
    await discover();break;
  }catch{status.error='Cannot reach Base RPC. Retrying connection; check .env.local.';report();await delay(5000);}}
  if(stopped)return;
  const head=Number(await rpc.getBlockNumber());
  if(!meta('initialized-v2',false)){
    const start=process.env.START_BLOCK?integer('START_BLOCK',0):Math.max(0,head-lookback);
    if(start>head)throw new Error('START_BLOCK exceeds chain head');
    status={...status,head,startBlock:start,liveStart:Math.max(start,head-20),indexed:Math.max(start,head-20)-1,history:start-1,historyTarget:head-depth,historyComplete:false};
    transaction(()=>{setMeta('initialized-v2',true);report();});
  }
  socketReady=true;void connectSocket();
  console.log(`[indexer] Base connected. Live from ${status.liveStart}; history from ${status.startBlock}. SQLite active.`);
  await Promise.all([liveLoop(),historyLoop()]);
}
function stop(){stopped=true;nudge?.();}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
main().catch(e=>{
  if(e instanceof Error&&e.message==='Another indexer is already running')console.error('[indexer] Another worker owns this database. Use the existing worker.');
  else{console.error('[indexer] Startup failed. Verify RPC, START_BLOCK and database permissions.');if(meta('lease',{owner:''}).owner===owner){status.error='Indexer startup failed. Check RPC configuration, START_BLOCK and database access.';status.state='offline';report();}}
  process.exitCode=1;
}).finally(()=>{
  stopped=true;unwatch?.();if(controlTimer)clearInterval(controlTimer);if(leaseTimer)clearInterval(leaseTimer);
  if(meta('lease',{owner:''}).owner===owner){status.state=status.state==='halted'?'halted':'offline';report();setMeta('lease',{owner:'',at:0});db().exec('PRAGMA wal_checkpoint(TRUNCATE)');}
  // viem reconnect timers must not keep a stopped worker alive.
  process.exit(process.exitCode || 0);
});
