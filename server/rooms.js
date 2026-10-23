'use strict';
const crypto = require('node:crypto');
const { createRuntime } = require('./runtime');

class HTTPError extends Error {
    constructor(status, message) { super(message); this.status = status; }
}
const fail = (condition, status, message) => { if (!condition) throw new HTTPError(status, message); };
const copy = value => JSON.parse(JSON.stringify(value));
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const token = () => crypto.randomBytes(32).toString('hex');

class Rooms {
    constructor(store, pool, options = {}) {
        this.store = store; this.pool = pool; this.runtime = createRuntime(true);
        this.options = { maxRooms: 10, graceMs: 15000, turnMs: 30000, aiDelayMs: 400,
            roomTTL: 24 * 3600e3, sessionTTL: 30 * 24 * 3600e3, ...options };
        this.rooms = new Map(); this.connections = new Map(); this.closed = false;
        for (const saved of store.data.rooms) {
            const room = { ...saved, engine: saved.engine ? this.runtime.restore(saved.engine) : null, busy: null };
            if (room.expiresAt > Date.now() && !['closed', 'aborted'].includes(room.status)) this.rooms.set(room.code, room);
        }
        // A process restart never pretends an old transport connection survived.
        for (const session of this.store.data.sessions) session.lastSeen = 0;
        this.timer = setInterval(() => this.tick(), 100); this.timer.unref();
    }
    metric(name, n = 1) { this.store.data.metrics[name] = (this.store.data.metrics[name] || 0) + n; }
    pack(room) { const { busy, ...value } = room; return copy(value); }
    persist() { this.store.data.rooms = [...this.rooms.values()].map(room => this.pack(room)); this.store.save(); }
    sessionForToken(raw) {
        if (!/^[a-f0-9]{64}$/.test(raw || '')) return null;
        const session = this.store.data.sessions.find(s => s.tokenHash === digest(raw) && s.expiresAt > Date.now());
        return session && !this.store.data.bans.includes(session.id) ? session : null;
    }
    createSession(nickname, existing = null) {
        fail(typeof nickname === 'string' && nickname.trim().length >= 1 && [...nickname.trim()].length <= 16
            && !/[\u0000-\u001f\u007f]/.test(nickname), 400, '昵称需为1–16个可显示字符');
        const before = copy(this.store.data.sessions); let raw = null;
        const session = existing || { id: crypto.randomUUID(), tokenHash: digest(raw = token()),
            createdAt: Date.now(), consentTraining: false, expiresAt: Date.now() + this.options.sessionTTL };
        session.nickname = nickname.trim(); session.lastSeen = Date.now();
        if (!existing) { fail(this.store.data.sessions.length < 5000, 503, '体验名额暂满'); this.store.data.sessions.push(session); }
        try { this.persist(); } catch (error) { this.store.data.sessions = before; throw error; }
        return { session, raw };
    }
    profile(session) {
        const room = [...this.rooms.values()].find(r => r.seats.some(s => s.uid === session.id));
        return { nickname: session.nickname, consentTraining: session.consentTraining, roomCode: room?.code || null };
    }
    visit(session) {
        const day = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
        session.lastSeen = Date.now();
        if (!session.visitDays?.includes(day)) {
            session.visitDays = [...(session.visitDays || []), day].slice(-31); this.persist();
        }
    }
    consent(session, enabled) {
        fail(typeof enabled === 'boolean', 400, '授权选项无效');
        const previous = session.consentTraining; session.consentTraining = enabled;
        try { this.persist(); } catch (error) { session.consentTraining = previous; throw error; }
    }
    funnel(name) {
        const previous = { ...this.store.data.metrics }; this.metric(name);
        try { this.persist(); } catch (error) { this.store.data.metrics = previous; throw error; }
    }
    live(uid) {
        if (this.connections.has(uid)) return true;
        const session = this.store.data.sessions.find(s => s.id === uid);
        return session && Date.now() - session.lastSeen < this.options.graceMs;
    }
    get(code, session) {
        const room = this.rooms.get(code);
        fail(room && room.expiresAt > Date.now() && !['closed', 'aborted'].includes(room.status), 404, '房间不存在或已失效');
        fail(room.seats.some(s => s.uid === session.id), 403, '你未加入这个房间'); return room;
    }
    change(room, type, fn) {
        const before = this.pack(room), metrics = { ...this.store.data.metrics }, oldEvents = [...this.store.data.events], oldBans = [...this.store.data.bans];
        try {
            fn(); room.version++; room.updatedAt = Date.now();
            this.store.data.events.push({ at: room.updatedAt, room: room.code, type, version: room.version });
            this.store.data.events = this.store.data.events.slice(-2000); this.persist();
        } catch (error) {
            const busy = room.busy; Object.assign(room, before, { engine: before.engine ? this.runtime.restore(before.engine) : null, busy });
            this.store.data.metrics = metrics; this.store.data.events = oldEvents; this.store.data.bans = oldBans; throw error;
        }
        this.broadcast(room);
    }
    create(session) {
        fail(![...this.rooms.values()].some(r => r.seats.some(s => s.uid === session.id)), 409, '请先离开当前房间');
        fail(this.rooms.size < this.options.maxRooms, 503, '房间已满，请稍后再试');
        let code; do { code = String(crypto.randomInt(10000000, 100000000)); } while (this.rooms.has(code));
        const seats = Array.from({ length: 4 }, () => ({ uid: null, bot: false, ready: false, auto: false, epoch: 0 }));
        seats[0].uid = session.id;
        const room = { code, invite: token(), inviteExpiresAt: Date.now() + this.options.roomTTL,
            createdAt: Date.now(), updatedAt: Date.now(), expiresAt: Date.now() + this.options.roomTTL,
            owner: session.id, version: 0, status: 'waiting', seats, engine: null, busy: null,
            receipts: [], audit: [], matchId: crypto.randomUUID(), turnKey: null, turnDueAt: null };
        this.rooms.set(code, room);
        try { this.change(room, 'created', () => this.metric('roomsCreated')); }
        catch (error) { this.rooms.delete(code); throw error; }
        return room;
    }
    join(session, { code, invite }) {
        const room = this.rooms.get(code);
        fail(room && room.expiresAt > Date.now(), 404, '房间不存在或邀请已失效');
        if (room.seats.some(s => s.uid === session.id)) return room;
        fail(![...this.rooms.values()].some(r => r.seats.some(s => s.uid === session.id)), 409, '请先离开当前房间');
        fail(room.status === 'waiting', 409, '比赛已开始，暂不接受新玩家');
        fail(room.inviteExpiresAt > Date.now() && (!invite || invite === room.invite), 404, '邀请已失效');
        const seat = room.seats.find(s => !s.uid); fail(seat, 409, '房间已满');
        this.change(room, 'joined', () => { Object.assign(seat, { uid: session.id, bot: false, ready: false, auto: false, epoch: seat.epoch + 1 }); this.metric('playersJoined'); });
        return room;
    }
    snapshot(room, session) {
        const seat = room.seats.findIndex(s => s.uid === session.id); fail(seat >= 0, 403, '不允许旁观');
        const e = room.engine;
        const seats = room.seats.map((s, i) => {
            const person = this.store.data.sessions.find(p => p.id === s.uid);
            return { index: i, name: person?.nickname || (s.bot ? 'AI ' + (i + 1) : '空位'),
                occupied: Boolean(s.uid || s.bot), human: Boolean(s.uid), ready: s.ready,
                connected: s.uid ? Boolean(this.live(s.uid)) : true, auto: Boolean(s.bot || s.auto),
                owner: s.uid === room.owner, you: i === seat, count: e?.hands[i].length || 0,
                finished: e?.playerFinished[i] || false, team: i % 2 === 0 ? 'A' : 'B' };
        });
        // Explicit public allowlist. Never serialize a private engine/room and delete a field afterward.
        return { schema: 'guandan-online-public-v1', code: room.code, version: room.version, status: room.status,
            you: seat, seats, expiresAt: room.expiresAt, matchId: room.matchId, turnDueAt: room.turnDueAt,
            state: e?.state || 'idle', hand: e ? copy(e.hands[seat]) : [], currentPlayer: e?.currentPlayer ?? null,
            levelCard: e?.levelCard || '2', teamLevel: e ? copy(e.teamLevel) : { a: 0, b: 0 },
            roundNumber: e?.roundNumber || 1, matchOver: Boolean(e?.matchOver), matchWinner: e?.matchWinner || null,
            lastPlay: e?.lastPlay ? copy(e.lastPlay) : null, lastPlayType: e?.lastPlayType ? copy(e.lastPlayType) : null,
            lastPlayer: e?.lastPlayer ?? -1, finishOrder: e ? [...e.finishOrder] : [],
            history: e ? copy(e.history) : [], lastActions: e ? copy(e.publicActionHistory.slice(-8)) : [],
            returnFor: e?.state === 'tribute' ? e.pendingPlayerReturns[0]?.to ?? null : null,
            tribute: e ? copy(e.lastTributeExchanges) : [], tributeResisted: Boolean(e?.lastTributeResisted),
            canStart: session.id === room.owner && room.status === 'waiting'
                && room.seats.filter(s => s.uid).length >= 2 && room.seats.filter(s => s.uid).every(s => s.ready && this.live(s.uid)) };
    }
    broadcast(room) {
        for (const seat of room.seats) {
            const connection = this.connections.get(seat.uid);
            const session = this.store.data.sessions.find(s => s.id === seat.uid);
            if (connection && session) connection.send('state', this.snapshot(room, session));
        }
    }
    attach(session, send, close) {
        const previous = this.connections.get(session.id), connection = { send, close };
        this.connections.set(session.id, connection); session.lastSeen = Date.now();
        if (previous) { previous.send('replaced', { message: '此身份已在另一页面连接，本页停止自动重连' }); previous.close(); }
        const room = [...this.rooms.values()].find(r => r.seats.some(s => s.uid === session.id));
        if (room) this.change(room, 'connected', () => {
            const seat = room.seats.find(s => s.uid === session.id);
            const restoring = room.status === 'paused' || (seat.auto && seat.autoReason !== 'manual');
            if (seat.auto && seat.autoReason !== 'manual') { seat.auto = false; seat.epoch++; }
            if (room.status === 'paused') room.status = 'playing';
            const actor = room.engine?.state === 'tribute' ? room.engine.pendingPlayerReturns[0]?.to : room.engine?.currentPlayer;
            if (restoring && room.seats[actor] === seat) room.turnDueAt = Date.now() + this.options.turnMs;
            this.metric('connections');
        });
        return () => {
            if (this.connections.get(session.id) !== connection) return;
            this.connections.delete(session.id); session.lastSeen = Date.now();
            if (room && this.rooms.has(room.code)) this.broadcast(room);
        };
    }
    command(session, room, command) {
        fail(command && typeof command.id === 'string' && /^[a-zA-Z0-9-]{8,80}$/.test(command.id), 400, '行动编号无效');
        const fields = { ready: ['ready'], seat: ['seat'], play: ['cards'], pass: [], return: ['card'], auto: ['enabled'],
            start: [], next: [], rematch: [], 'rotate-invite': [], leave: [] };
        fail(Object.hasOwn(fields, command.action) && Object.keys(command).every(k => ['id','version','action',...fields[command.action]].includes(k)), 400, '行动字段无效');
        const hash = digest(JSON.stringify(command));
        const previous = room.receipts.find(r => r.uid === session.id && r.id === command.id);
        if (previous) { fail(previous.hash === hash, 409, '行动编号不可用于不同操作'); return { replayed: true, state: this.snapshot(room, session) }; }
        const independentControl = ['ready', 'auto', 'leave', 'rotate-invite'].includes(command.action);
        fail(Number.isSafeInteger(command.version) && command.version <= room.version
            && (independentControl || command.version === room.version), 409, '牌桌已更新，请按最新局面重试');
        const p = room.seats.findIndex(s => s.uid === session.id), own = room.seats[p];
        const owner = session.id === room.owner;
        fail(p >= 0, 403, '座位不属于你');
        this.change(room, command.action, () => {
            const e = room.engine;
            switch (command.action) {
                case 'ready':
                    fail(room.status === 'waiting' || e?.state === 'finished', 409, '当前不能准备');
                    fail(typeof command.ready === 'boolean', 400, '准备状态无效'); own.ready = command.ready; break;
                case 'seat': {
                    fail(room.status === 'waiting' && !own.ready, 409, '请在准备前换座');
                    fail(Number.isInteger(command.seat) && command.seat >= 0 && command.seat < 4, 400, '座位无效');
                    const target = room.seats[command.seat]; fail(!target.uid, 409, '该座位已有人');
                    target.uid = own.uid; target.bot = false; target.ready = false; target.auto = false; target.epoch++;
                    own.uid = null; own.bot = false; own.ready = false; own.auto = false; own.epoch++; break;
                }
                case 'start':
                    fail(owner && this.snapshot(room, session).canStart, 409, '需至少两位在线真人且全部准备');
                    room.engine = this.runtime.create(); room.status = 'playing'; room.audit = []; this.startRound(room);
                    for (const s of room.seats) { if (!s.uid) s.bot = true; s.ready = false; }
                    this.metric('matchesStarted'); break;
                case 'play': case 'pass': {
                    fail(room.status === 'playing' && e?.state === 'playing' && e.currentPlayer === p && !own.auto, 409, '现在不是你的手动回合');
                    const cards = this.runtime.validate(e, p, command.action === 'pass' ? [] : command.cards);
                    fail(cards, 400, '选牌不属于你或包含重复牌');
                    fail(command.action !== 'play' || cards.length > 0, 400, '请至少选择一张牌');
                    const result = cards.length ? e.playCards(p, cards) : e.passCards(p);
                    fail(result.success, 400, result.error); this.recordAction(room, p, cards.map(c => c.id), 'human'); break;
                }
                case 'return': {
                    fail(e?.state === 'tribute' && e.pendingPlayerReturns[0]?.to === p && !own.auto, 409, '现在不是你的还牌阶段');
                    const result = e.completePlayerReturn(command.card); fail(result.success, 400, result.error);
                    room.audit.at(-1).actions.push({ type: 'return', player: p, card: command.card, origin: 'human' }); break;
                }
                case 'auto':
                    fail(room.status === 'playing' || room.status === 'paused', 409, '比赛尚未开始');
                    fail(e && ['playing','tribute'].includes(e.state), 409, '本副已结束，不需要托管');
                    fail(typeof command.enabled === 'boolean', 400, '托管状态无效');
                    if (own.auto && !command.enabled && (e.state === 'tribute' ? e.pendingPlayerReturns[0]?.to : e.currentPlayer) === p)
                        room.turnDueAt = Date.now() + this.options.turnMs;
                    own.auto = command.enabled; own.autoReason = command.enabled ? 'manual' : null; own.epoch++;
                    if (room.status === 'paused') room.status = 'playing'; break;
                case 'next':
                    fail(owner && e?.state === 'finished' && !e.matchOver, 409, '仅房主可开始下一副');
                    fail(room.seats.filter(s => s.uid && this.live(s.uid)).every(s => s.ready), 409, '请等待在线玩家准备');
                    this.startRound(room); for (const s of room.seats) s.ready = false; break;
                case 'rematch':
                    fail(owner && e?.matchOver, 409, '完整比赛结束后才能再来一场');
                    room.engine = null; room.status = 'waiting'; room.audit = []; room.matchId = crypto.randomUUID();
                    for (const s of room.seats) { s.ready = false; s.auto = false; s.epoch++; } break;
                case 'rotate-invite':
                    fail(owner && room.status === 'waiting', 403, '仅房主可在等待阶段重置邀请'); room.invite = token(); break;
                case 'leave':
                    own.uid = null; own.bot = room.status !== 'waiting'; own.auto = false; own.ready = false; own.epoch++;
                    if (owner) room.owner = room.seats.find(s => s.uid && this.live(s.uid))?.uid || room.seats.find(s => s.uid)?.uid || null;
                    if (!room.owner) room.status = 'closed'; break;
                default: throw new HTTPError(400, '不支持的操作');
            }
            room.receipts.push({ uid: session.id, id: command.id, hash }); room.receipts = room.receipts.slice(-256);
            session.lastSeen = Date.now(); this.updateTurn(room);
        });
        return { replayed: false, state: command.action === 'leave' ? null : this.snapshot(room, session) };
    }
    startRound(room) {
        room.engine.startRound(); room.turnKey = null;
        room.audit.push({ round: room.engine.roundNumber, initial: copy(room.engine), actions: [] });
        if (room.audit.length > 100) throw new HTTPError(409, '比赛轮数超过保护上限，请联系房主结束房间');
        this.metric('roundsStarted'); this.updateTurn(room);
    }
    recordAction(room, player, cards, origin) {
        const session = this.store.data.sessions.find(s => s.id === room.seats[player].uid);
        room.audit.at(-1).actions.push({ type: cards.length ? 'play' : 'pass', player, cards, origin,
            trainingConsentAtAction: Boolean(session?.consentTraining) });
        this.metric('actions'); if (origin !== 'human') this.metric('aiActions');
        if (room.engine.state === 'finished') {
            room.audit.at(-1).result = copy(room.engine.history.at(-1)); this.metric('roundsCompleted');
            if (room.engine.matchOver) this.metric('matchesCompleted');
        }
    }
    updateTurn(room) {
        const e = room.engine; if (!e) return;
        const player = e.state === 'tribute' ? e.pendingPlayerReturns[0]?.to : e.currentPlayer;
        const key = e.roundNumber + ':' + e.state + ':' + player + ':' + e.publicActionHistory.length + ':' + e.pendingPlayerReturns.length;
        if (room.turnKey !== key) { room.turnKey = key; room.turnDueAt = Date.now() + this.options.turnMs; room.aiAfter = Date.now() + this.options.aiDelayMs; }
    }
    tick() {
        if (this.closed) return;
        for (const room of this.rooms.values()) {
            try {
                if (Date.now() > room.expiresAt || room.status === 'closed') {
                    this.rooms.delete(room.code); for (const s of room.seats) this.connections.get(s.uid)?.send('closed', { message: '房间已关闭或到期' }); this.persist(); continue;
                }
                if (room.owner && !this.live(room.owner)) {
                    const next = room.seats.find(s => s.uid && this.live(s.uid));
                    if (next && next.uid !== room.owner) this.change(room, 'owner-transferred', () => { room.owner = next.uid; });
                }
                if (room.status !== 'playing' || !room.engine || room.busy) continue;
                const e = room.engine; if (!['playing', 'tribute'].includes(e.state)) continue;
                if (!room.seats.some(s => s.uid && this.live(s.uid))) {
                    this.change(room, 'paused', () => { room.status = 'paused'; }); continue;
                }
                this.updateTurn(room);
                const p = e.state === 'tribute' ? e.pendingPlayerReturns[0].to : e.currentPlayer, seat = room.seats[p];
                if (seat.uid && !seat.auto && (!this.live(seat.uid) || Date.now() > room.turnDueAt)) {
                    this.change(room, 'auto-takeover', () => { seat.auto = true; seat.autoReason = this.live(seat.uid) ? 'timeout' : 'offline'; seat.epoch++; this.metric('takeovers'); });
                }
                if ((!seat.bot && !seat.auto) || Date.now() < room.aiAfter) continue;
                if (e.state === 'tribute') {
                    const card = e.selectReturnCard(p, e.pendingPlayerReturns[0].tributeCard);
                    fail(card, 500, '没有合法还牌');
                    this.change(room, 'ai-return', () => {
                        const result = e.completePlayerReturn(card.id); fail(result.success, 500, 'AI还牌失败');
                        room.audit.at(-1).actions.push({ type: 'return', player: p, card: card.id, origin: 'ai' }); this.updateTurn(room);
                    }); continue;
                }
                const stamp = room.turnKey, epoch = seat.epoch, packet = this.runtime.packet(e, p);
                // packet contains the actor's own cards only; proxy guards run inside the worker.
                const job = this.pool.request(packet); room.busy = job;
                job.then(reply => {
                    if (this.closed || !this.rooms.has(room.code) || room.busy !== job) return;
                    room.busy = null;
                    if (room.turnKey !== stamp || seat.epoch !== epoch || room.status !== 'playing') return;
                    this.change(room, 'ai-action', () => {
                        let ids = reply.status === 'ok' ? reply.cards : this.runtime.fallback(e, p);
                        let cards = this.runtime.validate(e, p, ids);
                        let result = cards && (cards.length ? e.playCards(p, cards) : e.passCards(p));
                        if (!result?.success) {
                            cards = this.runtime.validate(e, p, this.runtime.fallback(e, p));
                            result = cards.length ? e.playCards(p, cards) : e.passCards(p); this.metric('aiInvalidFallbacks');
                        }
                        fail(result.success, 500, 'AI合法回退失败');
                        if (reply.status !== 'ok') this.metric('aiBudgetFallbacks');
                        this.recordAction(room, p, cards.map(c => c.id), 'ai'); this.updateTurn(room);
                    });
                }).catch(error => { room.busy = null; console.error('AI任务未提交:', error.message); });
            } catch (error) { console.error('房间任务暂停:', error.message); }
        }
    }
    async close() {
        this.closed = true; clearInterval(this.timer); this.persist();
        for (const connection of this.connections.values()) connection.close(); this.connections.clear(); await this.pool.close();
    }
}
module.exports = { Rooms, HTTPError, fail, digest };
