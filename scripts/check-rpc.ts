import {config} from 'dotenv'; config({path:'.env.local',quiet:true});
import {createPublicClient,http} from 'viem';
import {base} from 'viem/chains';
import {REGISTRY,approval,registryAbi,v2Created,clCreated} from '../lib/contracts.ts';
for(const [name,url] of [['configured',process.env.BASE_HTTP_RPC_URL],['public','https://mainnet.base.org']]){
 const rpc=createPublicClient({chain:base,transport:http(url,{timeout:12000,retryCount:0})});
 try{
 const head=await rpc.getBlockNumber();
 const addresses=await rpc.readContract({address:REGISTRY,abi:registryAbi,functionName:'poolFactories'});
 for(const span of [10,2000]){try{const logs=await rpc.getLogs({address:[...addresses],events:[v2Created,clCreated],fromBlock:head-BigInt(span-1),toBlock:head,strict:true});console.log(JSON.stringify({name,span,count:logs.length}));}catch(e){const message=String((e as {details?:string}).details||'');console.log(JSON.stringify({name,span,error:message.replace(/https?:\/\/\S+/g,'[redacted]').replace(/alch_\S+/g,'[redacted]').slice(0,350)}));}}
 }catch{console.log(name+': connection failed');}
}
