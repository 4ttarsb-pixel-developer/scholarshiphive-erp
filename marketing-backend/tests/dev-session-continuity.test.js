const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');

const service=path.resolve(__dirname,'../src/services/auth.service.js');
function callAuth(workingDir,code){
  return execFileSync(process.execPath,['-e', `const auth=require(${JSON.stringify(service)}); ${code}`],{
    encoding:'utf8',env:{...process.env,NODE_ENV:'development',MEA_DEV_SESSIONS_PATH:path.join(workingDir,'demo-sessions.json')}
  }).trim();
}
test('demo login survives backend restart, and logout invalidates restored session',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mea-session-'));
  try{
    const token=callAuth(dir,"(async()=>{process.stdout.write((await auth.login({email:'admin@mea.test',password:'AdminDemo!2026'})).token)})()");
    assert.match(token,/^[a-f0-9]{64}$/);
    const disk=fs.readFileSync(path.join(dir,'demo-sessions.json'),'utf8');
    assert.ok(!disk.includes(token),'raw bearer token must never be stored');
    assert.ok(!disk.includes('AdminDemo!2026'),'password must never be stored');
    assert.equal(callAuth(dir,`(async()=>{process.stdout.write((await auth.resolve(${JSON.stringify(token)}))?.email||'invalid')})()`),'admin@mea.test');
    callAuth(dir,`(async()=>{await auth.logout(${JSON.stringify(token)})})()`);
    assert.equal(callAuth(dir,`(async()=>{process.stdout.write(String(await auth.resolve(${JSON.stringify(token)})))})()`),'null');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('nodemon only watches backend source, not sync archive JSON changes',()=>{
  const config=require('../nodemon.json');
  assert.deepEqual(config.watch,['src']);
  assert.ok(config.ignore.some(item=>item.includes('var')));
});
