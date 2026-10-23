'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createOnlineServer } = require('../server');
const { Store } = require('../server/store');
const { createRuntime } = require('../server/runtime');
const { AIPool } = require('../server/ai-pool');

async function setup(t, options = {}) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gd-online-test-'));
    const app = createOnlineServer({ dataDir: directory, ...options });
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + app.server.address().port;
    async function request(route, data, cookie = '', more = {}) {
        const response = await fetch(origin + route, { method: data === undefined ? 'GET' : 'POST',
            headers: { ...(data === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json' }), Cookie: cookie, ...more },
            body: data === undefined ? undefined : JSON.stringify(data) });
        return { status: response.status, value: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
    }
    async function guest(name) { const response = await request('/api/session', { nickname: name }); assert.equal(response.status, 200); return response.cookie; }
    async function command(cookie, code, action, extra = {}) {
        const state = (await request('/api/rooms/' + code, undefined, cookie)).value.state;
        return request('/api/rooms/' + code + '/command', { id: crypto.randomUUID(), version: state.version, action, ...extra }, cookie);
    }
    async function table(count = 4) {
        const users = []; for (let i = 0; i < count; i++) users.push(await guest('牌友' + i));
        const made = await request('/api/rooms', {}, users[0]); assert.equal(made.status, 201);
        const code = made.value.state.code;
        for (const user of users.slice(1)) assert.equal((await request('/api/rooms/join', { code }, user)).status, 200);
        return { users, code };
    }
    let stopped = false;
    t.after(async () => {
        if (!stopped) await app.close();
        assert.equal(path.dirname(directory), os.tmpdir()); assert(path.basename(directory).startsWith('gd-online-test-'));
        fs.rmSync(directory, { recursive: true, force: true });
    });
    return { app, origin, directory, request, guest, command, table, markStopped: () => { stopped = true; } };
}

test('guest authentication, origin checks, and static allowlist', async t => {
    const f = await setup(t);
    assert.equal((await f.request('/api/rooms', {})).status, 401);
    assert.equal((await f.request('/api/session', { nickname: '攻击' }, '', { Origin: 'https://elsewhere.invalid' })).status, 403);
    assert.equal((await f.request('/api/session', { nickname: '\u0000' })).status, 400);
    const cookie = await f.guest('<img src=x>');
    assert.equal((await f.request('/api/session', undefined, cookie)).value.nickname, '<img src=x>');
    const page = await fetch(f.origin + '/online.html'); assert.equal(page.status, 200);
    assert(page.headers.get('content-security-policy').includes("script-src 'self'"));
    for (const url of ['/data/online/online-state.json','/server/index.js','/.git/config','/results/g-tc-pilot-outcome-20261021.md'])
        assert.equal((await fetch(f.origin + url)).status, 404);
});

test('room invites, four seats, ready gate, and per-player initial-hand privacy', async t => {
    const f = await setup(t), { users, code } = await f.table();
    const fifth = await f.guest('旁观者');
    assert.equal((await f.request('/api/rooms/join', { code }, fifth)).status, 409);
    assert.equal((await f.request('/api/rooms/' + code, undefined, fifth)).status, 403);
    assert.equal((await f.command(users[0], code, 'start')).status, 409);
    const invite = await f.request('/api/rooms/' + code + '/invite', undefined, users[0]);
    assert(invite.value.url.includes('#room=' + code)); assert(!invite.value.url.includes('gd_guest'));
    for (const user of users) assert.equal((await f.command(user, code, 'ready', { ready: true })).status, 200);
    assert.equal((await f.command(users[1], code, 'start')).status, 409);
    assert.equal((await f.command(users[0], code, 'start')).status, 200);
    const hands = [];
    for (let i = 0; i < 4; i++) {
        const response = await f.request('/api/rooms/' + code, undefined, users[i]), state = response.value.state;
        assert.equal(state.hand.length, 27); assert.equal(state.you, i); hands.push(state.hand.map(c => c.id));
        for (const field of ['hands','audit','invite','receipts','owner','tokenHash']) assert(!Object.hasOwn(state, field));
    }
    assert.equal(new Set(hands.flat()).size, 108);
    for (let i = 0; i < 4; i++) {
        const raw = JSON.stringify((await f.request('/api/rooms/' + code, undefined, users[i])).value);
        for (let j = 0; j < 4; j++) if (i !== j) for (const id of hands[j]) assert(!raw.includes('"' + id + '"'));
    }
});

test('authoritative moves, stale versions, duplicate commands, and forged actor rejection', async t => {
    const f = await setup(t), { users, code } = await f.table();
    for (const user of users) await f.command(user, code, 'ready', { ready: true }); await f.command(users[0], code, 'start');
    assert.equal((await f.command(users[0], code, 'pass')).status, 400);
    assert.equal((await f.command(users[1], code, 'play', { cards: [] })).status, 409);
    const state = (await f.request('/api/rooms/' + code, undefined, users[0])).value.state;
    assert.equal((await f.command(users[0], code, 'play', { cards: [state.hand[0].id], player: 1 })).status, 400);
    assert.equal((await f.command(users[0], code, 'play', { cards: ['not-owned'] })).status, 400);
    const input = { action: 'play', version: state.version, id: crypto.randomUUID(), cards: [state.hand[0].id] };
    const first = await f.request('/api/rooms/' + code + '/command', input, users[0]); assert.equal(first.status, 200);
    const duplicate = await f.request('/api/rooms/' + code + '/command', input, users[0]);
    assert.equal(duplicate.status, 200); assert.equal(duplicate.value.replayed, true);
    assert.equal(duplicate.value.state.hand.length, 26); assert.equal(f.app.rooms.rooms.get(code).engine.publicActionHistory.length, 1);
    assert.equal((await f.request('/api/rooms/' + code + '/command', { ...input, cards: [state.hand[1].id] }, users[0])).status, 409);
    assert.equal((await f.request('/api/rooms/' + code + '/command', { ...input, id: crypto.randomUUID() }, users[0])).status, 409);
});

test('every human seat can manually return tribute and conserves physical cards', () => {
    const runtime = createRuntime();
    for (let p = 0; p < 4; p++) {
        const e = runtime.create(); e.startRound(); const from = (p + 1) % 4;
        // Guarantee this deterministic rule test does not randomly take the resistance branch.
        for (let i = 0; i < e.hands[from].length; i++) if (e.hands[from][i].rank === '大王') {
            const j = e.hands[p].findIndex(c => c.rank !== '大王');
            [e.hands[from][i],e.hands[p][j]]=[e.hands[p][j],e.hands[from][i]];
        }
        e.pendingTributes = [{ from, to: p }]; e.lastTributeExchanges=e.applyPendingTributes(); e.state='tribute';
        assert.equal(e.state, 'tribute'); assert.equal(e.pendingPlayerReturns[0].to, p);
        assert.equal(e.completePlayerReturn('unowned').success, false);
        const chosen = e.selectReturnCard(p, e.pendingPlayerReturns[0].tributeCard); assert(chosen);
        assert.equal(e.completePlayerReturn(chosen.id).success, true); assert.equal(e.state, 'playing');
        assert.equal(new Set(e.hands.flat().map(c => c.id)).size, 108);
        assert(e.hands.every(h => h.length === 27));
    }
});

test('persistent room and identity survive a real server restart', async t => {
    const f = await setup(t), { users, code } = await f.table();
    for (const user of users) await f.command(user, code, 'ready', { ready: true }); await f.command(users[0], code, 'start');
    const before = (await f.request('/api/rooms/' + code, undefined, users[2])).value.state;
    await f.app.close(); f.markStopped();
    const next = createOnlineServer({ dataDir: f.directory });
    await new Promise(resolve => next.server.listen(0, '127.0.0.1', resolve));
    try {
        const origin = 'http://127.0.0.1:' + next.server.address().port;
        const response = await fetch(origin + '/api/rooms/' + code, { headers: { Cookie: users[2] } });
        assert.equal(response.status, 200); const after = (await response.json()).state;
        assert.deepEqual(after.hand, before.hand); assert.deepEqual(after.teamLevel, before.teamLevel);
        assert.equal(after.matchId, before.matchId); assert.equal(after.you, 2);
    } finally { await next.close(); }
});

test('atomic persistence failure rolls a command back before broadcasting success', async t => {
    const f = await setup(t), { users, code } = await f.table(2), room = f.app.rooms.rooms.get(code);
    const version = room.version, save = f.app.store.save.bind(f.app.store);
    f.app.store.save = () => { throw Error('simulated disk failure'); };
    assert.equal((await f.command(users[0], code, 'ready', { ready: true })).status, 500);
    assert.equal(room.version, version); assert.equal(room.seats[0].ready, false);
    f.app.store.save = save;
    assert.equal((await f.command(users[0], code, 'ready', { ready: true })).status, 200);
});

test('replacement connection cannot disconnect its newer generation', async t => {
    const f = await setup(t), cookie = await f.guest('重连玩家'), controller1 = new AbortController(), controller2 = new AbortController();
    const first = await fetch(f.origin + '/api/events', { headers: { Cookie: cookie }, signal: controller1.signal });
    const second = await fetch(f.origin + '/api/events', { headers: { Cookie: cookie }, signal: controller2.signal });
    const text = await first.text(); assert(text.includes('event: replaced'));
    assert.equal(f.app.rooms.connections.size, 1);
    controller1.abort(); assert.equal(f.app.rooms.connections.size, 1); controller2.abort();
});

test('AI public packet excludes all opponent hand contents and yields a legal move', async () => {
    const runtime = createRuntime(true), e = runtime.create(); e.startRound();
    const packet = runtime.packet(e, 0), serialized = JSON.stringify(packet);
    assert(!Object.hasOwn(packet, 'hands')); assert.equal(packet.ownHand.length, 27);
    for (const hand of e.hands.slice(1)) for (const card of hand) assert(!serialized.includes('"' + card.id + '"'));
    const decision = runtime.decidePacket(packet); assert(runtime.legal(e, 0, decision));
    const pool = new AIPool({ budgetMs: 1, size: 1 });
    try { assert.equal((await pool.request(packet)).status, 'timeout'); } finally { await pool.close(); }
});

test('host transfer and expired invitation do not expose room data', async t => {
    const f = await setup(t), { users, code } = await f.table(2);
    assert.equal((await f.command(users[0], code, 'leave')).status, 200);
    const state = (await f.request('/api/rooms/' + code, undefined, users[1])).value.state;
    assert(state.seats[1].owner); assert.equal((await f.request('/api/rooms/' + code, undefined, users[0])).status, 403);
    const third = await f.guest('新朋友'), invite = (await f.request('/api/rooms/' + code + '/invite', undefined, users[1])).value;
    const oldToken = new URLSearchParams(new URL(invite.url).hash.slice(1)).get('invite');
    await f.command(users[1], code, 'rotate-invite');
    assert.equal((await f.request('/api/rooms/join', { code, invite: oldToken }, third)).status, 404);
});

test('corrupt primary is preserved and good backup survives the recovery write', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gd-online-test-'));
    try {
        const first = new Store(directory); first.save(); first.data.metrics.example = 1; first.save();
        fs.writeFileSync(first.file, '{corrupt'); const restored = new Store(directory); assert.equal(restored.data.schema, 'guandan-online-state-v1');
        restored.save(); assert.equal(JSON.parse(fs.readFileSync(restored.backup)).schema, 'guandan-online-state-v1');
        assert(fs.readdirSync(directory).some(name => name.startsWith('corrupt-')));
    } finally { assert.equal(path.dirname(directory), os.tmpdir()); assert(path.basename(directory).startsWith('gd-online-test-')); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('admin is disabled by default and never serves private decks', async t => {
    const f = await setup(t);
    assert.equal((await f.request('/api/admin/status')).status, 404);
});

test('simultaneous ready commands affect only their own seat and both succeed', async t => {
    const f = await setup(t), { users, code } = await f.table(2);
    const version = (await f.request('/api/rooms/' + code, undefined, users[0])).value.state.version;
    const results = await Promise.all(users.map(user => f.request('/api/rooms/' + code + '/command',
        { id: crypto.randomUUID(), version, action: 'ready', ready: true }, user)));
    assert(results.every(r => r.status === 200));
    assert.equal((await f.command(users[0], code, 'start')).status, 200);
});

test('reconnection invalidates an unfinished AI takeover before it can commit', async t => {
    const pending=[],pool={stats:{},request:packet=>new Promise(resolve=>pending.push({packet,resolve})),close:async()=>{for(const p of pending)p.resolve({status:'closed',cards:null});}};
    const f=await setup(t,{pool,rooms:{aiDelayMs:0,graceMs:1000}}),{users,code}=await f.table(2);
    for(const user of users)await f.command(user,code,'ready',{ready:true});await f.command(users[0],code,'start');
    const room=f.app.rooms.rooms.get(code),session=f.app.rooms.sessionForToken(users[0].slice(9));
    session.lastSeen=Date.now()-2000;f.app.rooms.tick();
    assert(room.seats[0].auto);assert.equal(pending.length,1);
    const controller=new AbortController();
    await fetch(f.origin+'/api/events',{headers:{Cookie:users[0]},signal:controller.signal});
    assert.equal(room.seats[0].auto,false);
    pending[0].resolve({status:'ok',cards:[room.engine.hands[0][0].id]});await new Promise(resolve=>setImmediate(resolve));
    assert.equal(room.engine.publicActionHistory.length,0);assert.equal(room.engine.hands[0].length,27);
    controller.abort();
});

test('training consent defaults off and can be granted and withdrawn without exporting data', async t => {
    const f=await setup(t),cookie=await f.guest('授权测试');
    assert.equal((await f.request('/api/session',undefined,cookie)).value.consentTraining,false);
    assert.equal((await f.request('/api/profile/consent',{enabled:true},cookie)).value.consentTraining,true);
    assert.equal((await f.request('/api/profile/consent',{enabled:false},cookie)).value.consentTraining,false);
    assert.equal((await f.request('/api/profile/consent',{enabled:'true'},cookie)).status,400);
    assert.equal((await fetch(f.origin+'/api/training/export',{headers:{Cookie:cookie}})).status,404);
});

test('resuming a paused room renews the actor deadline instead of immediately timing out again', async t => {
    const f=await setup(t),{users,code}=await f.table(2);
    for(const user of users)await f.command(user,code,'ready',{ready:true});await f.command(users[0],code,'start');
    const room=f.app.rooms.rooms.get(code);room.status='paused';room.turnDueAt=Date.now()-60000;
    const controller=new AbortController();await fetch(f.origin+'/api/events',{headers:{Cookie:users[0]},signal:controller.signal});
    assert.equal(room.status,'playing');assert(room.turnDueAt>Date.now()+29000);
    assert.equal(room.seats[0].auto,false);controller.abort();
});

test('authenticated operations expose resource metrics, not credentials or private cards', async t => {
    const secret='test-only-admin-credential-not-a-production-key';
    const f=await setup(t,{adminToken:secret}),{users,code}=await f.table(2);
    assert.equal((await f.request('/api/admin/status')).status,403);
    const headers={Authorization:'Bearer '+secret};
    const result=await f.request('/api/admin/status',undefined,'',headers);assert.equal(result.status,200);
    assert.equal(result.value.measurement.currencyCost,null);assert.equal(result.value.measurement.timezone,'Asia/Shanghai');
    const serialized=JSON.stringify(result.value);for(const name of ['tokenHash','ownHand','receipts','invite=','audit'])assert(!serialized.includes(name));
    assert.equal((await f.request('/api/admin/action',{action:'ban',code,seat:1},'',headers)).status,200);
    assert.equal((await f.request('/api/session',{nickname:'不能直接重建'},users[1])).status,403);
});

test('a complete server-authoritative match passes Ace and independently replays every round', { timeout: 120000 }, async t => {
    const f = await setup(t), { users, code } = await f.table();
    for (const user of users) await f.command(user, code, 'ready', { ready: true }); await f.command(users[0], code, 'start');
    const service=f.app.rooms,room=service.rooms.get(code),sessions=users.map(cookie=>service.sessionForToken(cookie.slice('gd_guest='.length)));
    let steps=0,returns=0;
    const act=(p,action,extra={})=>service.command(sessions[p],room,{id:crypto.randomUUID(),version:room.version,action,...extra});
    while(!room.engine.matchOver && steps++<12000){
        const e=room.engine;
        if(e.state==='finished'){
            for(let p=0;p<4;p++)act(p,'ready',{ready:true});act(0,'next');continue;
        }
        if(e.state==='tribute'){
            const pending=e.pendingPlayerReturns[0],card=e.selectReturnCard(pending.to,pending.tributeCard);
            assert(card);act(pending.to,'return',{card:card.id});returns++;continue;
        }
        const p=e.currentPlayer,packet=service.runtime.packet(e,p),cards=service.runtime.decidePacket(packet);
        assert(service.runtime.legal(e,p,cards));act(p,cards.length?'play':'pass',cards.length?{cards}:{});
    }
    assert(room.engine.matchOver,'full match did not finish');assert(['a','b'].includes(room.engine.matchWinner));
    const replayRuntime=createRuntime(false);let replayed=0;
    for(const round of room.audit){
        const e=replayRuntime.restore(round.initial);
        assert.equal(new Set(e.hands.flat().map(c=>c.id)).size,108);
        for(const action of round.actions){
            let result;
            if(action.type==='return')result=e.completePlayerReturn(action.card);
            else {
                const cards=action.cards.map(id=>e.hands[action.player].find(c=>c.id===id));assert(cards.every(Boolean));
                result=cards.length?e.playCards(action.player,cards):e.passCards(action.player);
            }
            assert(result.success);replayed++;
        }
        assert.equal(e.state,'finished');
        const {timestamp:actualTime,...actual}=JSON.parse(JSON.stringify(e.history.at(-1)));
        const {timestamp:recordedTime,...expected}=round.result;
        assert.equal(typeof actualTime,'string');assert.equal(typeof recordedTime,'string');assert.deepEqual(actual,expected);
    }
    assert.equal(f.app.store.data.metrics.matchesCompleted,1);
    t.diagnostic(JSON.stringify({fullMatch:true,rounds:room.audit.length,actualActionsReplayed:replayed,tributeReturns:returns,passedAce:true,illegal:0}));
});
