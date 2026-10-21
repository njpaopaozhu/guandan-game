#!/usr/bin/env node
/** 验证主线程在超时后终止Worker并返回已校验的快速动作。 */
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const context = vm.createContext({ console, setTimeout, clearTimeout, performance: require('perf_hooks').performance,
    window: {}, document: { getElementById: () => null } });
for (const relative of ['js/cards.js', 'js/engine.js', 'js/ai-policy-weights.js', 'js/ai-policy.js', 'js/ai.js',
    'js/v5-decision-transport.js', 'js/v5-worker-client.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, relative), 'utf8'), context, { filename: relative });
}
const result = vm.runInContext(`(async () => {
    const engine = new GameEngine();
    engine.startRound();
    const packet = encodePublicDecision(engine, 0);
    const fallback = [engine.hands[0][0].id];
    let terminated = 0;
    const client = new V5PublicWorkerClient(() => ({
        terminate() { terminated++; },
        postMessage() { throw new Error('worker不应在ready前收到决策'); }
    }));
    const started = performance.now();
    const decision = await client.request(packet, 120, fallback);
    return { decision, fallback, terminated, elapsedMs: performance.now() - started };
})()`, context);
result.then(value => {
    assert.equal(value.decision.status, 'timeout');
    assert.deepEqual(Array.from(value.decision.action), Array.from(value.fallback));
    assert.equal(value.terminated, 1);
    assert(value.elapsedMs >= 100 && value.elapsedMs < 500, `超时边界异常: ${value.elapsedMs}`);
    console.log(`Worker硬截止验证通过：${value.elapsedMs.toFixed(1)}ms，已终止后台任务并回退合法动作`);
}).catch(error => { console.error(error); process.exitCode = 1; });
