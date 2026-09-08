import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {encodeAbiParameters,encodeEventTopics,decodeEventLog} from 'viem';
process.env.DATABASE_PATH=':memory:';
const {db,getPool,savePool,firstMint,rewind,transaction,setMeta,meta}=await import('../lib/db.ts');
const {scanRange}=await import('../lib/indexer-core.ts');
const {v2Created,clCreated,v2Mint,clMint}=await import('../lib/contracts.ts');
import {matchesDeposit,QUOTES} from '../lib/signals.ts';
import type {Pool} from '../lib/types.ts';
import type {ChainClient} from '../lib/indexer-core.ts';
const address=(n:number)=>`0x${n.toString(16).padStart(40,'0')}` as `0x${string}`;
const hash=(n:number)=>`0x${n.toString(16).padStart(64,'0')}` as `0x${string}`;
const factory=address(1),poolAddress=address(2),token0=QUOTES.WETH.address,token1=address(4);
function pool():Pool{return {address:poolAddress,factory,token0,token1,symbol0:'WETH',symbol1:'TOKEN',decimals0:18,decimals1:18,kind:'V2',stable:false,tickSpacing:null,block:100,createdAt:200,tx:hash(1),mintBlock:null,mintAt:null,mintTx:null,amount0:null,amount1:null};}
beforeEach(()=>{db().exec('DELETE FROM pools; DELETE FROM factories; DELETE FROM tokens; DELETE FROM meta; DELETE FROM anchors;');db().prepare('INSERT INTO factories VALUES (?,1)').run(factory);});
function client(kind:'V2'|'Slipstream'='V2',fail=false,changed=false):ChainClient{
 let blocks=0;
 return {
  getBlock:async()=>({hash:hash(changed&&++blocks>1?2:1),timestamp:200n}),
  readContract:async(p:{functionName:string})=>p.functionName==='symbol'?'TOKEN':18,
  getLogs:async(p:{event?:unknown;events?:unknown[]})=>{
   if(p.event)return [];
   if(p.events?.[0]===v2Created)return [{address:factory,blockNumber:100n,logIndex:1,transactionHash:hash(1),args:{token0,token1,pool:poolAddress,...(kind==='V2'?{stable:false,count:1n}:{tickSpacing:100})}}];
   if(fail)throw new Error('RPC interrupted during mint query');
   return [{address:poolAddress,blockNumber:100n,logIndex:2,transactionHash:hash(1),args:{amount0:1000000000000000000n,amount1:kind==='Slipstream'?0n:500n,...(kind==='V2'?{sender:address(5)}:{owner:address(5),sender:address(5),tickLower:-100,tickUpper:100,amount:20n})}}];
  }
 } as unknown as ChainClient;
}
test('atomic V2 creation + mint in the same transaction is retained, replay is idempotent',async()=>{
 await scanRange(client(),100,100);await scanRange(client(),100,100);
 const p=getPool(poolAddress)!;assert.equal(p.mintBlock,100);assert.equal(p.mintTx,p.tx);assert.equal(p.amount0,'1000000000000000000');assert.equal((db().prepare('SELECT COUNT(*) AS n FROM pools').get() as {n:number}).n,1);
});
test('Slipstream mint decodes into a CL pool, including one-sided deposits',async()=>{await scanRange(client('Slipstream'),100,100);assert.equal(getPool(poolAddress)?.kind,'Slipstream');assert.equal(getPool(poolAddress)?.tickSpacing,100);assert.equal(getPool(poolAddress)?.mintBlock,100);});
test('an RPC failure cannot partially commit a pool or advance its checkpoint',async()=>{
 setMeta('cursor',99);await assert.rejects(scanRange(client('V2',true),100,100,{commit:()=>setMeta('cursor',100)}));assert.equal(getPool(poolAddress),undefined);assert.equal(meta('cursor',0),99);
});
test('a changing canonical block discards the batch',async()=>{await assert.rejects(scanRange(client('V2',false,true),100,100));assert.equal(getPool(poolAddress),undefined);});
test('historical mints replace a later observation without losing exact integer amounts',()=>{
 savePool(pool());firstMint(pool(),{block:200,at:400,tx:hash(2),amount0:'999999999999999999999999999999999',amount1:'1'});firstMint(pool(),{block:101,at:202,tx:hash(3),amount0:'123456789123456789123456789',amount1:'2'});firstMint(pool(),{block:300,at:600,tx:hash(4),amount0:'5',amount1:'6'});assert.equal(getPool(poolAddress)?.mintBlock,101);assert.equal(getPool(poolAddress)?.amount0,'123456789123456789123456789');
});
test('zero mint does not count as first liquidity',()=>{savePool(pool());firstMint(pool(),{block:100,at:200,tx:hash(2),amount0:'0',amount1:'0'});assert.equal(getPool(poolAddress)?.mintBlock,null);});
test('reorganization removes orphaned pools and mints inside one transaction',()=>{
 savePool(pool());savePool({...pool(),address:address(20),block:120});firstMint(pool(),{block:121,at:242,tx:hash(2),amount0:'1',amount1:'2'});transaction(()=>rewind(120));assert.equal(getPool(address(20)),undefined);assert.equal(getPool(poolAddress)?.mintBlock,null);
});
test('rollback preserves data if a reorg commit fails',()=>{savePool(pool());assert.throws(()=>transaction(()=>{rewind(100);throw new Error('failed');}));assert.ok(getPool(poolAddress));});
test('deposit filter matches canonical addresses rather than spoofed token symbols',()=>{
 const p={...pool(),amount0:'1000000000000000000'};assert.equal(matchesDeposit(p,'WETH','1'),true);assert.equal(matchesDeposit(p,'WETH','1.000000000000000001'),false);assert.equal(matchesDeposit({...p,token0:address(999)},'WETH','0'),false);assert.equal(matchesDeposit(p,'WETH','invalid'),false);
});
test('production ABIs decode distinct V2 and CL creation topics',()=>{
 const topics=encodeEventTopics({abi:[v2Created],eventName:'PoolCreated',args:{token0,token1,stable:false}});
 const data=encodeAbiParameters([{type:'address'},{type:'uint256'}],[poolAddress,1n]);
 const decoded=decodeEventLog({abi:[v2Created,clCreated],topics:topics as [`0x${string}`, ...`0x${string}`[]],data});assert.equal(decoded.args.pool.toLowerCase(),poolAddress);assert.ok('stable' in decoded.args);
 const clTopics=encodeEventTopics({abi:[clCreated],eventName:'PoolCreated',args:{token0,token1,tickSpacing:100}});
 const clData=encodeAbiParameters([{type:'address'}],[poolAddress]);const cl=decodeEventLog({abi:[v2Created,clCreated],topics:clTopics as [`0x${string}`, ...`0x${string}`[]],data:clData});assert.ok('tickSpacing' in cl.args);
});

test('scanner stop persists and invalidates a running batch; restart preserves pools',async()=>{
 const {scannerControl,setScannerEnabled,assertScanning}=await import('../lib/scanner-control.ts');
 savePool(pool());const original=scannerControl();assert.equal(original.enabled,true);
 const stopped=setScannerEnabled(false);assert.equal(scannerControl().enabled,false);assert.throws(()=>assertScanning(original.revision));
 const restarted=setScannerEnabled(true);assert.equal(restarted.enabled,true);assert.ok(restarted.revision>stopped.revision);assert.throws(()=>assertScanning(original.revision));assert.doesNotThrow(()=>assertScanning(restarted.revision));assert.ok(getPool(poolAddress));
});
test('a stop arriving during a scan discards the batch and its checkpoint',async()=>{
 const {scannerControl,setScannerEnabled,assertScanning}=await import('../lib/scanner-control.ts');
 const revision=scannerControl().revision;setMeta('cursor',99);
 const c=client();const getBlock=c.getBlock;let calls=0;
 c.getBlock=async args=>{const block=await getBlock(args);if(++calls===2)setScannerEnabled(false);return block;};
 await assert.rejects(scanRange(c,100,100,{beforeCommit:()=>assertScanning(revision),commit:()=>setMeta('cursor',100)}));
 assert.equal(scannerControl().enabled,false);
 assert.equal(getPool(poolAddress),undefined);assert.equal(meta('cursor',0),99);
});
