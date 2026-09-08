import { spawn } from 'node:child_process';
const mode=process.argv[2]==='start'?'start':'dev';
const web=spawn(process.execPath,['node_modules/next/dist/bin/next',mode,'--hostname','127.0.0.1',...process.argv.slice(3)],{stdio:'inherit',env:process.env});
const worker=spawn(process.execPath,['--experimental-strip-types','scripts/indexer.ts'],{stdio:'inherit',env:process.env});
let closing=false;
function stop(code=0){if(closing)return;closing=true;web.kill('SIGTERM');worker.kill('SIGTERM');const timer=setTimeout(()=>{web.kill('SIGKILL');worker.kill('SIGKILL');process.exit(code);},3000);timer.unref();process.exitCode=code;}
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
web.on('exit',code=>stop(code||0));
worker.on('exit',code=>{if(!closing)console.error(`[indexer] Worker exited (${code}). Dashboard remains available; check the error above.`);});
