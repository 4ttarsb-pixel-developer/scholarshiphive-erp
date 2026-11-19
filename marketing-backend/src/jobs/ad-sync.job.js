// PostgreSQL mode: durable 15-minute enqueue + continuously running DB job
// processor; one job per account per 15-minute interval, safe after restarts.
// Memory mode retains the original development-only timer.
const sync=require('../services/ad-integration.service');
const queue=require('./ad-sync.queue');
const store=(process.env.PERSISTENCE_DRIVER||'memory').toLowerCase()==='postgres' ? null : require('../data/mock.store');
const archive=(process.env.PERSISTENCE_DRIVER||'memory').toLowerCase()==='postgres' ? null : require('../services/ad-history.store');

const IS_PG=(process.env.PERSISTENCE_DRIVER||'memory').toLowerCase()==='postgres';
const FIFTEEN_MINUTES=15*60*1000;
const POLL_MS=5000;
let processorBusy=false;
let producerBusy=false;
async function enqueueDue(){
 if(!IS_PG)return 0;
 return (async()=>{
  const today=new Date().toISOString().slice(0,10);
  const start=new Date(Date.now()-6*86400000).toISOString().slice(0,10);
  let count=0;
  for(const a of await require('../services/pg/common').accounts({role:'Admin'})){
   if(a.lastVerifiedAt && sync.configStatus(a.platform)){
    if(await queue.enqueue(a.id,{startDate:start,endDate:today,reason:'scheduled'}))count++;
   }
  }
  return count;
 })();
}
async function processDueJobs(workerId='mea-worker-'+process.pid,max=4){
 if(!IS_PG)return 0;
 return (async()=>{
  let processed=0;
  for(let i=0;i<max;i++){
   const job=await queue.claim(workerId);
   if(!job)break;
   // Durable queue leases + transaction-scoped account claim locks prevent
   // duplicate same-account workers without session-level advisory locks.
   const heartbeat=setInterval(()=>queue.heartbeat(job.id,workerId).catch(err=>console.error('[MEA] Sync lease renewal:',err.message)),30000);
   heartbeat.unref();
   try{
    const a=await require('../services/pg/common').account(job.accountId,{role:'Admin'});
    if(!a)throw new Error('Ad account not found');
    await sync.runWindow(a,{startDate:job.startDate,endDate:job.endDate});
    await queue.complete(job.id,workerId);
   }catch(e){
    // PG runtime records sync failure in runWindow; queue owns job retry state.
    await queue.fail(job.id,e.message,workerId).catch(err=>console.error('[MEA] Cannot record sync failure:',err.message));
   }finally{
    clearInterval(heartbeat);
   }
   processed++;
  }
  return processed;
 })();
}

function startScheduler(){
 if(process.env.NODE_ENV==='test')return ()=>{};
 if(!IS_PG){
  const timer=setInterval(()=>sync.tick().catch(e=>console.error('[MEA] Dev sync:',e.message)),FIFTEEN_MINUTES);
  timer.unref();
  return ()=>clearInterval(timer);
 }
 const produce=async()=>{
  if(producerBusy)return;producerBusy=true;
  try{await enqueueDue();}catch(e){console.error('[MEA] Scheduled enqueue failed:',e.message);}finally{producerBusy=false;}
 };
 const consume=async()=>{
  if(processorBusy)return;processorBusy=true;
  try{await processDueJobs();}catch(e){console.error('[MEA] Sync worker failed:',e.message);}finally{processorBusy=false;}
 };
 // Process jobs queued before a restart immediately; scheduled enqueue starts
 // now and repeats every 15 minutes, independent of user page requests.
 void produce();void consume();
 const producer=setInterval(produce,FIFTEEN_MINUTES);
 const worker=setInterval(consume,POLL_MS);
 producer.unref();worker.unref();
 console.log('[MEA] PostgreSQL 15-minute sync producer + durable DB worker active');
 return ()=>{clearInterval(producer);clearInterval(worker)};
}
module.exports={startScheduler,enqueueDue,processDueJobs};
