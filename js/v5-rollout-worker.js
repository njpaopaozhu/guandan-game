/* 深度思考后台入口：主线程负责硬超时和终止，本文件只处理公开决策包。 */
self.window = {};
self.document = { getElementById: () => null };
importScripts(
    'cards.js',
    'engine.js',
    'ai-policy-weights.js',
    'ai-policy.js',
    'ai.js',
    'v5-decision-transport.js'
);
self.onmessage = event => {
    const request = event.data;
    const id = Number.isSafeInteger(request?.id) && request.id > 0 ? request.id : null;
    try {
        if (id === null || request.type !== 'decision') throw new Error('后台请求无效');
        const engine = decodePublicDecision(request.packet);
        const player = request.packet.player;
        const mode = engine.aiStrategyMode;
        // 先返回快速基线，主线程即便随后终止Worker也已有合法动作可回退。
        engine.aiStrategyMode = 'v3';
        const baseline = aiDecidePlay(player, engine);
        const ids = play => play?.length ? play.map(card => card.id) : null;
        self.postMessage({ type: 'baseline', id, action: ids(baseline) });
        engine.aiStrategyMode = mode;
        const choice = mode.startsWith('v5-rollout')
            ? aiRolloutRefinePlay(engine.hands[player], baseline, player, engine)
            : baseline;
        self.postMessage({ type: 'result', id, action: ids(choice) });
    } catch (error) {
        self.postMessage({ type: 'error', id, message: error?.message || '后台决策失败' });
    }
};
self.postMessage({ type: 'ready', schema: 'v5-public-decision-worker-v1' });
