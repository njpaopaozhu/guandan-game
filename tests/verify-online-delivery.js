'use strict';
// Run and seal the local-preview checks; explicitly leave deployment and AI research incomplete.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process'),assert=require('node:assert/strict');
const revision=process.argv[2]||'';
assert(!revision||/^r[3-9][0-9]*$/.test(revision),'修订号需为r3及以后');
const suffix=revision?'-'+revision:'';
const root=path.resolve(__dirname,'..'),resultFile=path.join(root,'results/online-delivery-20261022'+suffix+'.json');
const onlineOutput='dist/guandan-online-alpha-20261022-'+(revision||'r2');
const offlineOutput='dist/guandan-3.2.0-verify-20261022'+suffix;
assert(!fs.existsSync(resultFile),'已有验收记录，请先检查，不覆盖旧证据');
const files=['server/index.js','server/rooms.js','server/runtime.js','server/store.js','server/ai-pool.js','server/ai-worker.js',
    'online.html','admin.html','css/online.css','js/online.js','js/online-admin.js','js/invite-qr.js','js/vendor/qrcodegen.js',
    'tests/online.test.js','tests/online-load.test.js','tests/verify-online-delivery.js',
    'tools/build_online_release.js','tools/verify_online_release.js','tools/build_release.js','package.json',
    'js/ai.js','js/ai-policy-weights.js','js/engine.js','ONLINE_README.md','docs/ONLINE_COMMERCIAL_GATES.md'];
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const seals=Object.fromEntries(files.map(file=>[file,sha(path.join(root,file))]));
assert.equal(seals['js/ai.js'],'642da5eced3d01830a411035aa896bb2da5b6ea6cd25ff918e436adc88ddffe7');
assert.equal(seals['js/ai-policy-weights.js'],'162015a33d11c65cbfb5e6738791db9d867d63ab409d9d3e49e1a2be16bd805d');
const course=[['rules',['test_node.js']],['online',['--test','tests/online.test.js']],['capacity',['--test','tests/online-load.test.js']],
    ['online-release',['tools/build_online_release.js','--output',onlineOutput,'--verify']],
    ['offline-release',['tools/build_release.js','--output',offlineOutput,'--verify']]];
const results=[];
for(const [name,args]of course){
    console.log('验证阶段：'+name);
    const started=Date.now(),run=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',timeout:180000,maxBuffer:8*1024*1024});
    results.push({name,args,code:run.status,seconds:(Date.now()-started)/1000,stdout:run.stdout||'',stderr:run.stderr||''});
    if(run.status!==0){console.error(run.stdout,run.stderr);throw Error('验收未通过：'+name);}
    console.log('阶段通过：'+name+' ('+results.at(-1).seconds.toFixed(1)+'s)');
}
for(const[file,hash]of Object.entries(seals))assert.equal(sha(path.join(root,file)),hash,'验收中源码改变：'+file);
const offline=JSON.parse(fs.readFileSync(path.join(root,offlineOutput,'package.json')));
assert(!Object.keys(offline.scripts).some(command=>command.includes('online')),'单机包残留无依赖的联机命令');
const capacityDir=path.join(root,'output/online');
const capacity=fs.readdirSync(capacityDir).filter(f=>/^capacity-\d+\.json$/.test(f)).sort().at(-1);
const capacityPath=path.join(capacityDir,capacity),capacityProof=JSON.parse(fs.readFileSync(capacityPath));
for(const[file,hash]of Object.entries(capacityProof.sourceHashes))assert.equal(sha(path.join(root,file)),hash);
const proof={status:'local-preview-checks-passed',createdAt:new Date().toISOString(),sourceHashes:seals,results,
    capacityReport:capacityPath,capacitySHA256:sha(capacityPath),productionAIUnchanged:true,
    requirements:{privateRoomAPI:true,privateHandAllowlist:true,manualReturnsAllSeats:true,requestIdempotency:true,
        persistentRecovery:true,staleAIReconnection:true,consentDefaultOff:true,realCompleteAceMatch:true,
        tenRoomEstablishedSessionProbe:true,independentBrowserEvidence:'output/playwright/online-20261022',
        crossNetworkVerified:false,longDurationProductionLoadVerified:false,newAICandidateVerified:false,
        accountSystem:false,paidEntitlements:false,publicDeployment:false},
    overallGoalComplete:false,note:'本地联机交付检查通过，不把它缩写成整个商业化与AI联合目标完成。'};
fs.writeFileSync(resultFile,JSON.stringify(proof,null,2),{flag:'wx'});
console.log(JSON.stringify({status:proof.status,resultFile,overallGoalComplete:false}));
