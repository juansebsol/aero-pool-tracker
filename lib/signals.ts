import {parseUnits} from 'viem';
import type {Pool} from './types.ts';
export const QUOTES = {
 WETH: {address:'0x4200000000000000000000000000000000000006',decimals:18},
 USDC: {address:'0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',decimals:6},
} as const;
export type Quote = keyof typeof QUOTES;
export function quoteDeposit(pool:Pool, quote:Quote):string|null {
 const address=QUOTES[quote].address;
 return pool.token0.toLowerCase()===address?pool.amount0:pool.token1.toLowerCase()===address?pool.amount1:null;
}
export function matchesDeposit(pool:Pool,quote:Quote|'Any',minimum:string){
 if(quote==='Any')return true;
 if(pool.token0.toLowerCase()!==QUOTES[quote].address&&pool.token1.toLowerCase()!==QUOTES[quote].address)return false;
 if(!/^\d*(\.\d*)?$/.test(minimum))return false;
 try {const min=parseUnits(minimum||'0',QUOTES[quote].decimals);if(min===0n)return true;const deposit=quoteDeposit(pool,quote);return deposit!==null&&BigInt(deposit)>=min;}catch{return false;}
}
