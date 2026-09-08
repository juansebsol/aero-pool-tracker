import {spawn} from 'node:child_process';
import {meta,setMeta,transaction,readStatus} from '@/lib/db';
import {setScannerEnabled} from '@/lib/scanner-control';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request:Request){
  // Local control endpoint: reject cross-site requests and form submissions.
  if(request.headers.get('origin')!==new URL(request.url).origin || !request.headers.get('content-type')?.includes('application/json'))return Response.json({error:'Use the scanner controls in this dashboard.'},{status:403});
  let enabled:boolean;
  try{const body=await request.json();if(typeof body.enabled!=='boolean')throw new Error();enabled=body.enabled;}catch{return Response.json({error:'enabled must be true or false.'},{status:400});}
  try{
    setScannerEnabled(enabled);
    if(enabled){
      const launch=transaction(()=>{
        const lease=meta('lease',{at:0});
        if(Date.now()-lease.at<30000 || Date.now()-meta('worker-launch-at',0)<15000)return false;
        setMeta('worker-launch-at',Date.now());return true;
      });
      if(launch){
        // Fixed local script only, no shell or client-supplied command arguments.
        const child=spawn(process.execPath,['--experimental-strip-types','scripts/indexer.ts'],{cwd:process.cwd(),env:process.env,stdio:'ignore',detached:true});
        await new Promise<void>((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();
      }
    }
    return Response.json({status:readStatus()},{headers:{'Cache-Control':'no-store'}});
  }catch{return Response.json({error:'Could not update the scanner. Start the app with npm run dev and retry.'},{status:503});}
}
