/* 深度思考的公开状态传输。Worker只获得当前座位手牌与公开牌桌信息。 */
const V5_PUBLIC_DECISION_FIELDS = Object.freeze([
    'currentPlayer', 'lastPlay', 'lastPlayType', 'lastPlayer', 'passCount', 'roundNumber', 'teamLevel',
    'roundLevel', 'matchOver', 'matchWinner', 'finishOrder', 'playerFinished', 'state', 'history',
    'levelCard', 'pendingTributes', 'lastTributeExchanges', 'lastTributeResisted',
    'tributeOpeningPlayer', 'pendingPlayerReturns', 'playedCards', 'passMemory', 'publicActionHistory'
]);
function encodePublicDecision(engine, player) {
    if (!Number.isInteger(player) || player < 0 || player > 3 || engine.currentPlayer !== player
        || engine.state !== 'playing') throw new Error('不是活动中的AI回合');
    const policy = Array.isArray(engine.aiPolicyByPlayer) ? engine.aiPolicyByPlayer[player] : engine.aiPolicyMode;
    const publicFields = {};
    for (const field of V5_PUBLIC_DECISION_FIELDS) {
        if (engine[field] !== undefined) publicFields[field] = engine[field];
    }
    const packet = JSON.parse(JSON.stringify({
        schema: 'v5-public-decision-v1', player, ownHand: engine.hands[player],
        counts: engine.hands.map(hand => hand.length), publicFields,
        strategy: aiStrategyMode(engine, player), policy: policy || 'learned', rollout: getRolloutConfig(engine, player)
    }));
    decodePublicDecision(packet);
    return packet;
}
function decodePublicDecision(packet) {
    const allowed = ['schema', 'player', 'ownHand', 'counts', 'publicFields', 'strategy', 'policy', 'rollout'];
    if (!packet || Object.keys(packet).some(key => !allowed.includes(key)) || packet.schema !== 'v5-public-decision-v1') {
        throw new Error('公开决策包格式错误');
    }
    const { player, counts, ownHand, publicFields } = packet;
    if (!Number.isInteger(player) || player < 0 || player > 3 || !Array.isArray(counts) || counts.length !== 4
        || !counts.every(n => Number.isInteger(n) && n >= 0 && n <= 27) || !Array.isArray(ownHand)
        || ownHand.length !== counts[player] || !ownHand.length) throw new Error('公开牌数或自身手牌无效');
    if (!publicFields || Object.keys(publicFields).some(key => !V5_PUBLIC_DECISION_FIELDS.includes(key))
        || publicFields.currentPlayer !== player || publicFields.state !== 'playing'
        || !Array.isArray(publicFields.playedCards)) throw new Error('公开牌桌状态无效');
    if (!['v3', 'v5-rollout', 'v5-rollout-lead', 'v5-rollout-follow'].includes(packet.strategy)
        || !['learned', 'legacy'].includes(packet.policy)) throw new Error('不支持的后台策略');
    const canonical = new Map(createDeck().map(card => [card.id, card]));
    const seen = new Set();
    for (const card of [...ownHand, ...publicFields.playedCards]) {
        const expected = canonical.get(card?.id);
        if (!expected || seen.has(card.id) || ['suit', 'rank', 'value', 'isJoker'].some(key => card[key] !== expected[key])) {
            throw new Error('公开物理牌无效');
        }
        seen.add(card.id);
    }
    if (counts.reduce((sum, n) => sum + n, 0) + publicFields.playedCards.length !== 108) {
        throw new Error('公开牌数不守恒');
    }
    const engine = new GameEngine();
    for (const field of V5_PUBLIC_DECISION_FIELDS) {
        if (publicFields[field] !== undefined) engine[field] = JSON.parse(JSON.stringify(publicFields[field]));
    }
    engine.hands = counts.map((count, seat) => seat === player ? JSON.parse(JSON.stringify(ownHand))
        : new Proxy(Array(count).fill(null), {
            get(target, key, receiver) {
                if (key !== 'length') throw new Error('后台AI试图读取未公开的对手手牌');
                return Reflect.get(target, key, receiver);
            }
        }));
    engine.aiStrategyMode = packet.strategy;
    engine.aiPolicyMode = packet.policy;
    engine.aiRolloutConfig = JSON.parse(JSON.stringify(packet.rollout || {}));
    return engine;
}
