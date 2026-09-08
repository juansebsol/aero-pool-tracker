import { db, readStatus } from '@/lib/db';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request){
  const encoder=new TextEncoder();
  let timer:ReturnType<typeof setInterval>|undefined;
  const stream=new ReadableStream({
    start(controller){
      let last='';let ended=false;
      const stop=()=>{if(ended)return;ended=true;if(timer)clearInterval(timer);request.signal.removeEventListener('abort',stop);try{controller.close();}catch{}};
      const send=()=>{if(ended)return;try{
        const status=readStatus();
        const revision=JSON.stringify([status.lastIndexedAt,status.lastScanAt,status.scanEnabled,status.controlUpdatedAt,status.history,status.state,status.heartbeat]);
        if(revision!==last){controller.enqueue(encoder.encode(`data: ${revision}\n\n`));last=revision;}
      }catch{stop();}};
      request.signal.addEventListener('abort',stop,{once:true});
      if(request.signal.aborted){stop();return;}
      controller.enqueue(encoder.encode('retry: 2000\n\n'));send();timer=setInterval(send,750);
    },
    cancel(){if(timer)clearInterval(timer);},
  });
  return new Response(stream,{headers:{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'}});
}
