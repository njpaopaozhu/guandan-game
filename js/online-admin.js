'use strict';
(() => {
    let credential = '';
    const $ = id => document.getElementById(id);
    async function request(path, body) {
        const response = await fetch('/api/admin/' + path, { method: body ? 'POST' : 'GET',
            headers: { Authorization: 'Bearer ' + credential, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
        const value = await response.json(); if (!response.ok) throw Error(value.error); return value;
    }
    async function refresh() {
        const value = await request('status'); $('admin-results').hidden = false;
        $('admin-metrics').textContent = JSON.stringify({ metrics: value.metrics, measurement: value.measurement, ai: value.ai, online: value.connectedPlayers }, null, 2);
        $('admin-events').textContent = value.events.map(e => new Date(e.at).toLocaleString() + ' · ' + e.room + ' · ' + e.type).join('\n');
        $('admin-rooms').replaceChildren();
        for (const room of value.rooms) {
            const row = document.createElement('section'), title = document.createElement('p');
            title.textContent = room.code + ' · ' + room.status + ' · ' + room.humans + '位真人 · 第' + room.roundNumber + '副'; row.append(title);
            const close = document.createElement('button'); close.className = 'quiet'; close.textContent = '关闭房间';
            close.onclick = () => action({ action: 'close', code: room.code }); row.append(close);
            for (const seat of room.seats.filter(s => s.human)) {
                const ban = document.createElement('button'); ban.className = 'quiet'; ban.textContent = '限制座位' + (seat.seat + 1) + '访客';
                ban.onclick = () => action({ action: 'ban', code: room.code, seat: seat.seat }); row.append(ban);
            }
            $('admin-rooms').append(row);
        }
        $('admin-message').textContent = '已读取本机运行状态';
    }
    async function action(value) {
        if (!confirm('确认执行此管理操作？该操作会影响正在进行的房间。')) return;
        try { await request('action', value); await refresh(); } catch (error) { $('admin-message').textContent = error.message; }
    }
    $('admin-form').onsubmit = async event => { event.preventDefault(); credential = $('admin-token').value; $('admin-token').value = '';
        try { await refresh(); } catch (error) { credential = ''; $('admin-message').textContent = error.message; } };
})();
