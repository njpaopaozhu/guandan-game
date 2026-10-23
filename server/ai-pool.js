'use strict';
const { Worker } = require('node:worker_threads');
const path = require('node:path');

class AIPool {
    constructor({ size = 2, budgetMs = 700, maxQueue = 40 } = {}) {
        this.budgetMs = budgetMs; this.maxQueue = maxQueue; this.nextId = 0;
        this.queue = []; this.closed = false;
        this.stats = { requests: 0, completed: 0, timedOut: 0, failed: 0, rejected: 0 };
        this.slots = Array.from({ length: size }, () => ({ worker: null, ready: false, job: null }));
        for (const slot of this.slots) this.spawn(slot);
    }
    spawn(slot) {
        if (this.closed) return;
        const worker = new Worker(path.join(__dirname, 'ai-worker.js'));
        slot.worker = worker; slot.ready = false;
        worker.on('message', message => {
            if (slot.worker !== worker) return;
            if (message.ready) { slot.ready = true; this.drain(); return; }
            if (!slot.job || message.id !== slot.job.id) return;
            const job = slot.job; slot.job = null; clearTimeout(job.timer);
            if (message.error) { this.stats.failed++; job.resolve({ status: 'error', cards: null }); }
            else { this.stats.completed++; job.resolve({ status: 'ok', cards: message.cards }); }
            this.drain();
        });
        const fail = () => {
            if (slot.worker !== worker) return;
            if (slot.job) { clearTimeout(slot.job.timer); slot.job.resolve({ status: 'error', cards: null }); this.stats.failed++; }
            slot.job = null; slot.worker = null; worker.terminate(); this.spawn(slot);
        };
        worker.on('error', fail); worker.on('exit', code => { if (code !== 0) fail(); });
    }
    request(packet) {
        this.stats.requests++;
        if (this.closed || this.queue.length >= this.maxQueue) {
            this.stats.rejected++; return Promise.resolve({ status: 'busy', cards: null });
        }
        return new Promise(resolve => {
            const job = { id: ++this.nextId, packet, resolve, queuedAt: Date.now(), timer: null };
            // Queue waiting and cold worker start count against the same budget.
            job.timer = setTimeout(() => {
                const queued = this.queue.indexOf(job);
                if (queued >= 0) this.queue.splice(queued, 1);
                const slot = this.slots.find(s => s.job === job);
                if (slot) { const previous = slot.worker; slot.worker = null; slot.job = null; slot.ready = false;
                    previous.terminate(); this.spawn(slot); }
                this.stats.timedOut++; resolve({ status: 'timeout', cards: null }); this.drain();
            }, this.budgetMs);
            this.queue.push(job); this.drain();
        });
    }
    drain() {
        if (this.closed) return;
        for (const slot of this.slots) {
            if (!slot.ready || slot.job || !this.queue.length) continue;
            slot.job = this.queue.shift(); slot.worker.postMessage({ id: slot.job.id, packet: slot.job.packet });
        }
    }
    async close() {
        this.closed = true;
        for (const job of this.queue.splice(0)) { clearTimeout(job.timer); job.resolve({ status: 'closed', cards: null }); }
        await Promise.all(this.slots.map(slot => {
            if (slot.job) { clearTimeout(slot.job.timer); slot.job.resolve({ status: 'closed', cards: null }); slot.job = null; }
            return slot.worker?.terminate();
        }));
    }
}
module.exports = { AIPool };
