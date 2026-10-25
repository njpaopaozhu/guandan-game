#!/usr/bin/env node
/** 验证已发布后台策略的主线程硬截止、页面取消与合法快速回退。 */
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
const controller = vm.createContext({ console, setTimeout, clearTimeout, performance, window: {},
    document: { getElementById: () => ({ setAttribute() {}, classList: { add() {}, remove() {} } }) } });
for (const relative of ['js/cards.js', 'js/engine.js', 'js/ai-policy-weights.js', 'js/ai-policy.js', 'js/ai.js',
    'js/v5-decision-transport.js', 'js/v5-worker-client.js', 'js/game.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, relative), 'utf8'), controller, { filename: relative });
}
const lifecycle = vm.runInContext(`(async () => {
    let terminated = 0;
    globalThis.Worker = function () { return { postMessage() {}, terminate() { terminated++; } }; };
    let seed = 280539899; Math.random = () => { seed = (Math.imul(seed,1664525)+1013904223) >>> 0; return seed/4294967296; };
    engine.startRound(); deepThinkingEnabled = true; engine.aiStrategyMode = 'v5-rollout-lead';
    const serial = aiDecisionSerial, deciding = decideBuiltinAI(0, engine);
    toggleDeepThinking();
    const fallback = await deciding;
    if (deepThinkingClient !== null || deepThinkingEnabled || engine.aiStrategyMode !== 'v3'
        || terminated !== 1 || aiDecisionSerial !== serial) throw Error('关闭深度思考未取消后台，或错误丢弃当前回合');
    if (!fallback?.length || !fallback.every(c => engine.hands[0].some(own => own.id === c.id))
        || !identifyHand(fallback,engine.levelCard).valid) throw Error('取消后台后未返回合法快速动作');
    deepThinkingEnabled = true; engine.aiStrategyMode = 'v5-rollout-lead';
    const packet = encodePublicDecision(engine,0);
    deepThinkingClient = new V5PublicWorkerClient(() => new Worker());
    const pending = deepThinkingClient.request(packet,700,[engine.hands[0][0].id]);
    engine.state = 'finished';
    showRoundEndModal({description:'synthetic end',levelBefore:'2',levelAfter:'2',finishOrder:[0,1,2,3]});
    const ended = await pending;
    if (deepThinkingClient !== null || terminated !== 2 || ended.status !== 'disposed' || ended.action !== null)
        throw Error('回合结算未取消后台或仍可提交旧动作');
    return { terminated, validFastFallback: true, serialPreserved: true, endedStatus: ended.status };
})()`, controller);
lifecycle.then(() => console.log('Worker页面生命周期通过：关闭立即取消、快速回退继续、结算丢弃旧动作'))
    .catch(error => { console.error(error); process.exitCode = 1; });
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
