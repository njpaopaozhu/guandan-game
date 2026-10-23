'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Store } = require('./store');
const { AIPool } = require('./ai-pool');
const { Rooms, HTTPError, fail } = require('./rooms');
const { ROOT } = require('./runtime');

function createOnlineServer(options = {}) {
    const store = new Store(options.dataDir || path.join(ROOT, 'data', 'online'));
    const pool = options.pool || new AIPool(options.ai);
    const rooms = new Rooms(store, pool, options.rooms);
    const limits = new Map(); const sockets = new Set(); let closing = false;
    const started = Date.now(), cpuAtStart = process.cpuUsage(), completedAtStart = store.data.metrics.matchesCompleted || 0;
    const configuredOrigin = options.publicOrigin || null;
    const allowed = new Map([
        ['/', 'online.html'], ['/online.html', 'online.html'], ['/index.html', 'index.html'],
        ['/css/online.css', 'css/online.css'], ['/js/online.js', 'js/online.js'],
        ['/js/invite-qr.js', 'js/invite-qr.js'], ['/admin.html', 'admin.html'], ['/js/online-admin.js', 'js/online-admin.js']
    ]);
    for (const name of ['cards', 'engine', 'ai-policy-weights', 'ai-policy', 'human-profile', 'ai', 'pro-ai-bridge',
        'strategy-storage', 'v5-decision-transport', 'v5-worker-client', 'v5-rollout-worker', 'game']) allowed.set('/js/' + name + '.js', 'js/' + name + '.js');
    allowed.set('/css/style.css', 'css/style.css');
    allowed.set('/js/vendor/qrcodegen.js', 'js/vendor/qrcodegen.js');
    const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
    function rate(req, category, maximum, period = 60000) {
        const key = req.socket.remoteAddress + ':' + category, now = Date.now(); let entry = limits.get(key);
        if (!entry || now > entry.until) { entry = { count: 0, until: now + period }; limits.set(key, entry); }
        if (++entry.count > maximum) throw new HTTPError(429, '操作过于频繁，请稍后再试');
        if (limits.size > 10000) for (const [k, v] of limits) if (now > v.until) limits.delete(k);
    }
    function auth(req) {
        const raw = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('gd_guest='))?.slice(9);
        return { raw, session: rooms.sessionForToken(raw) };
    }
    function send(res, code, value) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); }
    async function body(req) {
        fail(req.headers['content-type']?.split(';')[0] === 'application/json', 415, '仅接受JSON请求');
        let text = ''; for await (const chunk of req) { text += chunk; fail(Buffer.byteLength(text) <= 8192, 413, '请求过大'); }
        try { const value = JSON.parse(text); fail(value && typeof value === 'object' && !Array.isArray(value), 400, '请求格式无效'); return value; }
        catch (error) { if (error.status) throw error; throw new HTTPError(400, 'JSON格式无效'); }
    }
    function checkAdmin(req) {
        fail(typeof options.adminToken === 'string' && options.adminToken.length >= 24, 404, '管理入口未启用');
        const supplied = Buffer.from(req.headers.authorization || ''), expected = Buffer.from('Bearer ' + options.adminToken);
        fail(supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected), 403, '管理凭证无效');
    }
    const server = http.createServer(async (req, res) => {
        res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
        try {
            fail(!closing, 503, '服务器正在维护');
            const authority = new URL('http://' + req.headers.host);
            const local = ['127.0.0.1', 'localhost', '[::1]'].includes(authority.hostname)
                && Number(authority.port || 80) === server.address().port;
            fail(local || (configuredOrigin && authority.host === new URL(configuredOrigin).host), 403, '访问域名未授权');
            const origin = configuredOrigin || authority.origin;
            const url = new URL(req.url, origin), pathname = url.pathname;
            if (pathname.startsWith('/api/')) {
                fail(!req.headers.origin || req.headers.origin === origin, 403, '请求来源不允许');
                fail(!req.headers['sec-fetch-site'] || ['same-origin', 'none'].includes(req.headers['sec-fetch-site']), 403, '跨站请求不允许');
                if (req.method !== 'GET') fail(req.headers.origin === origin, 403, '缺少同源校验');
                rate(req, 'api', 1000);
            }
            if (pathname === '/api/health' && req.method === 'GET') return send(res, 200, { status: 'ok', mode: 'private-room-preview', version: '3.2.0-online-alpha', paymentsEnabled: false });
            const { session, raw } = auth(req);
            if (pathname === '/api/session') {
                if (req.method === 'GET') { if (session) rooms.visit(session); return send(res, 200, session ? { authenticated: true, ...rooms.profile(session) } : { authenticated: false }); }
                fail(req.method === 'POST', 405, '请求方法不支持'); rate(req, 'session', 20);
                const old = raw && store.data.sessions.find(s => s.tokenHash === require('./rooms').digest(raw));
                fail(!old || !store.data.bans.includes(old.id), 403, '此访客身份已被限制');
                const value = await body(req), result = rooms.createSession(value.nickname, session);
                rooms.visit(result.session);
                if (result.raw) res.setHeader('Set-Cookie', 'gd_guest=' + result.raw + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000' + (origin.startsWith('https:') ? '; Secure' : ''));
                return send(res, 200, { authenticated: true, ...rooms.profile(result.session) });
            }
            if (pathname.startsWith('/api/admin')) {
                checkAdmin(req);
                if (pathname === '/api/admin/status' && req.method === 'GET') {
                    const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
                    const yesterday = new Date(Date.now() + 8 * 3600e3 - 86400e3).toISOString().slice(0, 10);
                    const cohort = store.data.sessions.filter(s => new Date(s.createdAt + 8 * 3600e3).toISOString().slice(0, 10) === yesterday);
                    const returning = cohort.filter(s => s.visitDays?.includes(today)).length;
                    const cpu = process.cpuUsage(cpuAtStart), seconds = (cpu.user + cpu.system) / 1e6;
                    const matches = (store.data.metrics.matchesCompleted || 0) - completedAtStart;
                    return send(res, 200, {
                    metrics: store.data.metrics, ai: pool.stats, connectedPlayers: rooms.connections.size,
                    measurement: { timezone: 'Asia/Shanghai', yesterdayNewGuestIdentities: cohort.length, returnedToday: returning,
                        nextDayGuestReturnRate: cohort.length ? returning / cohort.length : null,
                        joinAttemptSuccessRate: store.data.metrics.joinAttempts ? (store.data.metrics.joinSuccess || 0) / store.data.metrics.joinAttempts : null,
                        completedMatchRate: store.data.metrics.matchesStarted ? (store.data.metrics.matchesCompleted || 0) / store.data.metrics.matchesStarted : null,
                        secondsSinceStart: (Date.now() - started) / 1000, cpuSecondsSinceStart: seconds,
                        matchesCompletedSinceStart: matches, cpuSecondsPerCompletedMatch: matches > 0 ? seconds / matches : null,
                        residentMiB: process.memoryUsage().rss / 1048576,
                        privateDataBytes: fs.existsSync(store.file) ? fs.statSync(store.file).size : 0,
                        currencyCost: null, note: '访客身份不等于独立自然人；货币成本需要实际账单，未估造。无训练数据自动导出。' },
                    rooms: [...rooms.rooms.values()].map(r => ({ code: r.code, status: r.status, version: r.version,
                        roundNumber: r.engine?.roundNumber || 0, humans: r.seats.filter(s => s.uid).length,
                        updatedAt: r.updatedAt, seats: r.seats.map((s, seat) => ({ seat, human: Boolean(s.uid), online: Boolean(s.uid && rooms.live(s.uid)) })) })),
                    events: store.data.events.slice(-80), deployment: { payments: false, publicOrigin: configuredOrigin } });
                }
                if (pathname === '/api/admin/action' && req.method === 'POST') {
                    rate(req, 'admin', 30); const value = await body(req), room = rooms.rooms.get(value.code);
                    fail(room, 404, '房间不存在');
                    let bannedUID = null;
                    rooms.change(room, 'admin-' + value.action, () => {
                        if (value.action === 'close') room.status = 'closed';
                        else if (value.action === 'ban') {
                            fail(Number.isInteger(value.seat) && room.seats[value.seat]?.uid, 400, '真人座位无效');
                            const seat = room.seats[value.seat], uid = seat.uid;
                            if (!store.data.bans.includes(uid)) store.data.bans.push(uid);
                            bannedUID = uid;
                            seat.uid = null; seat.bot = room.status !== 'waiting'; seat.epoch++;
                            if (room.owner === uid) room.owner = room.seats.find(s => s.uid)?.uid || null;
                            if (!room.owner) room.status = 'closed';
                        } else throw new HTTPError(400, '管理操作无效');
                    });
                    if (bannedUID) { const c = rooms.connections.get(bannedUID); if (c) { c.send('closed', { message: '此访客身份已被限制' }); c.close(); rooms.connections.delete(bannedUID); } }
                    return send(res, 200, { ok: true });
                }
                throw new HTTPError(404, '管理接口不存在');
            }
            if (pathname.startsWith('/api/')) {
                fail(session, 401, '请先填写昵称进入');
                if (pathname === '/api/profile/consent' && req.method === 'POST') {
                    const value = await body(req); rooms.consent(session, value.enabled); return send(res, 200, rooms.profile(session));
                }
                if (pathname === '/api/events' && req.method === 'GET') {
                    rate(req, 'events', 120);
                    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
                    res.write(': connected\n\n');
                    const sendEvent = (event, value) => {
                        if (res.destroyed || res.writableEnded) return;
                        if (res.writableLength > 131072) return res.destroy();
                        res.write('event: ' + event + '\ndata: ' + JSON.stringify(value) + '\n\n');
                    };
                    const detach = rooms.attach(session, sendEvent, () => res.end());
                    const heartbeat = setInterval(() => { if (!res.destroyed) res.write(': heartbeat\n\n'); }, 10000);
                    req.on('close', () => { clearInterval(heartbeat); detach(); }); return;
                }
                if (pathname === '/api/rooms' && req.method === 'POST') {
                    await body(req); rate(req, 'create', 10);
                    return send(res, 201, { state: rooms.snapshot(rooms.create(session), session) });
                }
                if (pathname === '/api/rooms/join' && req.method === 'POST') {
                    rate(req, 'join', 30); const value = await body(req);
                    fail(typeof value.code === 'string' && /^\d{8}$/.test(value.code), 400, '房间号为8位数字');
                    rooms.funnel('joinAttempts');
                    const room = rooms.join(session, value); rooms.funnel('joinSuccess');
                    return send(res, 200, { state: rooms.snapshot(room, session) });
                }
                const match = /^\/api\/rooms\/(\d{8})(?:\/(command|invite|hint))?$/.exec(pathname);
                if (match) {
                    const room = rooms.get(match[1], session), operation = match[2];
                    if (!operation && req.method === 'GET') return send(res, 200, { state: rooms.snapshot(room, session) });
                    if (operation === 'invite' && req.method === 'GET') {
                        rooms.funnel('inviteLinksRequested');
                        return send(res, 200, { code: room.code, url: origin + '/online.html#room=' + room.code + '&invite=' + room.invite, expiresAt: room.inviteExpiresAt });
                    }
                    if (operation === 'command' && req.method === 'POST') {
                        rate(req, 'command', 300); return send(res, 200, rooms.command(session, room, await body(req)));
                    }
                    if (operation === 'hint' && req.method === 'POST') {
                        await body(req); rate(req, 'hint', 30);
                        const p = room.seats.findIndex(s => s.uid === session.id), e = room.engine;
                        fail(room.status === 'playing' && e?.state === 'playing' && e.currentPlayer === p, 409, '请在自己的出牌回合使用提示');
                        const version = room.version, result = await pool.request(rooms.runtime.packet(e, p));
                        fail(room.version === version, 409, '牌桌已更新');
                        const valid = result.status === 'ok' && rooms.runtime.legal(e, p, result.cards);
                        const cards = valid ? result.cards : rooms.runtime.fallback(e, p);
                        return send(res, 200, { cards, version, fallback: !valid });
                    }
                    throw new HTTPError(405, '请求方法不支持');
                }
                throw new HTTPError(404, '接口不存在');
            }
            fail(req.method === 'GET' || req.method === 'HEAD', 405, '请求方法不支持');
            const relative = allowed.get(pathname); fail(relative, 404, '页面不存在');
            // The unchanged legacy offline page uses inline handlers; online/admin stay strict.
            if (relative === 'index.html') res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' http://127.0.0.1:* http://localhost:*; img-src 'self' data:; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'");
            const file = path.join(ROOT, relative); fail(fs.existsSync(file), 404, '页面尚未就绪');
            res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
            if (req.method === 'HEAD') res.end(); else fs.createReadStream(file).pipe(res);
        } catch (error) {
            if (res.headersSent) { res.end(); return; }
            const status = error.status || 500;
            if (status === 500) console.error('联机请求失败:', error.message);
            send(res, status, { error: status === 500 ? '服务暂不可用，未确认的操作请重试' : error.message });
        }
    });
    server.headersTimeout = 10000; server.requestTimeout = 15000;
    server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    async function close() {
        closing = true; await rooms.close();
        await new Promise(resolve => { server.close(resolve); for (const socket of sockets) socket.destroy(); });
    }
    return { server, rooms, store, pool, close };
}
if (require.main === module) {
    const app = createOnlineServer({ dataDir: process.env.GD_DATA_DIR, publicOrigin: process.env.GD_PUBLIC_ORIGIN,
        adminToken: process.env.GD_ADMIN_TOKEN });
    const host = process.env.GD_HOST || '127.0.0.1', port = Number(process.env.GD_PORT || 8787);
    app.server.listen(port, host, () => console.log('好友房预览已启动：http://' + host + ':' + port + '（未启用收费）'));
    let stopping = false;
    const stop = () => { if (stopping) return; stopping = true; app.close().then(() => process.exit(0)).catch(error => { console.error(error.message); process.exit(1); }); };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
module.exports = { createOnlineServer };
