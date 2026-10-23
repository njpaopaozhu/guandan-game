'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(process.env.GUANDAN_CLIENT_TEST_SOURCE||path.join(__dirname,'../js/online.js'),'utf8'),flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({authenticated=true,room=true}={}){
    const nodes=new Map(),streams=[];
    const element=()=>({textContent:'',value:'',classList:{toggle(){}},addEventListener(){},replaceChildren(){},append(){},setAttribute(){},dataset:{}});
    const node=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
    const state={code:'12345678',version:1,you:0,status:'waiting',state:'playing',hand:[],history:[],lastPlay:null,roundNumber:1,levelCard:'2',teamLevel:{a:0,b:0},
        seats:Array.from({length:4},(_,i)=>({name:'测试'+i,owner:i===0,you:i===0,human:i===0,occupied:i===0,connected:i===0,team:i%2?'B':'A',ready:false})),canStart:false};
    const response=value=>({ok:true,json:async()=>value});let releaseRoom;
    const pendingRoom=new Promise(resolve=>{releaseRoom=()=>resolve(response({state}));});
    class EventSourceMock{
        constructor(url){assert.equal(url,'/api/events');this.events={};streams.push(this);}
        addEventListener(name,callback){this.events[name]=callback;}
        close(){this.closed=true;}
    }
    const context=vm.createContext({document:{getElementById:node,createElement:element,querySelectorAll:()=>[]},window:{addEventListener(){}},
        location:{protocol:'http:',hash:'',pathname:'/online.html'},history:{replaceState(){}},URLSearchParams,crypto:{randomUUID:()=> 'unit-test'},
        EventSource:EventSourceMock,setInterval:()=>0,setTimeout:()=>0,
        fetch:async url=>{if(url==='/api/session')return response({authenticated,nickname:'测试',roomCode:room?'12345678':null,consentTraining:false});if(url==='/api/rooms/12345678')return pendingRoom;throw Error('unexpected request '+url);}});
    vm.runInContext(source,context);return {nodes,streams,releaseRoom};
}
test('room restoration must not overwrite an already opened real-time connection',async()=>{
    const f=fixture();await flush();assert.equal(f.streams.length,1);f.streams[0].onopen();assert.equal(f.nodes.get('connection').textContent,'实时连接');
    f.releaseRoom();await flush();assert.equal(f.nodes.get('connection').textContent,'实时连接');assert.equal(f.nodes.get('room-number').textContent,'12345678');
});
test('room restoration must not overwrite a disconnect/reconnecting status',async()=>{
    const f=fixture();await flush();f.streams[0].onerror();f.releaseRoom();await flush();assert.equal(f.nodes.get('connection').textContent,'连接中断，正在重连');
});
test('room restoration must not overwrite a replaced-session status',async()=>{
    const f=fixture();await flush();f.streams[0].events.replaced({data:JSON.stringify({message:'其他页面已接管'})});f.releaseRoom();await flush();
    assert.equal(f.nodes.get('connection').textContent,'此页已离线');assert.equal(f.streams[0].closed,true);assert.equal(f.streams.length,1);
});
test('authenticated lobby starts connecting and then shows real-time open',async()=>{
    const f=fixture({room:false});await flush();assert.equal(f.nodes.get('connection').textContent,'正在连接');f.streams[0].onopen();assert.equal(f.nodes.get('connection').textContent,'实时连接');
});
test('anonymous lobby is available without opening an authenticated stream',async()=>{
    const f=fixture({authenticated:false,room:false});await flush();assert.equal(f.nodes.get('connection').textContent,'联机服务可用');assert.equal(f.streams.length,0);
});
