/* 深度思考主线程客户端：超时直接终止Worker，绝不阻塞牌桌。 */
class V5PublicWorkerClient {
    constructor(createWorker) {
        this.createWorker = createWorker;
        this.worker = null;
        this.ready = false;
        this.generation = 0;
        this.sequence = 0;
        this.pending = null;
        this.disposed = false;
        this.stats = { timeouts: 0, superseded: 0, staleMessages: 0, invalidActions: 0, workerErrors: 0 };
    }
    clock() { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }
    stopWorker() {
        const worker = this.worker;
        this.worker = null;
        this.ready = false;
        this.generation++;
        if (worker) {
            try { worker.terminate(); } catch (_error) { /* Worker已结束即可 */ }
        }
    }
    legalAction(packet, action) {
        const state = packet.publicFields;
        const lead = !state.lastPlay || state.lastPlayer === packet.player;
        if (action === null) return !lead;
        if (!Array.isArray(action) || !action.length || new Set(action).size !== action.length) return false;
        const own = new Map(packet.ownHand.map(card => [card.id, card]));
        if (!action.every(id => typeof id === 'string' && own.has(id))) return false;
        const type = identifyHand(action.map(id => own.get(id)), state.levelCard);
        return type.valid && (lead || canBeat(type, state.lastPlayType));
    }
    finish(status, stop = false) {
        const job = this.pending;
        if (!job) return;
        this.pending = null;
        clearTimeout(job.timer);
        if (stop) this.stopWorker();
        const action = ['superseded', 'disposed'].includes(status) ? null : job.fallback;
        job.resolve({ id: job.id, status, action, usedWorkerBaseline: job.usedWorkerBaseline,
            totalHostMs: this.clock() - job.started });
    }
    send() {
        const job = this.pending;
        if (!job || !this.ready || job.sent) return;
        if (this.clock() - job.started >= job.budgetMs) {
            this.stats.timeouts++;
            this.finish('timeout', true);
            return;
        }
        job.sent = true;
        try { this.worker.postMessage({ type: 'decision', id: job.id, packet: job.packet }); }
        catch (_error) { this.stats.workerErrors++; this.finish('worker-error', true); }
    }
    ensureWorker() {
        if (this.worker) return;
        const generation = ++this.generation;
        this.worker = this.createWorker();
        this.worker.onmessage = event => {
            if (generation !== this.generation) { this.stats.staleMessages++; return; }
            const message = event.data;
            if (message?.type === 'ready') {
                if (message.schema !== 'v5-public-decision-worker-v1') {
                    this.stats.workerErrors++; this.finish('worker-error', true); return;
                }
                this.ready = true;
                this.send();
                return;
            }
            const job = this.pending;
            if (!job || message?.id !== job.id) { this.stats.staleMessages++; return; }
            if (this.clock() - job.started >= job.budgetMs) {
                this.stats.timeouts++; this.finish('timeout', true); return;
            }
            if (message.type === 'error' || !['baseline', 'result'].includes(message.type)
                || !this.legalAction(job.packet, message.action)) {
                this.stats.workerErrors++; this.finish('worker-error', true); return;
            }
            if (message.type === 'baseline') {
                job.usedWorkerBaseline = true;
                return;
            }
            job.fallback = message.action?.slice() || null;
            this.finish('result');
        };
        this.worker.onerror = () => {
            if (generation === this.generation) { this.stats.workerErrors++; this.finish('worker-error', true); }
        };
    }
    request(packet, budgetMs, fallbackAction) {
        if (this.disposed) throw new Error('Worker客户端已释放');
        if (!Number.isFinite(budgetMs) || budgetMs < 100 || !this.legalAction(packet, fallbackAction)) {
            throw new Error('后台决策参数或快速回退动作无效');
        }
        const started = this.clock();
        const snapshot = JSON.parse(JSON.stringify(packet));
        decodePublicDecision(snapshot);
        snapshot.rollout.budgetMs = Math.min(snapshot.rollout.budgetMs || budgetMs, budgetMs);
        if (this.pending) { this.stats.superseded++; this.finish('superseded', true); }
        return new Promise(resolve => {
            const job = { id: ++this.sequence, packet: snapshot, started, budgetMs, resolve, sent: false,
                usedWorkerBaseline: false, fallback: Array.isArray(fallbackAction) ? fallbackAction.slice() : null };
            this.pending = job;
            job.timer = setTimeout(() => {
                if (this.pending === job) { this.stats.timeouts++; this.finish('timeout', true); }
            }, budgetMs);
            try { this.ensureWorker(); this.send(); }
            catch (_error) { this.stats.workerErrors++; this.finish('worker-error', true); }
        });
    }
    dispose() { this.disposed = true; this.finish('disposed', true); this.stopWorker(); }
}
