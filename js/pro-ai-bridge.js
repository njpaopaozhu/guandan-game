/**
 * 可选的专业 AI 本地桥接。
 *
 * 只允许 localhost，且只向模型发送当前 AI 的手牌与公开桌面信息；
 * 模型返回 cardIds 后仍由本地规则引擎逐张校验，失败立即回退内置 AI。
 * 协议: POST { protocol:'guandan-pro-ai-v1', state } -> { cardIds?:string[], pass?:boolean }。
 */
const PRO_AI_SETTINGS_KEY = 'guandanProAISettingsV1';
const PRO_AI_DEFAULTS = { enabled: false, endpoint: 'http://127.0.0.1:8787/decide', timeoutMs: 1500 };
let proAISettings = { ...PRO_AI_DEFAULTS };
let proAIStatus = { mode: '内置策略', detail: '', uses: 0, fallbacks: 0 };
const PRO_AI_CANCELLED = Symbol('stale-pro-ai-turn');

/** 只比较自身手牌和公开回合状态；排序手牌不应取消同一回合的请求。 */
function proAITurnKey(playerId, engine) {
    return JSON.stringify([engine.state, engine.currentPlayer, engine.roundNumber, engine.levelCard,
        engine.teamLevel?.a, engine.teamLevel?.b,
        engine.hands[playerId].map(card => String(card.id)).sort(),
        engine.hands.map(hand => hand.length), engine.playerFinished, engine.finishOrder,
        engine.lastPlayer, (engine.lastPlay || []).map(card => String(card.id)).sort(), engine.passCount,
        (engine.playedCards || []).length, (engine.publicActionHistory || []).length]);
}

function loadProAISettings() {
    try {
        const stored = JSON.parse(localStorage.getItem(PRO_AI_SETTINGS_KEY) || '{}');
        proAISettings = { ...PRO_AI_DEFAULTS, ...stored };
    } catch (_error) { proAISettings = { ...PRO_AI_DEFAULTS }; }
    return proAISettings;
}
function saveProAISettings(settings) {
    const endpoint = String(settings.endpoint || '').trim();
    const url = new URL(endpoint);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
        throw new Error('专业AI仅允许连接本机服务');
    }
    proAISettings = { enabled: Boolean(settings.enabled), endpoint: url.toString(),
        timeoutMs: Math.max(300, Math.min(5000, Number(settings.timeoutMs) || 1500)) };
    localStorage.setItem(PRO_AI_SETTINGS_KEY, JSON.stringify(proAISettings));
    return proAISettings;
}
function proAICard(card) {
    return { id: card.id, suit: card.suit, rank: card.rank, isJoker: Boolean(card.isJoker) };
}
function proAILegalActions(playerId, engine) {
    const hand = engine.hands[playerId];
    const following = Boolean(engine.lastPlay && engine.lastPlayer !== playerId);
    return withAIStrategyScope(engine, playerId, () => {
        // 同牌型跟牌搜索不包含跨牌型强牌；必须显式补上，不能限制外部策略的选择。
        const candidates = [
            ...(following ? findAllBeatingPlays(hand, engine.lastPlayType, engine.levelCard)
                : findLeadCandidates(hand, engine.levelCard)),
            ...findAllBombs(hand, engine.levelCard),
            ...findAllStraightFlushes(hand, engine.levelCard),
            ...findWildcardPatternPlays(hand, engine.levelCard,
                following ? engine.lastPlayType : null)
        ];
        const rocket = findRocket(hand);
        if (rocket) candidates.push(rocket);
        if (hand.length <= 10) candidates.push([...hand]);
        const owned = new Set(hand.map(card => card.id));
        const seen = new Set();
        const actions = [];
        for (const cards of candidates) {
            const ids = cards.map(card => card.id);
            if (!ids.length || new Set(ids).size !== ids.length || ids.some(id => !owned.has(id))) continue;
            const key = [...ids].sort().join('|');
            if (seen.has(key)) continue;
            const type = identifyHand(cards, engine.levelCard);
            if (!type.valid || (following && !canBeat(type, engine.lastPlayType))) continue;
            seen.add(key);
            actions.push({ cardIds: ids, cards: cards.map(proAICard) });
        }
        if (following) actions.push({ cardIds: [], cards: [], pass: true });
        return actions;
    });
}
function proAIPayload(playerId, engine) {
    const legalActions = proAILegalActions(playerId, engine);
    return { protocol: 'guandan-pro-ai-v1', state: {
        // 用局号隔离牌局，双方真实级别供专业模型评估；不包含任何未公开手牌。
        roundNumber: engine.roundNumber, seat: playerId, levelCard: engine.levelCard,
        teamLevel: { ...(engine.teamLevel || {}) }, currentPlayer: engine.currentPlayer,
        hand: engine.hands[playerId].map(proAICard),
        cardCounts: engine.hands.map(hand => hand.length),
        playerFinished: [...engine.playerFinished],
        lastPlay: (engine.lastPlay || []).map(proAICard),
        lastPlayType: engine.lastPlayType ? { ...engine.lastPlayType } : null,
        lastPlayer: engine.lastPlayer, passCount: engine.passCount,
        playedCards: (engine.playedCards || []).map(proAICard),
        passMemory: (engine.passMemory || []).map(item => ({ ...item })),
        actionHistory: (engine.publicActionHistory || []).map(item => ({
            player: item.player, action: item.action,
            cards: (item.cards || []).map(proAICard)
        })), legalActions
    }};
}
function validateProAIChoice(response, playerId, engine) {
    if (!response || typeof response !== 'object') return undefined;
    if (response.pass === true) return engine.lastPlay && engine.lastPlayer !== playerId ? null : undefined;
    if (!Array.isArray(response.cardIds) || !response.cardIds.length) return undefined;
    const byId = new Map(engine.hands[playerId].map(card => [String(card.id), card]));
    if (new Set(response.cardIds.map(String)).size !== response.cardIds.length) return undefined;
    const cards = response.cardIds.map(id => byId.get(String(id)));
    if (cards.some(card => !card)) return undefined;
    const type = identifyHand(cards, engine.levelCard);
    if (!type.valid || (engine.lastPlay && engine.lastPlayer !== playerId
        && !canBeat(type, engine.lastPlayType))) return undefined;
    return cards;
}
async function decideWithProAI(playerId, engine, fallback, isCurrent = () => true) {
    const settings = proAISettings;
    if (!settings.enabled) return fallback();
    // 收尾是确定性的规则结论，不让模型把可出完的整手拆开或误判过牌。
    // 复用同一合法动作防护，既检查压牌，也返回实际拥有的实体牌。
    if (engine.state === 'playing' && engine.currentPlayer === playerId
        && !engine.playerFinished[playerId] && engine.hands[playerId].length) {
        const finish = validateProAIChoice({ cardIds: engine.hands[playerId].map(card => card.id) }, playerId, engine);
        if (finish !== undefined) {
            proAIStatus = { ...proAIStatus, mode: '规则收尾', detail: '整手可合法出完，直接收尾' };
            return finish;
        }
    }
    if (typeof fetch !== 'function') return fallback();
    const turnKey = proAITurnKey(playerId, engine);
    const currentTurn = () => isCurrent() && proAITurnKey(playerId, engine) === turnKey;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), settings.timeoutMs) : null;
    try {
        const response = await fetch(settings.endpoint, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(proAIPayload(playerId, engine)), signal: controller?.signal
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = await response.json();
        if (!currentTurn()) return PRO_AI_CANCELLED;
        const choice = validateProAIChoice(body, playerId, engine);
        if (choice !== undefined) {
            proAIStatus = { ...proAIStatus, mode: '专业AI', detail: '', uses: proAIStatus.uses + 1 };
            return choice;
        }
        throw new Error('返回了不合法动作');
    } catch (error) {
        if (!currentTurn()) return PRO_AI_CANCELLED;
        proAIStatus = { ...proAIStatus, mode: '内置策略',
            detail: `专业AI回退：${error.message || '不可用'}`, fallbacks: proAIStatus.fallbacks + 1 };
        return fallback();
    } finally { if (timer) clearTimeout(timer); }
}
