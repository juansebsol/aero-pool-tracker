import {meta,setMeta,transaction} from './db.ts';
export type ScannerControl={enabled:boolean;revision:number;updatedAt:number};
export class ScanInterrupted extends Error { constructor(){super('Scanner control changed');this.name='ScanInterrupted';} }
export function scannerControl():ScannerControl{return meta('scanner-control',{enabled:true,revision:0,updatedAt:0});}
export function setScannerEnabled(enabled:boolean){return transaction(()=>{const current=scannerControl();if(current.enabled===enabled)return current;const next={enabled,revision:current.revision+1,updatedAt:Date.now()};setMeta('scanner-control',next);return next;});}
export function assertScanning(revision:number){const control=scannerControl();if(!control.enabled||control.revision!==revision)throw new ScanInterrupted();}
