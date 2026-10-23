'use strict';
const { parentPort } = require('node:worker_threads');
const runtime = require('./runtime').createRuntime(true);
parentPort.on('message', job => {
    try { parentPort.postMessage({ id: job.id, cards: runtime.decidePacket(job.packet) }); }
    catch (error) { parentPort.postMessage({ id: job.id, error: String(error.message) }); }
});
parentPort.postMessage({ ready: true });
