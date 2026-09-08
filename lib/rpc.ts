import {createPublicClient,http,type Address,type Hex} from 'viem';
import {base} from 'viem/chains';
import type {ChainClient} from './indexer-core.ts';
export function createRpc(url:string, initialSpan=2000){
  const client=createPublicClient({chain:base,transport:http(url,{timeout:12000,retryCount:1}),cacheTime:0});
  let span=initialSpan;
  // Providers may restrict eth_getLogs to as few as ten blocks. Preserve the range
  // exactly and split only range-limit failures, never treat a failure as empty logs.
  const original=client.getLogs;
  const getLogs:typeof original=async (parameters)=>{
    const p=parameters!;
    if(typeof p.fromBlock!=='bigint'||typeof p.toBlock!=='bigint')return original(p);
    const results:Awaited<ReturnType<typeof original>>=[];
    let from=p.fromBlock;
    while(from<=p.toBlock){
      const to=from+BigInt(span-1)<p.toBlock?from+BigInt(span-1):p.toBlock;
      try{results.push(...await original({...p,fromBlock:from,toBlock:to} as never));from=to+1n;}
      catch(e){
        const message=String((e as {details?:string;shortMessage?:string}).details || (e as Error).message);
        if(span>1&&/block range|too many results|response size|query returned more|limit exceeded/i.test(message)){
          const limit=message.match(/up to (\d+) block/);span=limit?Math.max(1,Number(limit[1])):Math.max(1,Math.floor(span/2));continue;
        }
        throw e;
      }
    }
    return results as never;
  };
  return {...client,getLogs};
}
