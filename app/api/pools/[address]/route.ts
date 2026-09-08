import {getPool} from '@/lib/db';
import {createPublicClient,http,erc20Abi,isAddress,parseAbi,type Address} from 'viem';
import {base} from 'viem/chains';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const poolAbi=parseAbi(['function getReserves() view returns (uint256 reserve0,uint256 reserve1,uint256 timestamp)','function liquidity() view returns (uint128)']);
export async function GET(_request:Request,{params}:{params:Promise<{address:string}>}){
 const {address}=await params;
 if(!isAddress(address))return Response.json({error:'Invalid pool address'},{status:400});
 const pool=getPool(address);
 if(!pool)return Response.json({error:'Pool is not in the local index'},{status:404});
 const client=createPublicClient({chain:base,transport:http(process.env.BASE_HTTP_RPC_URL || 'https://mainnet.base.org',{timeout:10000,retryCount:0})});
 try{
 const block=await client.getBlockNumber({cacheTime:0});
 const [b0,b1,state]=await Promise.allSettled([
   client.readContract({address:pool.token0 as Address,abi:erc20Abi,functionName:'balanceOf',args:[address],blockNumber:block}),
   client.readContract({address:pool.token1 as Address,abi:erc20Abi,functionName:'balanceOf',args:[address],blockNumber:block}),
   pool.kind==='V2'?client.readContract({address,abi:poolAbi,functionName:'getReserves',blockNumber:block}):client.readContract({address,abi:poolAbi,functionName:'liquidity',blockNumber:block}),
 ]);
 const reserves=state.status==='fulfilled'&&Array.isArray(state.value)?[state.value[0].toString(),state.value[1].toString()]:null;
 const activeLiquidity=state.status==='fulfilled'&&!Array.isArray(state.value)?state.value.toString():null;
 return Response.json({block:Number(block),balance0:b0.status==='fulfilled'?b0.value.toString():null,balance1:b1.status==='fulfilled'?b1.value.toString():null,reserves,activeLiquidity,partial:[b0,b1,state].some(r=>r.status==='rejected')},{headers:{'Cache-Control':'no-store'}});
 }catch{return Response.json({error:'Current pool state is unavailable from the RPC. Retry shortly.'},{status:502});}
}
