'use strict';
(() => {
    const $ = id => document.getElementById(id);
    let state = null, profile = null, stream = null, selected = new Set(), busy = false, replaced = false;
    const pendingInvite = new URLSearchParams(location.hash.slice(1));
    const invitation = { code: pendingInvite.get('room'), invite: pendingInvite.get('invite') };
    if (location.hash) history.replaceState(null, '', location.pathname);
    const grades = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
    const requestId = () => crypto.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint8Array(16)), x => x.toString(16).padStart(2, '0')).join('');
    function message(text, error = false) { $('message').textContent = text; $('message').classList.toggle('error', error); }
    async function api(url, data) {
        const response = await fetch(url, { method: data === undefined ? 'GET' : 'POST', credentials: 'same-origin',
            headers: data === undefined ? {} : { 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
        const value = await response.json(); if (!response.ok) { const error = Error(value.error || '请求失败'); error.status = response.status; throw error; } return value;
    }
    function connect() {
        if (stream || replaced) return;
        stream = new EventSource('/api/events');
        stream.onopen = () => { $('connection').textContent = '实时连接'; if (state) refresh().catch(handle); };
        stream.onerror = () => { $('connection').textContent = '连接中断，正在重连'; };
        stream.addEventListener('state', event => apply(JSON.parse(event.data)));
        stream.addEventListener('replaced', event => { replaced = true; stream.close(); stream = null; $('connection').textContent = '此页已离线'; message(JSON.parse(event.data).message, true); disableActions(); });
        stream.addEventListener('closed', event => { stream.close(); stream = null; state = null; render(); message(JSON.parse(event.data).message, true); });
    }
    function apply(next) {
        if (state && next.code === state.code && next.version < state.version) return;
        const turnChanged = state && (state.currentPlayer !== next.currentPlayer || state.roundNumber !== next.roundNumber || state.state !== next.state);
        state = next;
        const owned = new Set(next.hand.map(c => c.id)); selected = new Set([...selected].filter(id => owned.has(id)));
        if (turnChanged) selected.clear(); render();
    }
    async function refresh() { if (state) apply((await api('/api/rooms/' + state.code)).state); }
    async function handle(error) {
        message(error.message, true);
        if (error.status === 409 && state) { try { await refresh(); } catch (_) { /* original error remains visible */ } }
    }
    async function work(callback) {
        if (busy || replaced) return; busy = true; render();
        try { await callback(); } catch (error) { await handle(error); } finally { busy = false; render(); }
    }
    async function command(action, values = {}) {
        const response = await api('/api/rooms/' + state.code + '/command', { id: requestId(), version: state.version, action, ...values });
        if (response.state) apply(response.state); else { state = null; selected.clear(); }
    }
    function cardText(card) { return card.isJoker ? (card.rank === '大王' ? '大\n王' : '小\n王') : card.rank + '\n' + card.suit; }
    function cardNode(card, clickable) {
        const node = document.createElement(clickable ? 'button' : 'span');
        node.className = (clickable ? 'hand-card' : 'playing-card') + (['♥','♦'].includes(card.suit) || card.rank === '大王' ? ' red' : '');
        node.textContent = cardText(card);
        if (clickable) { node.type = 'button'; node.setAttribute('aria-label', card.isJoker ? card.rank : card.suit + card.rank);
            node.setAttribute('aria-pressed', String(selected.has(card.id))); node.dataset.cardId = card.id;
            node.addEventListener('click', () => { if (selected.has(card.id)) selected.delete(card.id); else selected.add(card.id); render(); }); }
        return node;
    }
    function renderSeat(id, index) {
        const container = $(id), seat = state.seats[index]; container.replaceChildren();
        container.classList.toggle('active', state.status === 'playing' && (state.state === 'tribute' ? state.returnFor === index : state.currentPlayer === index && state.state === 'playing'));
        const title = document.createElement('strong'); title.textContent = seat.name + (seat.you ? '（我）' : '') + (seat.owner ? ' · 房主' : '');
        const detail = document.createElement('small'); detail.textContent = seat.team + '队 · ' + (seat.occupied ? state.status === 'waiting' ? seat.ready ? '已准备' : seat.human ? '未准备' : 'AI补位' : seat.finished ? '已出完' : seat.count + '张' : '空位');
        const status = document.createElement('small'); status.textContent = seat.human ? (!seat.connected ? '已离线 · 保留座位' : seat.auto ? 'AI托管中' : '真人在线') : seat.occupied ? 'AI玩家' : '开局后可由AI补齐';
        container.append(title, detail, status);
        if (!seat.human && state.status === 'waiting' && !state.seats[state.you].ready) {
            const button = document.createElement('button'); button.textContent = '坐这里'; button.disabled = busy || replaced;
            button.addEventListener('click', () => work(() => command('seat', { seat: index }))); container.append(button);
        }
    }
    function disableActions() { document.querySelectorAll('#room button').forEach(button => { button.disabled = true; }); }
    function render() {
        $('welcome').hidden = Boolean(profile); $('lobby').hidden = !profile || Boolean(state); $('room').hidden = !state;
        if (profile) $('hello').textContent = profile.nickname + '，约一局吧';
        if (profile && !busy) $('consent-training').checked = Boolean(profile.consentTraining);
        $('consent-training').disabled = busy || replaced;
        if (!state) return;
        const me = state.seats[state.you], owner = me.owner, waiting = state.status === 'waiting', finished = state.state === 'finished';
        const manual = !me.auto && state.status === 'playing', turn = manual && state.state === 'playing' && state.currentPlayer === state.you;
        const returning = manual && state.state === 'tribute' && state.returnFor === state.you;
        $('room-number').textContent = state.code;
        $('room-status').textContent = waiting ? '等待朋友入座 · 对家同队' : state.status === 'paused' ? '房间暂停，重新连接后继续' : state.matchOver ? '本场已结束' : '比赛进行中';
        $('grade').textContent = '级牌 ' + state.levelCard; $('team-a').textContent = 'A队 · ' + grades[state.teamLevel.a];
        $('team-b').textContent = 'B队 · ' + grades[state.teamLevel.b]; $('round-number').textContent = '第' + (finished ? Math.max(1, state.roundNumber - 1) : state.roundNumber) + '副';
        renderSeat('seat-bottom', state.you); renderSeat('seat-top', (state.you + 2) % 4);
        renderSeat('seat-left', (state.you + 1) % 4); renderSeat('seat-right', (state.you + 3) % 4);
        $('turn-label').textContent = waiting ? '准备好后由房主开局' : finished ? state.history.at(-1)?.result.description || '本副结束' : state.state === 'tribute' ? state.seats[state.returnFor]?.name + ' 选择一张不高于10的牌还牌' : state.seats[state.currentPlayer]?.name + ' 的回合';
        $('played').replaceChildren(...(state.lastPlay || []).map(c => cardNode(c, false)));
        $('last-label').textContent = state.lastPlay ? state.seats[state.lastPlayer].name + ' · ' + (state.lastPlayType?.type || '') : state.tributeResisted ? '本副抗贡' : '';
        $('hand-count').textContent = '(' + state.hand.length + '张)'; $('hand').replaceChildren(...state.hand.map(c => cardNode(c, true)));
        $('play').textContent = returning ? '还选中的牌' : '出选中的牌'; $('play').disabled = busy || !(turn || returning) || selected.size === 0 || (returning && selected.size !== 1);
        $('pass').disabled = busy || !turn || !state.lastPlay || state.lastPlayer === state.you;
        $('hint').disabled = busy || !turn; $('clear').disabled = busy || !selected.size;
        $('ready').hidden = !(waiting || finished && !state.matchOver); $('ready').textContent = me.ready ? '取消准备' : '准备';
        $('start').hidden = !waiting || !owner; $('start').disabled = busy || !state.canStart;
        $('next').hidden = !finished || !owner || state.matchOver; $('rematch').hidden = !state.matchOver || !owner;
        $('auto').hidden = waiting || finished; $('auto').textContent = me.auto ? '接回手动控制' : '交给AI托管';
        for (const id of ['ready','next','rematch','auto','invite','leave']) $(id).disabled = busy;
        const historyNodes = state.history.map(row => { const p = document.createElement('p'); p.textContent = '第' + row.round + '副 · ' + row.result.description; return p; });
        $('history').replaceChildren(...historyNodes);
        if (!historyNodes.length) $('history').textContent = '比赛开始后显示每副结算；其他座位的剩余手牌不会公开。';
        if (replaced) disableActions();
    }
    async function enterRoom(value) { apply(value.state); connect(); message('已加入房间。对角为队友，准备后由房主开局。'); }
    async function showInvite() {
        const value = await api('/api/rooms/' + state.code + '/invite'); $('invite-link').value = value.url;
        $('rotate-invite').hidden = !state.seats[state.you].owner || state.status !== 'waiting';
        $('invite-warning').textContent = '邀请有效至 ' + new Date(value.expiresAt).toLocaleString() + '。本机地址只能在本机使用；跨网络需部署到可访问的服务地址。';
        if (typeof drawInviteQR === 'function') drawInviteQR($('invite-qr'), value.url);
        else { $('invite-qr').hidden = true; }
        if (!$('invite-dialog').open) $('invite-dialog').showModal();
    }
    $('nickname-form').addEventListener('submit', event => { event.preventDefault(); work(async () => {
        profile = await api('/api/session', { nickname: $('nickname').value }); render(); connect();
        if (invitation.code) { const value = await api('/api/rooms/join', invitation); invitation.code = null; await enterRoom(value); }
    }); });
    $('create-room').addEventListener('click', () => work(async () => enterRoom(await api('/api/rooms', {}))));
    $('join-form').addEventListener('submit', event => { event.preventDefault(); work(async () => enterRoom(await api('/api/rooms/join', { code: $('room-code').value.trim() }))); });
    $('consent-training').addEventListener('change', event => { const enabled = event.currentTarget.checked; work(async () => {
        profile = { ...profile, ...await api('/api/profile/consent', { enabled }) };
        message(profile.consentTraining ? '已记录授权。此版本不会自动导出私人房间数据。' : '已撤回后续训练授权。');
    }); });
    $('ready').addEventListener('click', () => work(() => command('ready', { ready: !state.seats[state.you].ready })));
    for (const action of ['start','next','rematch']) $(action).addEventListener('click', () => work(() => command(action)));
    $('auto').addEventListener('click', () => work(() => command('auto', { enabled: !state.seats[state.you].auto })));
    $('play').addEventListener('click', () => work(async () => { if (state.state === 'tribute') await command('return', { card: [...selected][0] }); else await command('play', { cards: [...selected] }); selected.clear(); }));
    $('pass').addEventListener('click', () => work(async () => { await command('pass'); selected.clear(); }));
    $('clear').addEventListener('click', () => { selected.clear(); render(); });
    $('hint').addEventListener('click', () => work(async () => { const value = await api('/api/rooms/' + state.code + '/hint', {}); if (value.version !== state.version) return; selected = new Set(value.cards); message(value.cards.length ? '已为你选中建议牌型；确认后点击出牌。' : '当前建议过牌。'); }));
    $('invite').addEventListener('click', () => work(showInvite)); $('close-invite').addEventListener('click', () => $('invite-dialog').close());
    $('rotate-invite').addEventListener('click', () => work(async () => { await command('rotate-invite'); await showInvite(); }));
    $('copy-invite').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('invite-link').value); message('邀请链接已复制'); } catch (_) { $('invite-link').select(); message('请长按或手动复制邀请链接'); } });
    let leaving = false;
    $('leave').addEventListener('click', () => work(async () => { if (!leaving) { leaving = true; message('再次点击“离开房间”确认：比赛中离开将由AI接替，不能中途重新入座。'); setTimeout(() => { leaving = false; }, 5000); return; } await command('leave'); leaving = false; message('已离开房间'); }));
    window.addEventListener('hashchange', () => {
        const params = new URLSearchParams(location.hash.slice(1));
        if (!params.get('room')) return;
        invitation.code = params.get('room'); invitation.invite = params.get('invite');
        history.replaceState(null, '', location.pathname);
        if (profile) work(async () => { await enterRoom(await api('/api/rooms/join', invitation)); invitation.code = null; });
    });
    setInterval(() => { if (state?.turnDueAt && state.state === 'playing') $('turn-clock').textContent = '本回合剩余 ' + Math.max(0, Math.ceil((state.turnDueAt - Date.now()) / 1000)) + ' 秒'; else $('turn-clock').textContent = ''; }, 500);
    (async () => {
        if (location.protocol === 'file:') throw Error('联机需要启动好友房服务。原单机游戏仍可直接打开。');
        profile = await api('/api/session'); if (!profile.authenticated) profile = null;
        $('connection').textContent = profile ? '正在连接' : '联机服务可用';
        if (profile) { connect(); if (profile.roomCode) await enterRoom(await api('/api/rooms/' + profile.roomCode));
            else if (invitation.code) { await enterRoom(await api('/api/rooms/join', invitation)); invitation.code = null; } }
        render();
    })().catch(handle);
})();
