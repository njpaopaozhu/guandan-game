'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {performance}=require('node:perf_hooks');
const {createOnlineServer}=require('../server');

test('10 rooms / 40 established identities: real streams, AI activity, and request latency', {timeout:60000}, async t=>{
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'gd-online-test-'));
    const app=createOnlineServer({dataDir:directory}),controllers=[],readers=[],errors=[];
    await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
    const origin='http://127.0.0.1:'+app.server.address().port,clients=[],codes=[];let frames=0;
    async function req(route,cookie,data){
        const response=await fetch(origin+route,{method:data===undefined?'GET':'POST',headers:{Cookie:cookie,...(data===undefined?{}:{Origin:origin,'Content-Type':'application/json'})},body:data===undefined?undefined:JSON.stringify(data)});
        const value=await response.json();assert.equal(response.status,route==='/api/rooms'?201:200,JSON.stringify(value));return value;
    }
    async function command(client,action,extra={}){
        const {state}=await req('/api/rooms/'+client.code,client.cookie);
        return req('/api/rooms/'+client.code+'/command',client.cookie,{id:crypto.randomUUID(),version:state.version,action,...extra});
    }
    try{
        // Pre-provision established guests so this is capacity, not bypassing the signup anti-abuse limit.
        for(let i=0;i<40;i++){
            const {raw}=app.rooms.createSession('压测牌友'+i);const cookie='gd_guest='+raw;
            const client={cookie,code:null,seat:i%4};clients.push(client);
            if(i%4===0){const value=await req('/api/rooms',cookie,{});client.code=value.state.code;codes.push(client.code);}
            else{client.code=codes.at(-1);await req('/api/rooms/join',cookie,{code:client.code});}
        }
        for(const client of clients){
            const controller=new AbortController();controllers.push(controller);
            const response=await fetch(origin+'/api/events',{headers:{Cookie:client.cookie},signal:controller.signal});assert.equal(response.status,200);
            const reader=response.body.getReader();readers.push((async()=>{
                const decoder=new TextDecoder();let buffer='';
                try{while(true){const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let end;
                    while((end=buffer.indexOf('\n\n'))>=0){const part=buffer.slice(0,end);buffer=buffer.slice(end+2);const line=part.split('\n').find(s=>s.startsWith('data: '));
                        if(!line||!part.includes('event: state'))continue;const state=JSON.parse(line.slice(6));
                        assert.equal(state.code,client.code);assert.equal(state.you,client.seat);assert(!Object.hasOwn(state,'hands'));assert(!Object.hasOwn(state,'audit'));frames++;
                    }
                }}catch(error){if(error.name!=='AbortError')errors.push(error.message);}
            })());
        }
        assert.equal(app.rooms.connections.size,40);
        for(const client of clients)await command(client,'ready',{ready:true});
        for(const client of clients.filter(c=>c.seat===0))await command(client,'start');
        for(const client of clients)await command(client,'auto',{enabled:true});
        const latency=[],started=performance.now();
        for(let batch=0;batch<5;batch++){
            await Promise.all(clients.map(async client=>{const at=performance.now();const value=await req('/api/rooms/'+client.code,client.cookie);assert.equal(value.state.you,client.seat);latency.push(performance.now()-at);}));
            await new Promise(resolve=>setTimeout(resolve,500));
        }
        const wait=5000-(performance.now()-started);if(wait>0)await new Promise(resolve=>setTimeout(resolve,wait));
        latency.sort((a,b)=>a-b);const p95=latency[Math.ceil(latency.length*.95)-1];
        assert.equal(errors.length,0);assert.equal(app.rooms.rooms.size,10);assert.equal(app.rooms.connections.size,40);
        assert((app.store.data.metrics.aiActions||0)>=20);assert(p95<500,'private preview request p95 exceeds 500ms: '+p95);
        assert.equal(app.store.data.metrics.aiInvalidFallbacks||0,0);
        const report={status:'passed',rooms:10,establishedGuestIdentities:40,simultaneousStreams:40,framesChecked:frames,
            measuredRequests:latency.length,requestP50Ms:latency[Math.ceil(latency.length*.5)-1],requestP95Ms:p95,
            observationMs:performance.now()-started,aiActions:app.store.data.metrics.aiActions,ai:app.pool.stats,
            illegalAIFallbacks:app.store.data.metrics.aiInvalidFallbacks||0,crossRoomFrames:0,
            scope:'local 5-second established-session capacity probe, not an external-network or long-duration production certification'};
        const root=path.resolve(__dirname,'..'),output=path.join(root,'output','online');fs.mkdirSync(output,{recursive:true});
        report.sourceHashes=Object.fromEntries(['server/index.js','server/rooms.js','server/runtime.js','server/store.js','server/ai-pool.js','server/ai-worker.js','tests/online-load.test.js'].map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')]));
        const target=path.join(output,'capacity-'+Date.now()+'.json');fs.writeFileSync(target,JSON.stringify(report,null,2),{flag:'wx'});
        t.diagnostic(JSON.stringify({...report,sourceHashes:undefined,report:target}));
    }finally{
        for(const controller of controllers)controller.abort();await Promise.all(readers);await app.close();
        assert.equal(path.dirname(directory),os.tmpdir());assert(path.basename(directory).startsWith('gd-online-test-'));fs.rmSync(directory,{recursive:true,force:true});
    }
});
