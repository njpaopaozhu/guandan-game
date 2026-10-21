/**
 * 掼蛋游戏 - AI模块
 * 包含：智能出牌策略、牌型搜索、队友配合
 *
 * AI策略核心思路：
 * 1. 跟牌时：优先用最小能压过的牌，必要时用炸弹
 * 2. 自由出牌时：优先出小牌组合，保留炸弹和大牌
 * 3. 队友配合：队友出牌不压，对手出牌尽量压
 * 4. 拆牌决策：当手牌少时考虑拆牌快速出完
 */

// ==================== AI出牌 ====================

const AI_PASS_ROLLOUT_STATS = { eligible: 0, chosePass: 0 };
const AI_POLICY_STATS = {
    learned: { eligible: 0, used: 0, fallback: 0 },
    candidate: { eligible: 0, used: 0, fallback: 0 }
};

/**
 * 读取玩家的AI策略版本（默认v3；评测时可按座位指定旧版做A/B对照）
 */
function aiStrategyMode(engine, playerId) {
    if (engine && typeof engine.getStrategyMode === 'function') {
        return engine.getStrategyMode(playerId);
    }
    return 'v3';
}

/**
 * 统计当前玩家视角下"未见过"的牌（= 其他三家可能持有的牌）。
 * 依据：全副牌 - 自己手牌 - 本局已打出的牌（均为公开信息）。
 */
function getUnseenRankCounts(engine, playerId) {
    const counts = {};
    for (const rank of RANKS) counts[rank] = 8; // 两副牌，每点8张
    counts[JOKER_SMALL] = 2;
    counts[JOKER_BIG] = 2;
    const seen = [...(engine.hands[playerId] || []), ...(engine.playedCards || [])];
    for (const card of seen) {
        if (counts[card.rank] !== undefined) counts[card.rank]--;
    }
    return counts;
}

/** 记牌推理：外面是否还有比指定单张更大的牌（炸弹除外）。 */
function hasUnseenHigherSingle(unseen, value, levelCard) {
    for (const rank of RANKS) {
        if (unseen[rank] > 0
            && getCardSingleValue({ rank, value: RANK_VALUE[rank], isJoker: false }, levelCard) > value) {
            return true;
        }
    }
    if (unseen[JOKER_SMALL] > 0 && 200 > value) return true;
    if (unseen[JOKER_BIG] > 0 && 201 > value) return true;
    return false;
}

/** 从未知牌池中随机持有至少一张目标牌的超几何概率。 */
function probabilityAtLeastOne(population, successes, draws) {
    if (successes <= 0 || draws <= 0 || population <= 0) return 0;
    if (successes >= population || draws >= population - successes + 1) return 1;
    let none = 1;
    for (let index = 0; index < Math.min(draws, population); index++) {
        none *= (population - successes - index) / (population - index);
    }
    return Math.max(0, Math.min(1, 1 - none));
}

function countUnseenHigherSingles(unseen, value, levelCard) {
    let count = 0;
    for (const rank of RANKS) {
        if (getCardSingleValue({ rank, value: RANK_VALUE[rank], isJoker: false }, levelCard) > value) {
            count += Math.max(0, unseen[rank] || 0);
        }
    }
    if (200 > value) count += Math.max(0, unseen[JOKER_SMALL] || 0);
    if (201 > value) count += Math.max(0, unseen[JOKER_BIG] || 0);
    return count;
}

/** 估算特定座位能用更大单张接牌的概率，并结合该座位的公开过牌记录修正。 */
function estimateSeatSingleBeatProbability(unseen, value, levelCard, handCount, passEntries = []) {
    const population = Object.values(unseen).reduce((sum, count) => sum + Math.max(0, count), 0);
    let probability = probabilityAtLeastOne(
        population,
        countUnseenHigherSingles(unseen, value, levelCard),
        handCount
    );
    const passedAtOrAbove = passEntries.some(entry => (
        entry.against === HAND_TYPES.SINGLE && entry.value <= value
    ));
    if (passedAtOrAbove) probability *= 0.2;
    return probability;
}

function hashVisibleState(parts) {
    let hash = 2166136261;
    for (const part of parts) {
        const text = String(part);
        for (let index = 0; index < text.length; index++) {
            hash ^= text.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
    }
    return hash >>> 0;
}

function shuffledWithSeed(cards, seed) {
    const result = [...cards];
    let state = seed >>> 0;
    const random = () => {
        state = (Math.imul(1664525, state) + 1013904223) >>> 0;
        return state / 0x100000000;
    };
    for (let index = result.length - 1; index > 0; index--) {
        const other = Math.floor(random() * (index + 1));
        [result[index], result[other]] = [result[other], result[index]];
    }
    return result;
}

/**
 * 只用公开信息生成未知牌的可能座位分布。不会读取其他玩家手牌内容，
 * 同一次决策的所有候选共用同一批样本，保证比较稳定。
 */
function getDeterminizedHands(v2, sampleCount = 6) {
    if (v2.determinizedHands !== undefined) return v2.determinizedHands;
    const engine = v2.engine;
    const playerId = v2.playerId;
    if (!engine || typeof createDeck !== 'function' || !Array.isArray(engine.playedCards)) {
        v2.determinizedHands = null;
        return null;
    }
    const own = engine.hands[playerId] || [];
    const knownIds = new Set([...own, ...engine.playedCards].map(card => card && card.id));
    if ([...knownIds].some(id => !id)) {
        v2.determinizedHands = null;
        return null;
    }
    const pool = createDeck().filter(card => !knownIds.has(card.id));
    const expected = engine.hands.reduce((sum, cards, id) => (
        sum + (id === playerId ? 0 : cards.length)
    ), 0);
    if (pool.length !== expected) {
        v2.determinizedHands = null;
        return null;
    }

    const visibleSeed = hashVisibleState([
        playerId,
        engine.levelCard,
        engine.roundNumber || 0,
        ...own.map(card => card.id).sort(),
        ...engine.playedCards.map(card => card.id).sort()
    ]);
    const samples = [];
    for (let sample = 0; sample < sampleCount; sample++) {
        const shuffled = shuffledWithSeed(pool, visibleSeed + Math.imul(sample + 1, 2654435761));
        const hands = [[], [], [], []];
        let offset = 0;
        for (let seat = 0; seat < 4; seat++) {
            if (seat === playerId) continue;
            const count = engine.hands[seat].length;
            hands[seat] = shuffled.slice(offset, offset + count);
            offset += count;
        }
        samples.push(hands);
    }
    v2.determinizedHands = samples;
    return samples;
}

function sampledHandCanBeat(hand, lastType, levelCard) {
    const regular = hand.filter(card => !isWildLevelCard(card, levelCard));
    if (findAllBeatingPlays(regular, lastType, levelCard).some(play => (
        canBeat(identifyHand(play, levelCard), lastType)
    ))) return true;
    if (hand.length <= 10 && findWildcardPatternPlays(hand, levelCard, lastType).length > 0) {
        return true;
    }
    if (lastType.type !== HAND_TYPES.ROCKET) {
        const powerPlays = [
            ...findAllBombs(regular, levelCard),
            ...findAllStraightFlushes(regular, levelCard),
            ...findWildcardPowerPlays(hand, levelCard),
            ...(findRocket(hand) ? [findRocket(hand)] : [])
        ];
        if (powerPlays.some(play => canBeat(identifyHand(play, levelCard), lastType))) return true;
    }
    return false;
}

/** 估算领出这手后两个对手都无法接牌、我方保住牌权的概率。 */
function estimateLeadControlProbability(play, playType, levelCard, v2) {
    const samples = getDeterminizedHands(v2);
    if (!samples || samples.length === 0) return null;
    const engine = v2.engine;
    let controlled = 0;
    for (const hands of samples) {
        const opponentCanBeat = [0, 1, 2, 3].some(seat => (
            seat !== v2.playerId
            && engine.getTeam(seat) !== engine.getTeam(v2.playerId)
            && !engine.playerFinished[seat]
            && sampledHandCanBeat(hands[seat], playType, levelCard)
        ));
        if (!opponentCanBeat) controlled++;
    }
    return controlled / samples.length;
}

function chooseSampledTrickResponse(hand, lastType, levelCard, allowPower) {
    const regular = hand.filter(card => !isWildLevelCard(card, levelCard));
    let candidates = findAllBeatingPlays(regular, lastType, levelCard)
        .filter(play => canBeat(identifyHand(play, levelCard), lastType));
    if (hand.length <= 10) {
        candidates = dedupeCardPlays([
            ...candidates,
            ...findWildcardPatternPlays(hand, levelCard, lastType)
        ]);
    }
    if (candidates.length === 0 && allowPower && lastType.type !== HAND_TYPES.ROCKET) {
        candidates = dedupeCardPlays([
            ...findAllBombs(regular, levelCard),
            ...findAllStraightFlushes(regular, levelCard),
            ...findWildcardPowerPlays(hand, levelCard),
            ...(findRocket(hand) ? [findRocket(hand)] : [])
        ]).filter(play => canBeat(identifyHand(play, levelCard), lastType));
    }
    if (candidates.length === 0) return null;
    return [...candidates].sort((a, b) => {
        const damage = calculateStructureDamage(hand, a, levelCard)
            - calculateStructureDamage(hand, b, levelCard);
        if (damage !== 0) return damage;
        const typeA = identifyHand(a, levelCard);
        const typeB = identifyHand(b, levelCard);
        return typeA.value - typeB.value || a.length - b.length;
    })[0];
}

/** 在一个可能世界里把当前牌墩模拟到结束，返回牌权是否仍在我方。 */
function simulateSampledTrick(play, playType, levelCard, v2, sampledHands) {
    const engine = v2.engine;
    const ownTeam = engine.getTeam(v2.playerId);
    const hands = sampledHands.map(cards => [...cards]);
    hands[v2.playerId] = removePlayedCards(engine.hands[v2.playerId], play);
    const finished = engine.playerFinished.map((done, seat) => done || hands[seat].length === 0);
    let lastPlayer = v2.playerId;
    let lastType = playType;
    let passCount = 0;
    let current = (v2.playerId + 1) % 4;

    for (let step = 0; step < 24; step++) {
        if (finished[current]) {
            current = (current + 1) % 4;
            continue;
        }
        const sameTeamLeading = engine.getTeam(current) === engine.getTeam(lastPlayer);
        const leaderCards = hands[lastPlayer] ? hands[lastPlayer].length : 0;
        const response = sameTeamLeading ? null : chooseSampledTrickResponse(
            hands[current],
            lastType,
            levelCard,
            hands[current].length <= 6 || leaderCards <= 2
        );
        if (response) {
            hands[current] = removePlayedCards(hands[current], response);
            if (hands[current].length === 0) finished[current] = true;
            lastPlayer = current;
            lastType = identifyHand(response, levelCard);
            passCount = 0;
        } else {
            passCount++;
        }

        const activeCount = finished.filter(done => !done).length;
        const requiredPasses = activeCount - (finished[lastPlayer] ? 0 : 1);
        if (passCount >= Math.max(1, requiredPasses) || activeCount <= 1) {
            return engine.getTeam(lastPlayer) === ownTeam;
        }
        current = (current + 1) % 4;
    }
    return engine.getTeam(lastPlayer) === ownTeam;
}

function estimateTeamTrickWinProbability(play, playType, levelCard, v2) {
    const samples = getDeterminizedHands(v2);
    if (!samples || samples.length === 0) return null;
    let wins = 0;
    for (const sampledHands of samples) {
        if (simulateSampledTrick(play, playType, levelCard, v2, sampledHands)) wins++;
    }
    return wins / samples.length;
}

function terminalPublicRolloutScore(engine, playerId) {
    const record = engine.history[engine.history.length - 1];
    if (!record || !record.result) return -20;
    const team = engine.getTeam(playerId);
    const won = record.result.winnerTeam === team;
    const teammate = engine.getTeammate(playerId);
    const teamPositions = [playerId, teammate].map(id => record.finishOrder.indexOf(id));
    const opponentPositions = record.finishOrder
        .map((id, index) => ({ id, index }))
        .filter(row => engine.getTeam(row.id) !== team)
        .map(row => row.index);
    const placementMargin = (opponentPositions.reduce((sum, value) => sum + value, 0)
        - teamPositions.reduce((sum, value) => sum + value, 0)) / 3;
    return (won ? 2 : -2) + (won ? 1 : -1) * Math.max(1, record.result.levelUp || 1)
        + placementMargin * 0.5;
}

/** 只复制公开局面、自家手牌与采样手牌；不能先序列化真实暗牌再替换。 */
function clonePublicRolloutEngine(engine, playerId, sampledHands) {
    if (!Number.isInteger(playerId) || playerId < 0 || playerId > 3
        || !Array.isArray(sampledHands) || sampledHands.length !== 4) {
        throw new Error('invalid public rollout seat/world');
    }
    const clone = new GameEngine();
    const publicFields = ['currentPlayer', 'lastPlay', 'lastPlayType', 'lastPlayer',
        'passCount', 'roundNumber', 'teamLevel', 'roundLevel', 'matchOver', 'matchWinner',
        'finishOrder', 'playerFinished', 'state', 'history', 'levelCard', 'pendingTributes',
        'lastTributeExchanges', 'lastTributeResisted', 'tributeOpeningPlayer', 'pendingPlayerReturns',
        'playedCards', 'passMemory', 'publicActionHistory', 'humanOpponentProfile',
        'humanAdaptationWeight', 'humanChoiceScale', 'humanProfileLeadMaxCount',
        'aiPolicyMarginByPlayer', 'aiPowerFinishByPlayer', 'aiTwoPlayPowerByPlayer',
        'aiWildEquivalentByPlayer', 'aiWildFollowByPlayer', 'aiWildResidualByPlayer',
        'controlFinishByPlayer', 'controlOrderByPlayer', 'singleDisposalByPlayer'];
    for (const field of publicFields) {
        if (engine[field] !== undefined) clone[field] = JSON.parse(JSON.stringify(engine[field]));
    }
    const seen = new Set();
    const deck = new Map(createDeck().map(card => [card.id, card]));
    clone.hands = Array.from({ length: 4 }, (_, seat) => {
        const cards = seat === playerId ? engine.hands[playerId] : sampledHands[seat];
        if (!Array.isArray(cards) || cards.length !== engine.hands[seat].length) {
            throw new Error('sampled hand disagrees with public count');
        }
        for (const card of cards) {
            const physical = card && deck.get(card.id);
            if (!physical || seen.has(card.id)) throw new Error('invalid or duplicated sampled card');
            if (['suit', 'rank', 'value', 'isJoker'].some(key => physical[key] !== card[key])) {
                throw new Error('sampled card metadata differs from deck');
            }
            seen.add(card.id);
        }
        return JSON.parse(JSON.stringify(cards));
    });
    for (const card of clone.playedCards) {
        if (seen.has(card.id)) throw new Error('sampled card already publicly played');
        seen.add(card.id);
    }
    if (seen.size !== 108) throw new Error('sampled world violates card conservation');
    return clone;
}

/** 从同一公开采样世界比较“跟牌”和“过牌”，后续关闭回放以避免递归。 */
function evaluatePublicRolloutOption(engine, playerId, play, sampledHands, simOverride) {
    const clone = clonePublicRolloutEngine(engine, playerId, sampledHands);
    // 回放内部仿真策略可用 engine.aiRolloutConfig 或调用方覆盖（v5默认v1规则，
    // 速度快且所有候选用同一仿真策略，相对比较仍然成立）。
    const simConfig = simOverride || (engine && engine.aiRolloutConfig ? engine.aiRolloutConfig : {});
    const simMode = typeof simConfig.simMode === 'string' ? simConfig.simMode : 'v3';
    // 防御：仿真策略绝不允许是回放模式自身，否则无限递归。
    clone.aiStrategyMode = simMode.startsWith('v5-rollout') ? 'v3' : simMode;
    clone.aiStrategyByPlayer = null;
    clone.aiPolicyMode = typeof simConfig.simPolicy === 'string' ? simConfig.simPolicy : 'learned';
    clone.aiPolicyByPlayer = null;
    // 回放克隆绝不再触发回放决策，避免递归。
    clone.aiRolloutConfig = null;
    clone.aiRolloutConfigByPlayer = null;
    let first;
    if (play) {
        const mapped = play.map(card => clone.hands[playerId].find(item => item.id === card.id));
        if (mapped.some(card => !card)) return -20;
        first = clone.playCards(playerId, mapped);
    } else {
        first = clone.passCards(playerId);
    }
    if (!first.success) return -20;

    let steps = 0;
    while (clone.state === 'playing' && steps++ < 1500) {
        const current = clone.currentPlayer;
        const choice = aiDecidePlay(current, clone);
        const result = choice && choice.length
            ? clone.playCards(current, choice)
            : clone.passCards(current);
        if (!result.success) return -20;
    }
    return clone.state === 'playing' ? -20 : terminalPublicRolloutScore(clone, playerId);
}

function publicRolloutPrefersPass(hand, play, type, levelCard, v2) {
    if (type.type !== HAND_TYPES.SINGLE || type.value < 14
        || hand.length < 6 || hand.length > 12 || v2.minOpp <= 4
        || v2.engine.playerFinished[v2.engine.lastPlayer]) return false;
    const remaining = removePlayedCards(hand, play);
    const planner = createTurnEstimator(levelCard);
    if (planner(remaining) <= 2 || planner.residue(remaining) <= 0) return false;

    const samples = getDeterminizedHands(v2, 4);
    if (!samples || samples.length === 0) return false;
    AI_PASS_ROLLOUT_STATS.eligible++;
    let playScore = 0;
    let passScore = 0;
    for (const sampledHands of samples) {
        playScore += evaluatePublicRolloutOption(v2.engine, v2.playerId, play, sampledHands);
        passScore += evaluatePublicRolloutOption(v2.engine, v2.playerId, null, sampledHands);
    }
    const chosePass = passScore > playScore + samples.length * v2.passRolloutMargin;
    if (chosePass) AI_PASS_ROLLOUT_STATS.chosePass++;
    return chosePass;
}

// ==================== v5 通用回放决策 ====================

const AI_ROLLOUT_STATS = { decisions: 0, scored: 0, changed: 0, rollouts: 0, ms: 0 };

/** 读取回放配置（样本数/候选上限/推翻门槛/时间预算），全部有保守默认值。 */
function getRolloutConfig(engine, playerId) {
    const base = engine && engine.aiRolloutConfig ? engine.aiRolloutConfig : {};
    // 逐座位覆盖：评测工具做“同一牌序、只改一个变量”的版本对撞时，
    // 需要两侧在同一局里使用不同的回放配置（全局配置会同时作用于双方）。
    const perPlayer = engine && Array.isArray(engine.aiRolloutConfigByPlayer)
        ? engine.aiRolloutConfigByPlayer[playerId]
        : null;
    const config = perPlayer && typeof perPlayer === 'object' ? { ...base, ...perPlayer } : base;
    return {
        samples: Number.isInteger(config.samples) && config.samples >= 1 ? config.samples : 4,
        maxOptions: Number.isInteger(config.maxOptions) && config.maxOptions >= 2 ? config.maxOptions : 3,
        margin: Number.isFinite(config.margin) && config.margin >= 0 ? config.margin : 0.25,
        budgetMs: Number.isFinite(config.budgetMs) && config.budgetMs > 0 ? config.budgetMs : 700,
        // 早局门控：手牌还多且无人逼近终点时，启发式+v17已足够，跳过昂贵回放。
        maxHandSize: Number.isInteger(config.maxHandSize) && config.maxHandSize >= 4 ? config.maxHandSize : 16,
        threatCards: Number.isInteger(config.threatCards) && config.threatCards >= 1 ? config.threatCards : 8,
        // 序贯剪枝：挑战者部分均值落后默认决策超过该值即淘汰，节省回放次数。
        pruneMargin: Number.isFinite(config.pruneMargin) && config.pruneMargin >= 0 ? config.pruneMargin : 0.75,
        // 回放内部仿真策略：默认v1规则（快）；统一仿真口径不等于排序一定正确。
        simMode: typeof config.simMode === 'string' ? config.simMode : 'v1',
        simPolicy: typeof config.simPolicy === 'string' ? config.simPolicy : 'legacy',
        // 改判为“过牌”的独立门槛：跟牌回放单独使用时显著弱于基线（消融43.75%），
        // 2026-10-09 定位到有害成分就是“出牌→过牌”这一类改判（廉价仿真低估牌权价值）。
        // 默认取 5 分/样本，4 个样本时需要 20 分优势，实践上等于禁止 play→pass 改判：
        // 跟牌模式因此从 43.75% 回到 52.50%（120 场），完整模式从 58.96% 升到 60.91%（220 场）。
        // 想恢复旧行为可显式配置 passMargin=0.25（与 margin 相同）。
        passMargin: Number.isFinite(config.passMargin) && config.passMargin >= 0 ? config.passMargin : 5
    };
}

function playIdentityKey(play) {
    return play ? play.map(card => card.id).sort().join('|') : 'pass';
}

/**
 * 领牌候选：整手评分最优的前若干名 + 默认决策。候选集合与 aiFreePlay 的搜索
 * 空间一致（常规候选 + 短手牌百搭模板），保证回放只比较规则内合理的出牌。
 */
function buildRolloutLeadOptions(hand, basePlay, playerId, engine, maxOptions) {
    const levelCard = engine.levelCard;
    const regular = hand.filter(card => !isWildLevelCard(card, levelCard));
    const searchHand = regular.length > 0 ? regular : hand;
    let candidates = findLeadCandidates(searchHand, levelCard);
    if (hand.length <= 10 && hand.some(card => isWildLevelCard(card, levelCard))) {
        candidates = dedupeCardPlays([...candidates, ...findWildcardPatternPlays(hand, levelCard)]);
    }
    if (candidates.length === 0) return [basePlay];
    const v2 = buildAIContext(engine, playerId, 'lead');
    const planner = createTurnEstimator(levelCard);
    const context = { engine, playerId, phase: 'lead', v2 };
    const ranked = candidates.map(play => ({
        play,
        score: scoreStrategicPlay(hand, play, levelCard, planner, context)
    })).sort((a, b) => a.score - b.score);
    const options = [];
    const seen = new Set();
    const add = play => {
        if (!play) return;
        const key = playIdentityKey(play);
        if (!seen.has(key)) {
            seen.add(key);
            options.push(play);
        }
    };
    add(basePlay);
    for (const item of ranked) {
        if (options.length >= maxOptions) break;
        add(item.play);
    }
    return options;
}

/**
 * 跟牌候选：默认决策、过牌、最便宜同型跟牌；默认已过牌时再加最小强牌拦截。
 * 队友领牌由调用方排除，不干扰配合约定。
 */
function buildRolloutFollowOptions(hand, basePlay, playerId, engine, maxOptions) {
    const levelCard = engine.levelCard;
    const lastType = engine.lastPlayType;
    const options = [];
    const seen = new Set();
    const add = play => {
        const key = playIdentityKey(play);
        if (!seen.has(key)) {
            seen.add(key);
            options.push(play);
        }
    };
    add(basePlay);
    add(null);
    if (options.length >= maxOptions) return options;
    const cheapest = chooseSampledTrickResponse(hand, lastType, levelCard, false);
    if (cheapest) add(cheapest);
    if (!basePlay && options.length < maxOptions) {
        const withPower = chooseSampledTrickResponse(hand, lastType, levelCard, true);
        if (withPower) add(withPower);
    }
    return options.slice(0, Math.max(2, maxOptions));
}

/**
 * v5决策层：在默认决策（v3规则+v17模型）产出后，用确定性采样的公开世界
 * 把每个候选出牌/过牌完整回放到本局结束，按平均终局分重新选择。
 * 只有明显更优（净胜 margin × 样本数）才推翻默认决策；任何异常都回退默认。
 */
function aiRolloutRefinePlay(hand, basePlay, playerId, engine) {
    const mode = aiStrategyMode(engine, playerId);
    if (!mode || !mode.startsWith('v5-rollout')) return basePlay;
    if (!basePlay || basePlay.length >= hand.length) return basePlay;
    const isLead = !engine.lastPlay || engine.lastPlayer === playerId;
    // 用 startsWith 兼容 '-co' 等评测后缀（如 v5-rollout-lead-co 仍只接管领牌）。
    if (mode.startsWith('v5-rollout-lead') && !isLead) return basePlay;
    if (mode.startsWith('v5-rollout-follow') && isLead) return basePlay;
    if (!isLead && engine.lastPlayer === engine.getTeammate(playerId)) return basePlay;
    if (typeof GameEngine !== 'function' || typeof evaluatePublicRolloutOption !== 'function') {
        return basePlay;
    }

    try {
        const config = getRolloutConfig(engine, playerId);
        const context = buildAIContext(engine, playerId, isLead ? 'lead' : 'follow');
        if (!context) return basePlay;
        // 早局门控：手牌多且无人逼近终点时跳过回放（早局单次回放也最贵）。
        const threatened = context.minOpp <= config.threatCards
            || (!context.teammateFinished && context.teammateCount > 0 && context.teammateCount <= 4);
        if (hand.length > config.maxHandSize && !threatened) return basePlay;

        const options = isLead
            ? buildRolloutLeadOptions(hand, basePlay, playerId, engine, config.maxOptions)
            : buildRolloutFollowOptions(hand, basePlay, playerId, engine, config.maxOptions);
        if (!Array.isArray(options) || options.length < 2) return basePlay;

        const samples = getDeterminizedHands(context, config.samples);
        if (!samples || samples.length === 0) return basePlay;

        AI_ROLLOUT_STATS.decisions++;
        const start = Date.now();
        const baseIndex = Math.max(0, options.findIndex(
            option => playIdentityKey(option) === playIdentityKey(basePlay)
        ));
        // 逐样本轮转打分：所有候选在同一可能世界比较。挑战者部分均值显著
        // 落后默认决策时提前淘汰（序贯剪枝），超预算时按相同样本数截断。
        const totals = options.map(() => 0);
        const alive = options.map(() => true);
        let usedSamples = 0;
        for (let sample = 0; sample < samples.length; sample++) {
            for (let option = 0; option < options.length; option++) {
                if (!alive[option]) continue;
                totals[option] += evaluatePublicRolloutOption(
                    engine, playerId, options[option], samples[sample],
                    { simMode: config.simMode, simPolicy: config.simPolicy }
                );
                AI_ROLLOUT_STATS.rollouts++;
            }
            usedSamples++;
            // 剪枝：淘汰落后默认决策的挑战者（默认决策永不淘汰）。
            const baseMean = totals[baseIndex] / usedSamples;
            for (let option = 0; option < options.length; option++) {
                if (!alive[option] || option === baseIndex) continue;
                if (totals[option] / usedSamples < baseMean - config.pruneMargin) {
                    alive[option] = false;
                }
            }
            if (Date.now() - start > config.budgetMs) break;
        }
        AI_ROLLOUT_STATS.ms += Date.now() - start;
        AI_ROLLOUT_STATS.scored++;
        if (usedSamples === 0) return basePlay;

        const baseScore = totals[baseIndex];
        let bestIndex = baseIndex;
        let bestScore = baseScore;
        for (let index = 0; index < options.length; index++) {
            if (!alive[index]) continue;
            if (totals[index] > bestScore + 1e-9) {
                bestScore = totals[index];
                bestIndex = index;
            }
        }
        if (bestIndex === baseIndex) return basePlay;
        // 跟牌时“出牌 → 过牌”的改判使用更严门槛：廉价仿真的世界不惩罚过牌，
        // 容易把牌权让掉，故单独设 passMargin（未配置则与 margin 相同）。
        const chosen = options[bestIndex];
        const switchesToPass = !isLead && (chosen === null || chosen === undefined)
            && Array.isArray(basePlay) && basePlay.length > 0;
        const requiredMargin = switchesToPass && config.passMargin !== null
            ? config.passMargin
            : config.margin;
        if (bestScore <= baseScore + usedSamples * requiredMargin) return basePlay;
        AI_ROLLOUT_STATS.changed++;
        return options[bestIndex];
    } catch (error) {
        return basePlay;
    }
}

/**
 * 构建v2决策上下文：威胁分级、下家情况、队友情况、记牌结果、对手弱项。
 * v1模式或无引擎时返回null，所有v2逻辑自动跳过。
 */
function buildAIContext(engine, playerId, phase) {
    const requestedMode = aiStrategyMode(engine, playerId);
    const strategyMode = requestedMode.replace(/-co$/, '');
    const isPassRollout = strategyMode.startsWith('v4-pass-rollout');
    const isV5Rollout = strategyMode.startsWith('v5-rollout');
    if (!engine || strategyMode === 'v1') return null;
    // 防御：mock引擎/不完整引擎直接回退（与v1行为一致）
    if (typeof engine.getTeammate !== 'function' || typeof engine.getTeam !== 'function'
        || !Array.isArray(engine.hands) || !Array.isArray(engine.playerFinished)
        || !Array.isArray(engine.hands[playerId] || [])) return null;
    const teammate = engine.getTeammate(playerId);
    // 空手未结算只可能出现在构造的测试引擎里；真实对局中空手必然已出完，
    // 这里统一按"已出完"处理，避免威胁分级失真。
    const isDone = id => engine.playerFinished[id] || (engine.hands[id] || []).length === 0;
    const activeOpps = [0, 1, 2, 3].filter(id => (
        engine.getTeam(id) !== engine.getTeam(playerId) && !isDone(id)
    ));
    const oppCounts = activeOpps.map(id => engine.hands[id].length);
    const minOpp = oppCounts.length ? Math.min(...oppCounts) : Infinity;

    // 行动顺序上最近的一个未出完对手（真正的"下家威胁"）
    let nextOppCount = Infinity;
    let nextOpponentId = -1;
    for (let offset = 1; offset <= 3; offset++) {
        const candidate = (playerId + offset) % 4;
        if (isDone(candidate)) continue;
        if (engine.getTeam(candidate) !== engine.getTeam(playerId)) {
            nextOppCount = engine.hands[candidate].length;
            nextOpponentId = candidate;
            break;
        }
    }

    const isV4Family = strategyMode === 'v4'
        || strategyMode === 'v4-lead'
        || strategyMode === 'v4-follow'
        || strategyMode === 'v4-team'
        || strategyMode === 'v4-search'
        || strategyMode === 'v4-search-low'
        || strategyMode === 'v4-search-high'
        || strategyMode === 'v4-coverage'
        || strategyMode === 'v4-wild-plan'
        || strategyMode === 'v4-pass'
        || strategyMode === 'v4-single-coverage'
        || strategyMode === 'v4-power-count'
        || strategyMode === 'v4-bomb-initiative'
        || strategyMode === 'v4-bomb-initiative-wide'
        || strategyMode === 'v4-wild-bomb-split'
        || strategyMode === 'v4-lead-policy-only'
        || strategyMode === 'v4-control-reserve'
        || strategyMode === 'v4-control-reserve-high'
        || strategyMode === 'v4-control-reserve-wide'
        || strategyMode === 'v4-control-budget'
        || strategyMode === 'v4-planned-residue'
        || strategyMode === 'v4-planned-residue-low'
        || strategyMode === 'v4-planned-residue-high'
        || isPassRollout
        || strategyMode === 'v3-no-wild-plan'
        || strategyMode === 'v3-no-bomb-initiative';
    return {
        strategyMode,
        isV3: strategyMode === 'v3' || strategyMode === 'v3-no-bomb-initiative' || isV4Family || isV5Rollout,
        // 普通百搭中盘扩展仍处于实验模式；对抗赛显示主动领出会损失牌权。
        // 正式v3继续使用已验证的百搭炸弹/同花顺与8张内残局逻辑。
        useV3Wildcards: strategyMode === 'v3-wild',
        useV3Teamplay: strategyMode === 'v3' || strategyMode === 'v3-no-bomb-initiative'
            || isV4Family || isV5Rollout || strategyMode === 'v3-team',
        useV3Endgame: strategyMode === 'v3' || strategyMode === 'v3-no-bomb-initiative'
            || isV4Family || isV5Rollout || strategyMode === 'v3-endgame',
        useV4LeadProbability: strategyMode === 'v4' || strategyMode === 'v4-lead',
        useV4FollowProbability: strategyMode === 'v4' || strategyMode === 'v4-follow',
        useV4TeamProbability: strategyMode === 'v4' || strategyMode === 'v4-team',
        useV4Search: strategyMode === 'v4-search'
            || strategyMode === 'v4-search-low'
            || strategyMode === 'v4-search-high',
        useV4StructuralCoverage: strategyMode === 'v3' || strategyMode === 'v3-no-bomb-initiative'
            || strategyMode === 'v4-coverage'
            || strategyMode === 'v4-wild-plan'
            || strategyMode === 'v4-pass'
            || strategyMode === 'v4-single-coverage'
            || strategyMode === 'v4-power-count'
            || strategyMode === 'v4-bomb-initiative'
            || strategyMode === 'v4-wild-bomb-split'
            || strategyMode === 'v4-lead-policy-only'
            || strategyMode === 'v4-control-reserve'
            || strategyMode === 'v4-control-reserve-high'
            || strategyMode === 'v4-control-reserve-wide'
            || strategyMode === 'v4-control-budget'
            || strategyMode === 'v4-planned-residue'
            || strategyMode === 'v4-planned-residue-low'
            || strategyMode === 'v4-planned-residue-high'
            || isPassRollout
            || isV5Rollout
            || strategyMode === 'v3-no-wild-plan',
        useV4WildPlanner: strategyMode === 'v4-wild-plan',
        useV4PassInference: strategyMode === 'v4-pass',
        useV4FinishPath: strategyMode === 'v3' || strategyMode === 'v3-no-bomb-initiative'
            || strategyMode === 'v4-single-coverage'
            || strategyMode === 'v4-power-count'
            || strategyMode === 'v4-bomb-initiative'
            || strategyMode === 'v4-wild-bomb-split'
            || strategyMode === 'v4-lead-policy-only'
            || strategyMode === 'v4-control-reserve'
            || strategyMode === 'v4-control-reserve-high'
            || strategyMode === 'v4-control-reserve-wide'
            || strategyMode === 'v4-control-budget'
            || strategyMode === 'v4-planned-residue'
            || strategyMode === 'v4-planned-residue-low'
            || strategyMode === 'v4-planned-residue-high'
            || isPassRollout
            || isV5Rollout,
        useV4PassRollout: isPassRollout,
        passRolloutMargin: strategyMode === 'v4-pass-rollout-zero'
            ? 0 : strategyMode === 'v4-pass-rollout-strict' ? 0.5 : 0.25,
        useV4PlannedResidue: strategyMode === 'v4-planned-residue'
            || strategyMode === 'v4-planned-residue-low'
            || strategyMode === 'v4-planned-residue-high',
        plannedResidueScale: strategyMode === 'v4-planned-residue-low'
            ? 0.5 : strategyMode === 'v4-planned-residue-high' ? 1.5 : 1,
        useV4LeadOnlyPolicy: strategyMode === 'v4-lead-policy-only',
        // 中盘多强牌主动炸仍为实验策略；独立种子结果尚不稳定，
        // 默认 v3 继续采用已验证的节制阈值。
        useV4BombInitiative: strategyMode === 'v4-bomb-initiative'
            || strategyMode === 'v4-bomb-initiative-wide',
        bombInitiativeHandLimit: strategyMode === 'v4-bomb-initiative-wide' ? 24 : 20,
        useV4ControlReserve: strategyMode === 'v4-control-reserve'
            || strategyMode === 'v4-control-reserve-high'
            || strategyMode === 'v4-control-reserve-wide'
            || strategyMode === 'v4-control-budget',
        v4SearchWeightScale: strategyMode === 'v4-search-low'
            ? 0.5 : strategyMode === 'v4-search-high' ? 1.5 : 1,
        engine,
        playerId,
        phase,
        urgent: minOpp <= 2,        // 有对手即将出完：必须不惜代价拦截
        moderate: minOpp <= 4,      // 有对手进入危险区：放宽炸弹性价比
        minOpp,
        nextOppCount,
        nextOpponentId,
        teammateCount: isDone(teammate) ? 0 : engine.hands[teammate].length,
        teammateFinished: isDone(teammate),
        unseen: getUnseenRankCounts(engine, playerId),
        // 对手本局曾公开表示压不了的牌型（领牌时优先复用）
        oppPassTypes: (engine.passMemory || [])
            .filter(entry => engine.getTeam(entry.player) !== engine.getTeam(playerId))
            .map(entry => entry.against),
        opponentPasses: (engine.passMemory || [])
            .filter(entry => engine.getTeam(entry.player) !== engine.getTeam(playerId)),
        nextOpponentPasses: (engine.passMemory || [])
            .filter(entry => entry.player === nextOpponentId),
        // 只有与真人0号位对立的 AI 才能读取长期画像；真人队友不会反向利用它。
        humanOpponentProfile: engine.getTeam(0) !== engine.getTeam(playerId)
            ? engine.humanOpponentProfile || null : null,
        humanOpponentCount: engine.getTeam(0) !== engine.getTeam(playerId)
            ? engine.hands[0].length : Infinity,
        humanAdaptationWeight: Number.isFinite(engine.humanAdaptationWeight)
            ? engine.humanAdaptationWeight : 220,
        // 选牌模仿信号先持续训练；只有离线/实战验证通过后才提高此门控值。
        humanChoiceScale: Number.isFinite(engine.humanChoiceScale)
            ? engine.humanChoiceScale : 0,
        humanProfileLeadMaxCount: Number.isFinite(engine.humanProfileLeadMaxCount)
            ? engine.humanProfileLeadMaxCount : 5,
        // 仅供成对回归评测逐座位关闭；正式游戏默认启用。
        useSingleDisposal: !Array.isArray(engine.singleDisposalByPlayer)
            || engine.singleDisposalByPlayer[playerId] !== false,
        useControlFinish: !Array.isArray(engine.controlFinishByPlayer)
            || engine.controlFinishByPlayer[playerId] !== false,
        // G盘已验证的先清小组合继续默认启用；评测可逐座位关闭。
        useControlOrder: requestedMode.endsWith('-co')
            || !Array.isArray(engine.controlOrderByPlayer)
            || engine.controlOrderByPlayer[playerId] !== false
    };
}

/** 统计手牌中的强牌数量（炸弹按点数去重 + 同花顺 + 百搭强牌 + 火箭）。 */
function countPowerPlays(hand, levelCard) {
    if (AI_INDEPENDENT_POWER_COUNT_ENABLED) {
        return countIndependentPowerPlays(hand, levelCard);
    }
    const regular = hand.filter(card => !isWildLevelCard(card, levelCard));
    const groups = groupByRank(regular.filter(card => !card.isJoker));
    let count = Object.values(groups).filter(cards => cards.length >= 4).length;
    count += findAllStraightFlushes(regular, levelCard).length;
    count += findWildcardPowerPlays(hand, levelCard).length;
    if (findRocket(hand)) count += 1;
    return count;
}

/**
 * 强牌候选可能共用同一张百搭或同一组自然牌，不能把互斥候选误算成多套资源。
 * 当前策略只需要区分“0套 / 1套 / 至少2套”，因此寻找一对不重叠候选即可。
 */
function countIndependentPowerPlays(hand, levelCard) {
    const regular = hand.filter(card => !isWildLevelCard(card, levelCard));
    const candidates = dedupeCardPlays([
        ...findAllBombs(regular, levelCard),
        ...findAllStraightFlushes(regular, levelCard),
        ...findWildcardPowerPlays(hand, levelCard),
        ...(findRocket(hand) ? [findRocket(hand)] : [])
    ]);
    if (candidates.length === 0) return 0;
    const idSets = candidates.map(play => new Set(play.map(card => card.id)));
    for (let first = 0; first < idSets.length; first++) {
        for (let second = first + 1; second < idSets.length; second++) {
            if ([...idSets[first]].every(id => !idSets[second].has(id))) return 2;
        }
    }
    return 1;
}

/** 在一次决策内启用对应策略的候选开关，并保证异常时也恢复模块状态。 */
function withAIStrategyScope(engine, playerId, decide) {
    const previousCoverageMode = AI_STRUCTURAL_COVERAGE_ENABLED;
    const previousSingleCoverageMode = AI_SINGLE_COVERAGE_ENABLED;
    const previousPowerCountMode = AI_INDEPENDENT_POWER_COUNT_ENABLED;
    const previousPartialWildBombMode = AI_PARTIAL_WILDCARD_BOMBS_ENABLED;
    const strategyMode = aiStrategyMode(engine, playerId).replace(/-co$/, '');
    const isPassRollout = strategyMode.startsWith('v4-pass-rollout');
    const isV5Rollout = strategyMode.startsWith('v5-rollout');
    AI_STRUCTURAL_COVERAGE_ENABLED = [
        'v3', 'v3-no-bomb-initiative', 'v4-coverage', 'v4-wild-plan', 'v4-pass', 'v4-single-coverage',
        'v4-power-count', 'v4-bomb-initiative', 'v4-bomb-initiative-wide',
        'v4-wild-bomb-split',
        'v4-lead-policy-only', 'v4-control-reserve',
        'v4-control-reserve-high', 'v4-control-reserve-wide', 'v4-control-budget',
        'v4-planned-residue', 'v4-planned-residue-low', 'v4-planned-residue-high',
        'v3-no-wild-plan'
    ].includes(strategyMode) || isPassRollout || isV5Rollout;
    AI_SINGLE_COVERAGE_ENABLED = [
        'v3', 'v3-no-bomb-initiative', 'v4-single-coverage', 'v4-power-count', 'v4-bomb-initiative',
        'v4-bomb-initiative-wide', 'v4-wild-bomb-split', 'v4-lead-policy-only',
        'v4-control-reserve', 'v4-control-reserve-high', 'v4-control-reserve-wide',
        'v4-control-budget', 'v4-planned-residue', 'v4-planned-residue-low',
        'v4-planned-residue-high'
    ].includes(strategyMode) || isPassRollout || isV5Rollout;
    AI_INDEPENDENT_POWER_COUNT_ENABLED = strategyMode === 'v4-power-count'
        || strategyMode === 'v4-bomb-initiative'
        || strategyMode === 'v4-bomb-initiative-wide';
    AI_PARTIAL_WILDCARD_BOMBS_ENABLED = strategyMode === 'v4-wild-bomb-split';
    try {
        return decide();
    } finally {
        AI_STRUCTURAL_COVERAGE_ENABLED = previousCoverageMode;
        AI_SINGLE_COVERAGE_ENABLED = previousSingleCoverageMode;
        AI_INDEPENDENT_POWER_COUNT_ENABLED = previousPowerCountMode;
        AI_PARTIAL_WILDCARD_BOMBS_ENABLED = previousPartialWildBombMode;
    }
}

/**
 * AI主入口：决定出什么牌
 * @param {number} playerId - AI玩家ID
 * @param {GameEngine} engine - 游戏引擎
 * @returns {Array|null} 要出的牌数组，null表示过牌
 */
function aiDecidePlay(playerId, engine) {
    const hand = engine.hands[playerId];
    if (hand.length === 0) return null;
    const play = withAIStrategyScope(engine, playerId, () => {
        const teammate = engine.getTeammate(playerId);

        // 如果没有上家出牌（自由出牌）
        if (!engine.lastPlay || engine.lastPlayer === playerId) {
            return aiRolloutRefinePlay(hand, aiFreePlay(hand, playerId, engine), playerId, engine);
        }

        // 有上家出牌，需要跟牌；残局额外检查是否拆开了本可两手走完的强牌。
        const followPlay = aiFollowPlay(hand, playerId, engine, teammate);
        return aiRolloutRefinePlay(
            hand,
            refineTwoPowerFinish(hand, followPlay, playerId, engine, teammate),
            playerId,
            engine
        );
    });
    return (!Array.isArray(engine.aiWildEquivalentByPlayer)
        || engine.aiWildEquivalentByPlayer[playerId] !== false)
        ? preserveEquivalentWildcardFinish(hand, play, engine.levelCard) : play;
}

/** 同型同点数的倒数第二手优先用自然牌，把更灵活的百搭留作末手。 */
function preserveEquivalentWildcardFinish(hand, play, levelCard) {
    if (!play || hand.length - play.length !== 1) return play;
    const wilds = play.filter(card => isWildLevelCard(card, levelCard));
    if (!wilds.length) return play;
    const remaining = removePlayedCards(hand, play)[0];
    if (isWildLevelCard(remaining, levelCard)) return play;
    const original = identifyHand(play, levelCard);
    for (const wild of wilds) {
        const swapped = play.map(card => card.id === wild.id ? remaining : card);
        const type = identifyHand(swapped, levelCard);
        if (type.valid && type.type === original.type && type.value === original.value
            && type.length === original.length) return swapped;
    }
    return play;
}

/** 敌方控牌时，双强牌残局优先完整出小炸、留下另一手强牌。 */
function refineTwoPowerFinish(hand, play, playerId, engine, teammate) {
    if (engine.lastPlayer === teammate || hand.length > 10 || !play
        || play.length === hand.length) return play;
    const levelCard = engine.levelCard;
    if (identifyHand(removePlayedCards(hand, play), levelCard).valid) return play;

    const v2 = buildAIContext(engine, playerId, 'follow');
    const regular = hand.filter(card => !isWildLevelCard(card, levelCard));
    const rocket = findRocket(hand);
    const isPower = type => type.type === HAND_TYPES.BOMB
        || type.type === HAND_TYPES.STRAIGHT_FLUSH || type.type === HAND_TYPES.ROCKET;
    const candidates = dedupeCardPlays([
        ...findAllBombs(regular, levelCard),
        ...findAllStraightFlushes(regular, levelCard),
        ...findWildcardPowerPlays(hand, levelCard),
        ...(rocket && (hand.length <= 5 || (v2 && v2.urgent)) ? [rocket] : [])
    ]).filter(candidate => canBeat(identifyHand(candidate, levelCard), engine.lastPlayType)
        && isPower(identifyHand(removePlayedCards(hand, candidate), levelCard)));
    if (candidates.length === 0) return play;

    // 都能留下整手强牌时，先用规则最小的炸；多出一张不值得消耗更大的炸弹。
    candidates.sort((a, b) => comparePowerPlays(a, b, levelCard));
    const best = candidates[0];
    const planner = createTurnEstimator(levelCard);
    const context = { engine, playerId, phase: 'follow', v2 };
    return scoreStrategicPlay(hand, best, levelCard, planner, context)
        < scoreStrategicPlay(hand, play, levelCard, planner, context) ? best : play;
}

/**
 * 自由出牌（首轮或接风）
 * 策略：出最小的有效牌型组合
 */
function aiFreePlay(hand, playerId, engine) {
    const levelCard = engine.levelCard;
    const regularHand = hand.filter(card => !isWildLevelCard(card, levelCard));
    const v2 = buildAIContext(engine, playerId, 'lead');

    // 只要整手牌本身合法就直接走完。自然牌先做廉价识别；百搭穷举只需覆盖
    // 最多8张同点数加2张红桃级牌形成的10张炸弹。
    const naturalAllType = identifyNaturalHand(hand, levelCard);
    if (naturalAllType.valid) return [...hand];
    if (hand.length <= 10 && hand.some(card => isWildLevelCard(card, levelCard))) {
        const wildcardAllType = identifyHand(hand, levelCard);
        if (wildcardAllType.valid) return [...hand];
    }

    // 常规阶段把红桃级牌从普通搜索中隔离，避免当单张或普通组合浪费。
    const searchHand = regularHand.length > 0 ? regularHand : hand;
    // 比较所有常规候选出完后的剩余手数和拆牌损伤，不再固定“见顺子就先出”。
    const naturalCandidates = findLeadCandidates(searchHand, levelCard);
    const allCandidates = v2 && v2.useV3Wildcards
        ? dedupeCardPlays([...naturalCandidates, ...findWildcardPatternPlays(hand, levelCard)])
        : naturalCandidates;
    // 评测可逐座位关闭这项残局修正，以同发牌对照旧行为。
    const useWildcardRemainder = !Array.isArray(engine.aiWildResidualByPlayer)
        || engine.aiWildResidualByPlayer[playerId] !== false;
    const scoringHand = v2 && (v2.useV3Wildcards
        || (v2.useV4WildPlanner && hand.length <= 8)
        || (useWildcardRemainder && hand.length <= 8
            && hand.some(card => isWildLevelCard(card, levelCard))))
        ? hand : searchHand;
    const naturalPlay = chooseStrategicPlay(scoringHand, allCandidates, levelCard, {
        playerId,
        engine,
        phase: 'lead',
        v2
    });

    // 定向识别百搭炸弹/同花顺。只有能显著收短手牌时才主动领出，
    // 避免在开局无意义地暴露强牌。
    // 少剩几张不等于少出几手。非紧急残局若原选择已能留下完整一手，
    // 百搭强牌不能把该路径覆盖成两张互不成组的散牌。必须包含手里的百搭判断。
    const preserveTwoPlayFinish = hand.length <= 8 && !(v2 && v2.urgent)
        && naturalPlay && identifyHand(removePlayedCards(hand, naturalPlay), levelCard).valid;
    const wildPowerLead = findWildcardPowerPlays(hand, levelCard)
        .filter(play => hand.length - play.length <= 2)
        .filter(play => !preserveTwoPlayFinish
            || identifyHand(removePlayedCards(hand, play), levelCard).valid)
        .sort((a, b) => comparePowerPlays(a, b, levelCard))[0];
    if ((!v2 || !v2.useV3Wildcards) && wildPowerLead
        && (!naturalPlay || wildPowerLead.length >= naturalPlay.length + 2)) {
        return wildPowerLead;
    }

    // 残局才主动消耗百搭；有同等效率的自然牌型时仍优先保留百搭。
    if ((!v2 || !v2.useV3Wildcards) && hand.length <= 8) {
        const wildEndgamePlay = findWildcardPlays(hand, levelCard)
            .filter(play => play.length > 1 && hand.length - play.length <= 2)
            .sort((a, b) => compareWildcardPlays(a, b, levelCard))[0];
        const wildHasClearAdvantage = wildEndgamePlay && (
            !naturalPlay
            || wildEndgamePlay.length === hand.length
            || (hand.length - wildEndgamePlay.length <= 1 && wildEndgamePlay.length >= naturalPlay.length + 2)
        );
        if (wildHasClearAdvantage) return wildEndgamePlay;
    }

    if (naturalPlay) return naturalPlay;

    // 7. 出最小单张
    const smallestSingle = [...searchHand].sort((a, b) => {
        return getCardSingleValue(a, levelCard) - getCardSingleValue(b, levelCard);
    })[0];
    return [smallestSingle];
}

/**
 * 跟牌策略
 */
function aiFollowPlay(hand, playerId, engine, teammate) {
    const lastType = engine.lastPlayType;
    const lastPlayerId = engine.lastPlayer;
    const levelCard = engine.levelCard;
    const regularHand = hand.filter(card => !isWildLevelCard(card, levelCard));
    const v2 = buildAIContext(engine, playerId, 'follow');

    // 通常不压队友；v3仅在自己可直接走完，或下家对手只剩1-2张且需要抬高门槛时接管。
    if (lastPlayerId === teammate) {
        if (v2 && v2.useV3Teamplay) {
            const takeover = findTeammateTakeover(hand, lastType, levelCard, v2, {
                playerId,
                engine,
                phase: 'follow',
                v2
            });
            if (takeover) return takeover;
        }
        return null; // 过牌
    }

    // 跟对手时优先整手走完，避免先命中同型候选而拆开最后一手炸弹、
    // 同花顺或四王。保留队友接管规则，并严格检查整手能否压过当前牌。
    const naturalAllType = identifyNaturalHand(hand, levelCard);
    if (naturalAllType.valid && canBeat(naturalAllType, lastType)) return [...hand];
    if (hand.length <= 10 && hand.some(card => isWildLevelCard(card, levelCard))) {
        const wildcardAllType = identifyHand(hand, levelCard);
        if (wildcardAllType.valid && canBeat(wildcardAllType, lastType)) return [...hand];
    }

    // 找能压过的牌（同牌型）
    let sameTypePlays = findAllBeatingPlays(regularHand, lastType, levelCard);

    // 威胁分级：urgent=有对手≤2张（即将出完），moderate=有对手≤4张（进入危险区）
    const opponentThreat = v2 ? v2.urgent : engine.hands.some((cards, id) => {
        return engine.getTeam(id) !== engine.getTeam(playerId) && !engine.playerFinished[id] && cards.length <= 2;
    });
    const lastIsPowerPlay = lastType.type === HAND_TYPES.BOMB
        || lastType.type === HAND_TYPES.STRAIGHT_FLUSH;
    const wildcardPowerPlays = findWildcardPowerPlays(hand, levelCard)
        .filter(play => canBeat(identifyHand(play, levelCard), lastType));

    // 强牌之间按完整规则层级统一比较，不能先尝试同型炸弹再尝试同花顺，
    // 否则会用6炸去压5炸，白白留下本可接牌的同花顺。
    if (lastIsPowerPlay) {
        const rocket = findRocket(hand);
        const powerPlays = dedupeCardPlays([
            ...findAllBombs(regularHand, levelCard),
            ...findAllStraightFlushes(regularHand, levelCard),
            ...wildcardPowerPlays,
            ...(rocket && (hand.length <= 5 || (v2 && v2.urgent)) ? [rocket] : [])
        ]).filter(play => canBeat(identifyHand(play, levelCard), lastType));
        // 强牌互压的短残局，先保住下一手能整手走完的路线；否则固定
        // 出最小炸弹会把五张炸弹拆成四张，平白多留一张散牌。
        const usePowerFinish = !Array.isArray(engine.aiPowerFinishByPlayer)
            || engine.aiPowerFinishByPlayer[playerId] !== false;
        if (usePowerFinish && hand.length <= 10) {
            const onePlayRemainders = powerPlays.filter(play => {
                const remaining = removePlayedCards(hand, play);
                return remaining.length > 0 && identifyHand(remaining, levelCard).valid;
            });
            if (onePlayRemainders.length > 0) {
                onePlayRemainders.sort((a, b) => comparePowerPlays(a, b, levelCard));
                return onePlayRemainders[0];
            }
        }
        powerPlays.sort((a, b) => comparePowerPlays(a, b, levelCard));
        return powerPlays[0] || null;
    }

    // 八张内不仅在“自然牌完全接不住”时找百搭。自然跟牌若拆坏两手
    // 收尾，也要把含百搭的同型候选放进同一轮整手牌评分。
    const useWildFollowCoverage = !Array.isArray(engine.aiWildFollowByPlayer)
        || engine.aiWildFollowByPlayer[playerId] !== false;
    if (useWildFollowCoverage && hand.length <= 8
        && hand.some(card => isWildLevelCard(card, levelCard))) {
        const wildcardEndgamePlays = findWildcardPlays(hand, levelCard, lastType)
            .filter(play => identifyHand(play, levelCard).type === lastType.type);
        sameTypePlays = dedupeCardPlays([...sameTypePlays, ...wildcardEndgamePlays]);
    }

    // 只在残局或对方即将走完时动用百搭压牌；v2在中等威胁且手牌不多时也放宽。
    const wildcardFollowAllowed = v2
        ? (hand.length <= 8 || v2.urgent || (v2.moderate && (hand.length <= 10 || lastIsPowerPlay)))
        : (hand.length <= 8 || opponentThreat);
    // 默认策略在对手即将走完时也必须展开普通百搭模板；否则手牌较多时会
    // 明明能用百搭补对子/三张拦截，却错误过牌。
    if (v2 && (v2.useV3Wildcards || opponentThreat)) {
        const wildcardPatterns = findWildcardPatternPlays(hand, levelCard, lastType)
            .filter(play => identifyHand(play, levelCard).type === lastType.type)
            .filter(play => play.length >= 5 || hand.length <= 10 || v2.moderate);
        sameTypePlays = dedupeCardPlays([...sameTypePlays, ...wildcardPatterns]);
    }
    if (sameTypePlays.length === 0 && wildcardFollowAllowed) {
        const wildNaturalPlays = findAllBeatingPlays(hand, lastType, levelCard)
            .filter(play => play.some(card => isWildLevelCard(card, levelCard)));
        const wildEndgamePlays = hand.length <= 8
            ? findWildcardPlays(hand, levelCard, lastType)
            : [];
        sameTypePlays = [...wildNaturalPlays, ...wildEndgamePlays]
            .filter(play => canBeat(identifyHand(play, levelCard), lastType))
            .filter((play, index, plays) => {
                const key = play.map(card => card.id).sort().join('|');
                return plays.findIndex(candidate => candidate.map(card => card.id).sort().join('|') === key) === index;
            });
    }

    // 大手牌阶段不再做组合穷举，但会定向搜索百搭炸弹和同花顺。
    // 对方出强牌时直接纳入同类跟牌；普通牌则留到下方按炸弹策略决策。
    if (sameTypePlays.length === 0 && (lastIsPowerPlay || hand.length <= 12 || opponentThreat)) {
        sameTypePlays = wildcardPowerPlays.filter(play => {
            return identifyHand(play, levelCard).type === lastType.type;
        });
    }

    if (sameTypePlays.length > 0) {
        // 常规阶段避免为了压一手小牌而拆炸弹；威胁/残局时才放宽。
        if (!opponentThreat && hand.length > 8 && !lastIsPowerPlay) {
            const safePlays = sameTypePlays.filter(play => {
                return calculateStructureDamage(hand, play, levelCard) < 80;
            });
            // 拆组跟牌不可取时仍要继续检查完整炸弹；不能在此提前过牌。
            sameTypePlays = safePlays;
        }

        if (sameTypePlays.length > 0) {
            const smallest = chooseStrategicPlay(hand, sameTypePlays, levelCard, {
                playerId,
                engine,
                phase: 'follow',
                v2
            });
            const smallestType = identifyHand(smallest, levelCard);

            if (v2 && v2.useV4ControlReserve
                && shouldReserveControlSingle(hand, smallest, smallestType, levelCard, v2)) {
                return null;
            }
            if (v2 && v2.useV4PassRollout
                && publicRolloutPrefersPass(hand, smallest, smallestType, levelCard, v2)) {
                return null;
            }

            // 如果手牌很多且上家牌不大，不出炸弹
            if (hand.length > 10 && !opponentThreat
                && smallestType.type === HAND_TYPES.BOMB && lastType.type !== HAND_TYPES.BOMB) {
                // 考虑不出炸弹
                const nonBomb = sameTypePlays.find(p => identifyHand(p, levelCard).type !== HAND_TYPES.BOMB);
                if (nonBomb) return nonBomb;
                // 如果只有炸弹能压，手牌多就不压（中等威胁且持多炸时允许用小炸拦截）
                const allowBomb = v2 && v2.moderate && countPowerPlays(hand, levelCard) >= 2;
                if (hand.length > 15 && !allowBomb) return null;
            }

            return smallest;
        }
    }

    // 同牌型压不过，考虑用炸弹
    if (lastType.type !== HAND_TYPES.ROCKET) {
        const bombs = [
            ...findAllBombs(regularHand, levelCard),
            ...wildcardPowerPlays.filter(play => identifyHand(play, levelCard).type === HAND_TYPES.BOMB)
        ].filter(play => canBeat(identifyHand(play, levelCard), lastType));
        if (bombs.length > 0) {
            // 残局或敌方即将走完时才用炸弹压普通牌；强牌之间允许正常跟牌。
            // 持有多套强牌时放宽阈值（先用小炸），中等威胁且多炸时主动拦截。
            const powerCount = v2 ? countPowerPlays(hand, levelCard) : 0;
            const bombThreshold = v2 && powerCount >= 2 ? 14 : 10;
            const allowTwoPlayPower = !Array.isArray(engine.aiTwoPlayPowerByPlayer)
                || engine.aiTwoPlayPowerByPlayer[playerId] !== false;
            const finishingBombs = allowTwoPlayPower && hand.length > 10 && hand.length <= 15
                ? bombs.filter(play => {
                    const remaining = removePlayedCards(hand, play);
                    return remaining.length > 0 && identifyHand(remaining, levelCard).valid;
                }) : [];
            const normallyBombs = v2
                ? (hand.length <= bombThreshold || v2.urgent || lastIsPowerPlay
                    || (v2.moderate && powerCount >= 2)
                    || (v2.useV4BombInitiative && powerCount >= 2
                        && hand.length <= v2.bombInitiativeHandLimit))
                : (hand.length <= 10 || opponentThreat || lastIsPowerPlay);
            if (normallyBombs || finishingBombs.length > 0) {
                const choices = normallyBombs ? bombs : finishingBombs;
                choices.sort((a, b) => comparePowerPlays(a, b, levelCard));
                return choices[0];
            }
        }
    }

    // 同花顺
    if (lastType.type !== HAND_TYPES.ROCKET) {
        const flushes = [
            ...findAllStraightFlushes(regularHand, levelCard),
            ...wildcardPowerPlays.filter(play => identifyHand(play, levelCard).type === HAND_TYPES.STRAIGHT_FLUSH)
        ].filter(play => canBeat(identifyHand(play, levelCard), lastType));
        if (flushes.length > 0 && (hand.length <= 10 || opponentThreat || lastIsPowerPlay
            || (v2 && v2.moderate && countPowerPlays(hand, levelCard) >= 2)
            || (v2 && v2.useV4BombInitiative && countPowerPlays(hand, levelCard) >= 2
                && hand.length <= v2.bombInitiativeHandLimit))) {
            flushes.sort((a, b) => comparePowerPlays(a, b, levelCard));
            return flushes[0];
        }
    }

    // 火箭：残局必出；对手即将出完时也果断镇压，夺回出牌权后顶大控场。
    if (lastType.type !== HAND_TYPES.ROCKET) {
        const rocket = findRocket(hand);
        if (rocket && (hand.length <= 5 || (v2 && v2.urgent))) {
            return rocket;
        }
    }

    return null; // 过牌
}

/**
 * 非紧急中盘不要用唯一的A/级牌/小王去做一次大概率守不住的跟单。
 * 大王等已封顶单张、两手内能收完、对手进入危险区时仍正常接牌。
 */
function shouldReserveControlSingle(hand, play, type, levelCard, v2) {
    if (type.type !== HAND_TYPES.SINGLE || v2.engine.playerFinished[v2.engine.lastPlayer]) {
        return false;
    }
    const isWide = v2.strategyMode === 'v4-control-reserve-wide';
    const isHighOnly = v2.strategyMode === 'v4-control-reserve-high';
    const isBudget = v2.strategyMode === 'v4-control-budget';
    const minimumHand = isWide || isBudget ? 8 : 10;
    const minimumOpponent = isWide || isBudget ? 4 : 6;
    if (hand.length <= minimumHand || v2.minOpp <= minimumOpponent) return false;

    const value = getCardSingleValue(play[0], levelCard);
    if (value < (isHighOnly ? 199 : 14)) return false;
    if (countUnseenHigherSingles(v2.unseen, value, levelCard) < 2) return false;

    const remaining = removePlayedCards(hand, play);
    if (createTurnEstimator(levelCard)(remaining) <= 2) return false;
    if (isBudget) {
        const hasOtherControl = remaining.some(card => getCardSingleValue(card, levelCard) >= 14)
            || countPowerPlays(remaining, levelCard) > 0;
        if (hasOtherControl || calculateLowSingletonLiability(remaining, levelCard) <= 0) return false;
    }
    return true;
}

// ==================== 牌型搜索函数 ====================

/**
 * 查找所有能压过上家的同牌型牌
 */
function findAllBeatingPlays(hand, lastType, levelCard) {
    const results = [];

    switch (lastType.type) {
        case HAND_TYPES.SINGLE:
            results.push(...findSingles(hand, lastType.value, levelCard));
            break;
        case HAND_TYPES.PAIR:
            results.push(...findPairs(hand, lastType.value, levelCard));
            break;
        case HAND_TYPES.TRIPLE:
            results.push(...findTriples(hand, lastType.value, levelCard));
            break;
        case HAND_TYPES.TRIPLE_PAIR:
            results.push(...findTriplePairs(hand, lastType.value, levelCard));
            break;
        case HAND_TYPES.STRAIGHT:
            results.push(...findStraights(hand, lastType.value, lastType.length, levelCard));
            break;
        case HAND_TYPES.DOUBLE_STRAIGHT:
            results.push(...findDoubleStraights(hand, lastType.value, lastType.length, levelCard));
            break;
        case HAND_TYPES.TRIPLE_STRAIGHT:
            results.push(...findPlanes(hand, lastType, levelCard));
            break;
        case HAND_TYPES.BOMB:
            results.push(...findBiggerBombs(hand, lastType, levelCard));
            break;
        case HAND_TYPES.STRAIGHT_FLUSH:
            results.push(...findBiggerStraightFlushes(hand, lastType, levelCard));
            break;
    }

    return results;
}

/**
 * 找大于指定值的单张
 * 单张比较：大王(201) > 小王(200) > 级牌(199) > A(14) > K(13) > ... > 2(2)
 */
function findSingles(hand, minValue, levelCard) {
    const results = [];
    const seenValues = new Set();
    
    for (let card of hand) {
        // 计算单张比较值（使用统一函数）
        let cardValue = getCardSingleValue(card, levelCard);
        
        if (cardValue > minValue && (AI_SINGLE_COVERAGE_ENABLED || !seenValues.has(cardValue))) {
            results.push([card]);
            seenValues.add(cardValue);
        }
    }
    return results;
}

/**
 * 找大于指定值的对子
 */
function findPairs(hand, minValue, levelCard) {
    const results = [];
    const rankGroups = groupByRank(hand);

    for (let rank in rankGroups) {
        if (rankGroups[rank].length >= 2) {
            for (const pair of buildStructuralCardVariants(rankGroups, [[rank, 2]])) {
                const type = identifyHand(pair, levelCard);
                if (type.type === HAND_TYPES.PAIR && type.value > minValue) {
                    results.push(pair);
                }
            }
        }
    }
    return dedupeCardPlays(results);
}

/**
 * 找大于指定值的三张
 */
function findTriples(hand, minValue, levelCard) {
    const results = [];
    const rankGroups = groupByRank(hand);

    for (let rank in rankGroups) {
        if (rankGroups[rank].length >= 3) {
            for (const triple of buildStructuralCardVariants(rankGroups, [[rank, 3]])) {
                const type = identifyHand(triple, levelCard);
                if (type.type === HAND_TYPES.TRIPLE && type.value > minValue) {
                    results.push(triple);
                }
            }
        }
    }
    return dedupeCardPlays(results);
}

/**
 * 找三带二
 */
function findTriplePairs(hand, minValue, levelCard) {
    const results = [];
    const rankGroups = groupByRank(hand);

    const tripleRanks = [];
    const pairRanks = [];

    for (let rank in rankGroups) {
        if (rankGroups[rank].length >= 3) tripleRanks.push(rank);
        if (rankGroups[rank].length >= 2) pairRanks.push(rank);
    }

    for (let tRank of tripleRanks) {
        for (let pRank of pairRanks) {
            if (pRank === tRank) continue;
            for (const combo of buildStructuralCardVariants(rankGroups, [[tRank, 3], [pRank, 2]])) {
                const type = identifyHand(combo, levelCard);
                if (type.type === HAND_TYPES.TRIPLE_PAIR && type.value > minValue) {
                    results.push(combo);
                }
            }
        }
    }
    return dedupeCardPlays(results);
}

/**
 * 找顺子
 */
function findStraights(hand, minValue, length, levelCard) {
    const results = [];
    if (length !== 5) return results;
    const rankGroups = groupByRank(hand);
    for (const ranks of getStraightRankSequences()) {
        if (!ranks.every(rank => rankGroups[rank] && rankGroups[rank].some(card => !card.isJoker))) continue;
        for (const cards of buildStructuralCardVariants(rankGroups, ranks.map(rank => [rank, 1]))) {
            const type = identifyHand(cards, levelCard);
            if (type.type === HAND_TYPES.STRAIGHT && type.value > minValue) {
                results.push(cards);
            }
        }
    }
    return dedupeCardPlays(results);
}

/**
 * 找双顺
 */
function findDoubleStraights(hand, minValue, length, levelCard) {
    const results = [];
    const rankGroups = groupByRank(hand);
    const pairRanks = Object.keys(rankGroups)
        .filter(r => rankGroups[r].length >= 2 && RANK_VALUE[r])
        .map(r => RANK_VALUE[r])
        .sort((a, b) => a - b);

    const pairCount = length / 2;

    for (let startIdx = 0; startIdx <= pairRanks.length - pairCount; startIdx++) {
        let valid = true;
        const requirements = [];
        for (let i = 0; i < pairCount; i++) {
            if (i > 0 && pairRanks[startIdx + i] - pairRanks[startIdx + i - 1] !== 1) { valid = false; break; }
            const rank = RANKS[pairRanks[startIdx + i] - 2];
            requirements.push([rank, 2]);
        }
        if (!valid) continue;
        for (const cards of buildStructuralCardVariants(rankGroups, requirements)) {
            const type = identifyHand(cards, levelCard);
            if (type.type === HAND_TYPES.DOUBLE_STRAIGHT && type.value > minValue) {
                results.push(cards);
            }
        }
    }
    return dedupeCardPlays(results);
}

/**
 * 找飞机
 */
function findPlanes(hand, lastType, levelCard) {
    const results = [];
    const rankGroups = groupByRank(hand);
    const tripleRanks = Object.keys(rankGroups)
        .filter(r => rankGroups[r].length >= 3)
        .map(r => RANK_VALUE[r])
        .sort((a, b) => a - b);

    const tripleCount = lastType.type === HAND_TYPES.PLANE_SINGLE
        ? lastType.length / 4
        : lastType.type === HAND_TYPES.PLANE_PAIR
            ? lastType.length / 5
            : lastType.length / 3;

    for (let startIdx = 0; startIdx <= tripleRanks.length - tripleCount; startIdx++) {
        let valid = true;
        for (let i = 1; i < tripleCount; i++) {
            if (tripleRanks[startIdx + i] - tripleRanks[startIdx + i - 1] !== 1) {
                valid = false;
                break;
            }
        }
        if (!valid) continue;

        const baseValue = tripleRanks[startIdx + tripleCount - 1];
        if (baseValue <= lastType.value) continue;

        const cards = [];
        const tripleRankNames = [];
        for (let i = 0; i < tripleCount; i++) {
            const rank = RANKS[tripleRanks[startIdx + i] - 2];
            tripleRankNames.push(rank);
            cards.push(...rankGroups[rank].slice(0, 3));
        }

        if (lastType.type === HAND_TYPES.PLANE_SINGLE) {
            const wings = Object.keys(rankGroups)
                .filter(rank => !tripleRankNames.includes(rank) && RANK_VALUE[rank])
                .map(rank => rankGroups[rank].find(card => !card.isJoker))
                .filter(Boolean)
                .slice(0, tripleCount);
            if (wings.length === tripleCount) cards.push(...wings);
        } else if (lastType.type === HAND_TYPES.PLANE_PAIR) {
            const wings = Object.keys(rankGroups)
                .filter(rank => !tripleRankNames.includes(rank) && RANK_VALUE[rank] && rankGroups[rank].length >= 2)
                .slice(0, tripleCount)
                .flatMap(rank => rankGroups[rank].slice(0, 2));
            if (wings.length === tripleCount * 2) cards.push(...wings);
        }

        const type = identifyHand(cards, levelCard);
        if (type.type === lastType.type && type.length === lastType.length && canBeat(type, lastType)) {
            results.push(cards);
        }
    }
    return results;
}

/**
 * 找最大的顺子（自由出牌用）
 */
function findBestStraight(hand, levelCard) {
    const rankGroups = groupByRank(hand);
    for (const ranks of getStraightRankSequences()) {
        if (!ranks.every(rank => rankGroups[rank] && rankGroups[rank].some(card => !card.isJoker))) continue;
        const cards = ranks.map(rank => rankGroups[rank].find(card => !card.isJoker));
        if (identifyHand(cards, levelCard).type === HAND_TYPES.STRAIGHT) return cards;
    }
    return null;
}

/**
 * 找最佳双顺（自由出牌用）
 */
function findBestDoubleStraight(hand, levelCard) {
    const rankGroups = groupByRank(hand);
    const pairRanks = Object.keys(rankGroups)
        .filter(r => rankGroups[r].length >= 2 && RANK_VALUE[r])
        .map(r => RANK_VALUE[r])
        .sort((a, b) => a - b);

    // 找最小的3对连续
    for (let startIdx = 0; startIdx <= pairRanks.length - 3; startIdx++) {
        if (pairRanks[startIdx + 1] - pairRanks[startIdx] === 1 &&
            pairRanks[startIdx + 2] - pairRanks[startIdx + 1] === 1) {
            const cards = [];
            for (let i = 0; i < 3; i++) {
                const rank = RANKS[pairRanks[startIdx + i] - 2];
                cards.push(rankGroups[rank][0], rankGroups[rank][1]);
            }
            const type = identifyHand(cards, levelCard);
            if (type.type === HAND_TYPES.DOUBLE_STRAIGHT) return cards;
        }
    }
    return null;
}

/**
 * 找最佳飞机（自由出牌用）
 */
function findBestPlane(hand, levelCard) {
    const rankGroups = groupByRank(hand);
    const tripleRanks = Object.keys(rankGroups)
        .filter(r => rankGroups[r].length >= 3)
        .map(r => RANK_VALUE[r])
        .sort((a, b) => a - b);

    // 找最小的2个连续三张
    for (let startIdx = 0; startIdx <= tripleRanks.length - 2; startIdx++) {
        if (tripleRanks[startIdx + 1] - tripleRanks[startIdx] === 1) {
            const cards = [];
            for (let i = 0; i < 2; i++) {
                const rank = RANKS[tripleRanks[startIdx + i] - 2];
                cards.push(...rankGroups[rank].slice(0, 3));
            }
            const type = identifyHand(cards, levelCard);
            if (type.type === HAND_TYPES.TRIPLE_STRAIGHT) return cards;
        }
    }
    return null;
}

/**
 * 找最佳三带二（自由出牌用）
 */
function findBestTriplePair(hand, levelCard) {
    const rankGroups = groupByRank(hand);
    const tripleRanks = Object.keys(rankGroups)
        .filter(r => rankGroups[r].length >= 3)
        .map(r => RANK_VALUE[r])
        .sort((a, b) => a - b);

    const pairRanks = Object.keys(rankGroups)
        .filter(r => rankGroups[r].length >= 2 && RANK_VALUE[r])
        .map(r => RANK_VALUE[r])
        .sort((a, b) => a - b);

    for (let tVal of tripleRanks) {
        const tRank = RANKS[tVal - 2];
        for (let pVal of pairRanks) {
            if (pVal === tVal) continue;
            const pRank = RANKS[pVal - 2];
            const combo = [...rankGroups[tRank].slice(0, 3), ...rankGroups[pRank].slice(0, 2)];
            const type = identifyHand(combo, levelCard);
            if (type.type === HAND_TYPES.TRIPLE_PAIR) return combo;
        }
    }
    return null;
}

/**
 * 找最佳三张（自由出牌用）
 */
function findBestTriple(hand, levelCard) {
    const rankGroups = groupByRank(hand);
    const tripleRanks = Object.keys(rankGroups)
        .filter(r => rankGroups[r].length >= 3)
        .map(r => RANK_VALUE[r])
        .sort((a, b) => a - b);

    for (let tVal of tripleRanks) {
        const tRank = RANKS[tVal - 2];
        const triple = rankGroups[tRank].slice(0, 3);
        const type = identifyHand(triple, levelCard);
        if (type.type === HAND_TYPES.TRIPLE) return triple;
    }
    return null;
}

/**
 * 找最佳对子（自由出牌用）
 */
function findBestPair(hand, levelCard) {
    const rankGroups = groupByRank(hand);
    const pairs = Object.keys(rankGroups)
        .filter(rank => rankGroups[rank].length >= 2)
        .map(rank => rankGroups[rank].slice(0, 2))
        .filter(pair => identifyHand(pair, levelCard).type === HAND_TYPES.PAIR)
        .sort((a, b) => identifyHand(a, levelCard).value - identifyHand(b, levelCard).value);
    return pairs[0] || null;
}

/** 生成自由出牌候选。把自然炸弹、同花顺和四王也纳入统一比较，避免动作盲区。 */
function findLeadCandidates(hand, levelCard) {
    const planeTarget = {
        type: HAND_TYPES.TRIPLE_STRAIGHT,
        value: 0,
        length: 6,
        valid: true
    };
    return dedupeCardPlays([
        ...findStraights(hand, -Infinity, 5, levelCard),
        ...findDoubleStraights(hand, -Infinity, 6, levelCard),
        ...findPlanes(hand, planeTarget, levelCard),
        ...findTriplePairs(hand, -Infinity, levelCard),
        ...findTriples(hand, -Infinity, levelCard),
        ...findPairs(hand, -Infinity, levelCard),
        ...findSingles(hand, -Infinity, levelCard),
        ...findAllBombs(hand, levelCard),
        ...findAllStraightFlushes(hand, levelCard),
        ...(findRocket(hand) ? [findRocket(hand)] : [])
    ]).filter(play => identifyHand(play, levelCard).valid);
}

/**
 * 用整手牌视角选择候选：剩余手数优先，其次避免拆炸弹/三张/对子，
 * 最后才比较当前出牌大小。
 */
function chooseStrategicPlay(hand, candidates, levelCard, context = null) {
    if (!Array.isArray(candidates) || candidates.length === 0) return null;
    const useWildcardPlanner = Boolean(context && context.v2
        && context.v2.useV4WildPlanner && hand.length <= 8);
    const planner = createTurnEstimator(levelCard, {
        resetBudgetPerHand: useWildcardPlanner,
        wildcardAware: useWildcardPlanner
    });
    const learnedChoice = chooseLearnedPolicyPlay(hand, candidates, levelCard, planner, context);
    const choice = learnedChoice || [...candidates].sort((a, b) => {
        const scoreA = scoreStrategicPlay(hand, a, levelCard, planner, context);
        const scoreB = scoreStrategicPlay(hand, b, levelCard, planner, context);
        return scoreA - scoreB;
    })[0];
    // 模型回退时也执行相同的单张保护，避免两套出牌顺序（对齐 G 盘 2026-10-18 修正）。
    const singleChoice = refineLearnedSingleChoice(
        hand, choice, candidates, levelCard, planner, context
    );
    return refineOrdinaryControlOrder(hand, singleChoice, candidates, levelCard, planner, context);
}

/**
 * 学习模型负责判断“这一手是否应该出单张”，规则搜索负责挑选具体单张。
 * 这样既保留真人策略的牌型选择，又不会因小样本偏差先打掉A/2、把3/4留到残局。
 * 对手报单等紧急局面已包含在 scoreStrategicPlay 中，因此仍会自动改用大单张封堵。
 */
function refineLearnedSingleChoice(hand, learnedChoice, candidates, levelCard, planner, context) {
    const learnedType = identifyHand(learnedChoice, levelCard);
    if (!learnedType.valid || learnedType.type !== HAND_TYPES.SINGLE) return learnedChoice;

    const singles = candidates.filter(play => {
        const type = identifyHand(play, levelCard);
        return type.valid && type.type === HAND_TYPES.SINGLE;
    });
    if (singles.length < 2) return learnedChoice;

    const v2 = context && context.v2;
    // 真人牌谱显示：普通中前盘会为了清掉小单张适度拆对子/三张，同时保留王、
    // 级牌和 A 作为重新取得牌权的控制张。旧评分把“绝不拆组”放得过重，导致
    // 宁可先出王/级牌、把小牌留到最后。残局或任一对手报双以内时仍沿用完整
    // 战术评分，确保封堵优先，不机械地出最小牌。
    const useDisposalPriority = hand.length > 5 && !(v2 && v2.urgent)
        && (!v2 || v2.useSingleDisposal !== false);
    const strategicSingles = singles.map(play => ({
        play,
        score: scoreStrategicPlay(hand, play, levelCard, planner, context)
    }));
    const orderedSingles = [...strategicSingles].sort((a, b) => {
        const scoreDiff = (useDisposalPriority
            ? scoreSingleDisposal(a.play) - scoreSingleDisposal(b.play)
            : a.score - b.score);
        if (Math.abs(scoreDiff) > 1e-9) return scoreDiff;
        return getCardSingleValue(a.play[0], levelCard)
            - getCardSingleValue(b.play[0], levelCard);
    });
    let selected = orderedSingles[0].play;
    if (useDisposalPriority && breaksNaturalStraight(selected)) {
        const selectedTurns = planner(removePlayedCards(hand, selected));
        const safeLow = orderedSingles.find(item => (
            getCardSingleValue(item.play[0], levelCard) <= 10
            && planner(removePlayedCards(hand, item.play)) < selectedTurns
        ));
        if (safeLow) selected = safeLow.play;
    }
    // 残局不平白加手；中盘仅保护已有两手路线被拆成至少四手的明确失误。
    if (useDisposalPriority) {
        const selectedTurns = planner(removePlayedCards(hand, selected));
        const learnedTurns = planner(removePlayedCards(hand, learnedChoice));
        if ((hand.length <= 8 && selectedTurns > learnedTurns)
            || (hand.length > 8 && learnedTurns <= 2 && selectedTurns >= learnedTurns + 2)) {
            return learnedChoice;
        }
    }
    return selected;

    function breaksNaturalStraight(play) {
        const card = play[0];
        if (card.isJoker || isWildLevelCard(card, levelCard)) return false;
        const sameRank = hand.filter(item => !item.isJoker && item.rank === card.rank);
        if (sameRank.length !== 1) return false;
        const natural = hand.filter(item => !item.isJoker
            && !isWildLevelCard(item, levelCard));
        return findStraights(natural, -Infinity, 5, levelCard)
            .some(straight => straight.some(item => item.id === card.id));
    }

    function scoreSingleDisposal(play) {
        const card = play[0];
        const value = getCardSingleValue(card, levelCard);
        const rankCount = card.isJoker ? 1 : hand.filter(item => (
            !item.isJoker && item.rank === card.rank
        )).length;
        const splitCost = rankCount >= 4 ? 500 : rankCount === 3 ? 100
            : rankCount === 2 ? 40 : 0;
        const controlReserveCost = card.isJoker
            ? (card.rank === JOKER_BIG ? 800 : 700)
            : value >= 199 ? 600
                : value === 14 ? 140 : value === 13 ? 90
                    : value === 12 ? 55 : value === 11 ? 30 : 0;
        const damage = calculateStructureDamage(hand, play, levelCard);
        const powerStructureCost = Math.max(0, damage - 25) * 8;
        const remaining = removePlayedCards(hand, play);
        return Math.min(value, 14) + splitCost + controlReserveCost
            + calculateLowSingletonLiability(remaining, levelCard) * 0.5
            + powerStructureCost;
    }
}

/** 同型同手数且不多拆组合时，先清小组合，把大组合留作后续接手。
 * 移植自 G 盘 2026-10-18 control-order 修正：原评分中控制牌消耗仅为
 * type.value / 1000，而同档候选可在评分相差 20 分内被模型重排，导致
 * 同等路线先出 55/66/77 而留下 44。此处只在同牌型、同张数、不增加预计
 * 剩余手数、不增加组合损伤且原评分不高出 20 分的较弱候选间调整。
 * G盘默认开启，可用 controlOrderByPlayer 逐座位关闭；
 * 对手剩 4 张以内（moderate）沿用原有威胁策略不调整。
 */
function refineOrdinaryControlOrder(hand, choice, candidates, levelCard, planner, context) {
    const v2 = context && context.v2;
    const chosenType = identifyHand(choice, levelCard);
    if (!v2 || !v2.useControlOrder || v2.moderate || choice.length === hand.length
        || !chosenType.valid
        || chosenType.type === HAND_TYPES.BOMB || chosenType.type === HAND_TYPES.STRAIGHT_FLUSH
        || chosenType.type === HAND_TYPES.ROCKET) return choice;
    if (chosenType.type === HAND_TYPES.SINGLE) {
        if (!v2.useSingleDisposal) return choice;
        // 已封顶单张接整手收尾是一条控牌路线，应先拿住牌权。
        const remaining = removePlayedCards(hand, choice);
        if (v2.useControlFinish && v2.phase === 'lead' && hand.length <= 5
            && identifyHand(remaining, levelCard).valid
            && !hasUnseenHigherSingle(v2.unseen, chosenType.value, levelCard)) return choice;
    }

    const chosenTurns = planner(removePlayedCards(hand, choice));
    const chosenDamage = calculateStructureDamage(hand, choice, levelCard);
    const chosenScore = scoreStrategicPlay(hand, choice, levelCard, planner, context);
    const controlCost = play => play.reduce((sum, card) => (
        sum + getCardSingleValue(card, levelCard)
    ), 0);
    let best = choice;
    let bestValue = chosenType.value;
    let bestControlCost = controlCost(choice);
    for (const play of candidates) {
        if (play.length !== choice.length) continue;
        const type = identifyHand(play, levelCard);
        if (!type.valid || type.type !== chosenType.type || type.value > bestValue) continue;
        const cost = controlCost(play);
        if (type.value === bestValue && cost >= bestControlCost) continue;
        // 保持原模型的20分同档边界；不牺牲短路线、同花顺或炸弹来清小牌。
        if (calculateStructureDamage(hand, play, levelCard) > chosenDamage
            || planner(removePlayedCards(hand, play)) > chosenTurns
            || scoreStrategicPlay(hand, play, levelCard, planner, context) > chosenScore + 20) continue;
        best = play;
        bestValue = type.value;
        bestControlCost = cost;
    }
    return best;
}

/**
 * 已训练策略只做合法候选排序。模型缺失、版本不匹配或输出异常时立即回退启发式。
 * 训练/对照评测可在 engine.aiPolicyMode 中显式指定 learned 或 legacy。
 */
function chooseLearnedPolicyPlay(hand, candidates, levelCard, planner, context) {
    if (typeof GUANDAN_POLICY === 'undefined' || !GUANDAN_POLICY
        || typeof predictGuandanPolicy !== 'function') return null;
    const engine = context && context.engine;
    const playerId = context && context.playerId;
    const mode = engine && Array.isArray(engine.aiPolicyByPlayer) && Number.isInteger(playerId)
        ? engine.aiPolicyByPlayer[playerId]
        : engine && engine.aiPolicyMode ? engine.aiPolicyMode : 'learned';
    if (mode === 'legacy') return null;
    if (context && context.phase === 'follow'
        && context.v2 && context.v2.useV4LeadOnlyPolicy) return null;
    let policy = mode === 'candidate' && typeof GUANDAN_POLICY_CANDIDATE !== 'undefined'
        ? GUANDAN_POLICY_CANDIDATE
        : mode === 'human' && typeof GUANDAN_POLICY_HUMAN !== 'undefined'
            ? GUANDAN_POLICY_HUMAN : GUANDAN_POLICY;
    // 分阶段策略只接管已针对该阶段训练和验收的决策；另一阶段继续使用稳定基线。
    if (policy.applyPhase && context && policy.applyPhase !== context.phase) {
        policy = policy.fallbackPolicy || GUANDAN_POLICY;
    }

    const ranked = candidates.map(play => ({
        play,
        legacyScore: scoreStrategicPlay(hand, play, levelCard, planner, context)
    })).sort((a, b) => a.legacyScore - b.legacyScore);
    // 训练模型只在启发式同档（通常是相同剩余手数）的候选间做残差重排。
    // 这道安全门避免小数据模型推翻已经被搜索明确证明更优的方案。
    const requestedMargin = engine && Array.isArray(engine.aiPolicyMarginByPlayer)
        && Number.isInteger(playerId) ? engine.aiPolicyMarginByPlayer[playerId] : null;
    const shortlistMargin = Number.isFinite(requestedMargin) && requestedMargin >= 0
        ? requestedMargin : 20;
    const shortlist = ranked.filter(item => item.legacyScore
        <= ranked[0].legacyScore + shortlistMargin);
    if (shortlist.length < 2) return ranked[0].play;

    const stats = AI_POLICY_STATS[mode];
    if (stats) stats.eligible++;

    let best = null;
    let bestValue = -Infinity;
    for (const { play } of shortlist) {
        const featureContext = context
            ? { ...context, featureVersion: policy.featureVersion }
            : { featureVersion: policy.featureVersion };
        const features = encodeGuandanPolicyFeatures(hand, play, levelCard, planner, featureContext);
        let value = predictGuandanPolicy(features, policy);
        const v2 = context && context.v2;
        if (v2 && v2.humanOpponentProfile && v2.nextOpponentId === 0
            && typeof estimateHumanChoiceSignal === 'function') {
            const choiceSignal = estimateHumanChoiceSignal(
                v2.humanOpponentProfile, hand, play, levelCard, context.phase
            );
            const choiceScale = Number.isFinite(v2.humanChoiceScale)
                ? v2.humanChoiceScale : 0.35;
            value += choiceSignal.preference * choiceSignal.confidence
                * choiceScale * (v2.humanAdaptationWeight / 400);
        }
        if (v2 && v2.phase === 'lead' && v2.nextOpponentId === 0
            && v2.humanOpponentCount <= v2.humanProfileLeadMaxCount
            && v2.humanOpponentProfile
            && typeof estimateHumanPassSignal === 'function') {
            const type = identifyHand(play, levelCard);
            const signal = estimateHumanPassSignal(
                v2.humanOpponentProfile, type.type, type.value, v2.humanOpponentCount
            );
            value += (signal.passRate - 0.5) * signal.confidence
                * (v2.humanAdaptationWeight / 400);
        }
        if (!Number.isFinite(value)) {
            if (stats) stats.fallback++;
            return null;
        }
        if (value > bestValue) {
            bestValue = value;
            best = play;
        }
    }
    if (stats) stats.used++;
    return best;
}

/**
 * 把两副牌折叠成54种可见牌面计数。相同花色点数的两张实体牌策略等价，
 * 但不同花色必须保留，模型才能识别候选是否拆掉潜在同花顺。
 */
function encodePhysicalCardCounts(cards) {
    const counts = Array(RANKS.length * SUITS.length + 2).fill(0);
    for (const card of cards) {
        let index;
        if (card.isJoker) {
            index = RANKS.length * SUITS.length + (card.rank === JOKER_BIG ? 1 : 0);
        } else {
            const rankIndex = RANKS.indexOf(card.rank);
            const suitIndex = SUITS.indexOf(card.suit);
            if (rankIndex < 0 || suitIndex < 0) continue;
            index = rankIndex * SUITS.length + suitIndex;
        }
        counts[index] += 0.5;
    }
    return counts;
}

/** v1为28维、v2为36维、v3为144维；均只含当前玩家可见信息。 */
function encodeGuandanPolicyFeatures(hand, play, levelCard, planner, context = null) {
    const remaining = removePlayedCards(hand, play);
    const type = identifyHand(play, levelCard);
    const groups = groupByRank(remaining.filter(card => !card.isJoker));
    const counts = Object.values(groups).map(cards => cards.length);
    const engine = context && context.engine;
    const playerId = context && context.playerId;
    const hasSeatContext = engine && Array.isArray(engine.hands)
        && typeof engine.getTeammate === 'function' && typeof engine.getTeam === 'function'
        && Number.isInteger(playerId);
    const teammate = hasSeatContext ? engine.getTeammate(playerId) : -1;
    const opponents = hasSeatContext
        ? engine.hands.filter((cards, id) => engine.getTeam(id) !== engine.getTeam(playerId))
        : [];
    const typeOrder = [
        HAND_TYPES.SINGLE, HAND_TYPES.PAIR, HAND_TYPES.TRIPLE, HAND_TYPES.TRIPLE_PAIR,
        HAND_TYPES.STRAIGHT, HAND_TYPES.DOUBLE_STRAIGHT, HAND_TYPES.TRIPLE_STRAIGHT,
        HAND_TYPES.BOMB, HAND_TYPES.STRAIGHT_FLUSH, HAND_TYPES.ROCKET
    ];
    const typeOneHot = typeOrder.map(candidate => candidate === type.type ? 1 : 0);
    const features = [
        hand.length / 27,
        remaining.length / 27,
        play.length / 8,
        Math.min(planner(remaining), 16) / 16,
        Math.min(calculateStructureDamage(hand, play, levelCard), 200) / 200,
        play.filter(card => isWildLevelCard(card, levelCard)).length / 2,
        Math.min(type.value || 0, 201) / 201,
        counts.filter(count => count === 1).length / 13,
        counts.filter(count => count === 2).length / 13,
        counts.filter(count => count === 3).length / 13,
        counts.filter(count => count >= 4).length / 4,
        remaining.filter(card => getCardSingleValue(card, levelCard) >= 14).length / 8,
        context && context.phase === 'follow' ? 1 : 0,
        engine && engine.lastPlayer === teammate ? 1 : 0,
        opponents.some(cards => cards.length <= 2) ? 1 : 0,
        hasSeatContext && teammate >= 0 && engine.hands[teammate].length <= 2 ? 1 : 0,
        engine ? Math.min(engine.passCount || 0, 3) / 3 : 0,
        hasSeatContext ? engine.hands[(playerId + 1) % 4].length / 27 : 1,
        ...typeOneHot
    ];
    const featureVersion = context && context.featureVersion;
    if (featureVersion !== 'gd-candidate-v2' && featureVersion !== 'gd-candidate-v3') {
        return features;
    }

    const aiContext = context.v2 || (hasSeatContext
        ? buildAIContext(engine, playerId, context.phase || 'lead')
        : null);
    const singleBeatProbability = aiContext && aiContext.unseen
        && type.type === HAND_TYPES.SINGLE
        ? estimateSeatSingleBeatProbability(
            aiContext.unseen,
            type.value,
            levelCard,
            aiContext.nextOppCount,
            aiContext.nextOpponentPasses
        )
        : 0;
    const passEvidence = aiContext && Array.isArray(aiContext.nextOpponentPasses)
        ? aiContext.nextOpponentPasses.some(entry => (
        entry.against === type.type
        && entry.length === type.length
        && entry.value <= type.value
    )) : false;
    features.push(
        aiContext && Number.isFinite(aiContext.minOpp) ? Math.min(aiContext.minOpp, 27) / 27 : 1,
        aiContext && Number.isFinite(aiContext.nextOppCount) ? Math.min(aiContext.nextOppCount, 27) / 27 : 1,
        aiContext && Number.isFinite(aiContext.teammateCount) ? Math.min(aiContext.teammateCount, 27) / 27 : 1,
        singleBeatProbability,
        passEvidence ? 1 : 0,
        aiContext && Array.isArray(aiContext.oppPassTypes)
            ? Math.min(aiContext.oppPassTypes.filter(item => item === type.type).length, 4) / 4 : 0,
        Math.min(calculateLowSingletonLiability(remaining, levelCard), 240) / 240,
        Math.min(countPowerPlays(remaining, levelCard), 4) / 4
    );
    if (featureVersion === 'gd-candidate-v3') {
        features.push(
            ...encodePhysicalCardCounts(play),
            ...encodePhysicalCardCounts(remaining)
        );
    }
    return features;
}

/**
 * “跟牌还是过牌”模型的公开信息特征。前36维沿用候选模型v2，附加当前牌墩、
 * 出牌前后结构变化和控制张信息；不读取其他玩家的具体手牌。
 */
function encodeGuandanPassFeatures(hand, play, levelCard, planner, context) {
    const remaining = removePlayedCards(hand, play);
    const type = identifyHand(play, levelCard);
    const engine = context && context.engine;
    const playerId = context && context.playerId;
    const v2 = context && (context.v2 || (engine && Number.isInteger(playerId)
        ? buildAIContext(engine, playerId, 'follow') : null));
    const beforeTurns = planner(hand);
    const afterTurns = planner(remaining);
    const beforeLiability = calculateLowSingletonLiability(hand, levelCard);
    const afterLiability = calculateLowSingletonLiability(remaining, levelCard);
    const lastType = engine && engine.lastPlayType ? engine.lastPlayType : {};
    const typeOrder = [
        HAND_TYPES.SINGLE, HAND_TYPES.PAIR, HAND_TYPES.TRIPLE, HAND_TYPES.TRIPLE_PAIR,
        HAND_TYPES.STRAIGHT, HAND_TYPES.DOUBLE_STRAIGHT, HAND_TYPES.TRIPLE_STRAIGHT,
        HAND_TYPES.BOMB, HAND_TYPES.STRAIGHT_FLUSH, HAND_TYPES.ROCKET
    ];
    const unseenHigher = v2 && type.type === HAND_TYPES.SINGLE
        ? countUnseenHigherSingles(v2.unseen, type.value, levelCard) : 0;
    const leader = engine && Number.isInteger(engine.lastPlayer) ? engine.lastPlayer : -1;
    const leaderCount = leader >= 0 && Array.isArray(engine.hands[leader])
        ? engine.hands[leader].length : 27;

    return [
        ...encodeGuandanPolicyFeatures(hand, play, levelCard, planner, {
            ...context,
            featureVersion: 'gd-candidate-v2'
        }),
        Math.min(beforeTurns, 16) / 16,
        Math.max(-1, Math.min(1, (beforeTurns - afterTurns) / 8)),
        Math.min(beforeLiability, 240) / 240,
        Math.max(-1, Math.min(1, (beforeLiability - afterLiability) / 240)),
        ...typeOrder.map(candidate => candidate === lastType.type ? 1 : 0),
        Math.min(lastType.value || 0, 201) / 201,
        Math.min(lastType.length || 0, 8) / 8,
        Math.min(leaderCount, 27) / 27,
        engine ? Math.min(engine.passCount || 0, 3) / 3 : 0,
        Math.min(unseenHigher, 54) / 54,
        type.type === HAND_TYPES.SINGLE && unseenHigher === 0 ? 1 : 0,
        leader >= 0 && engine.playerFinished[leader] ? 1 : 0
    ]; // 共57维
}

function scoreStrategicPlay(hand, play, levelCard, planner, context = null) {
    const remaining = removePlayedCards(hand, play);
    const engine = context && context.engine;
    const playerId = context && context.playerId;
    const useWildcardRemainder = !engine || !Array.isArray(engine.aiWildResidualByPlayer)
        || engine.aiWildResidualByPlayer[playerId] !== false;
    // 点数规划器把红桃级牌当本点数计数，可能把实际可一手走完的百搭
    // 同花顺/顺子误估为多手；短残局优先用规则引擎精确验证。
    const wildcardRemainderType = useWildcardRemainder
        && remaining.length > 0 && remaining.length <= 8
        && remaining.some(card => isWildLevelCard(card, levelCard))
        ? identifyHand(remaining, levelCard) : null;
    const remainingTurns = wildcardRemainderType && wildcardRemainderType.valid
        ? 1 : planner(remaining);
    const damage = calculateStructureDamage(hand, play, levelCard);
    const effectiveDamage = context && context.v2 && context.v2.useV4FinishPath
        && remainingTurns <= 1 ? 0 : damage;
    const remainingAllType = remainingTurns === 1
        ? (wildcardRemainderType || identifyHand(remaining, levelCard)) : null;
    const finishPowerBonus = context && context.v2 && context.v2.useV4FinishPath
        && remainingAllType && (
            remainingAllType.type === HAND_TYPES.BOMB
            || remainingAllType.type === HAND_TYPES.STRAIGHT_FLUSH
            || remainingAllType.type === HAND_TYPES.ROCKET
        ) ? -120 : 0;
    const v2 = context && context.v2;
    const rawSingletonLiability = calculateLowSingletonLiability(remaining, levelCard);
    const plannedSingletonLiability = v2 && v2.useV4PlannedResidue
        && typeof planner.residue === 'function' ? planner.residue(remaining) : rawSingletonLiability;
    const baseSingletonLiability = v2 && v2.useV4PlannedResidue
        ? rawSingletonLiability + (plannedSingletonLiability - rawSingletonLiability)
            * v2.plannedResidueScale
        : rawSingletonLiability;
    const useV3Endgame = Boolean(v2 && v2.useV3Endgame);
    const useV3Wildcards = Boolean(v2 && v2.useV3Wildcards);
    const singletonLiability = baseSingletonLiability
        * (useV3Endgame ? (remaining.length <= 4 ? 3 : remaining.length <= 8 ? 2 : 1) : 1);
    const wildCount = play.filter(card => isWildLevelCard(card, levelCard)).length;
    // 中盘百搭能参与组牌，但仍应保留其后续造炸/同花顺的选择权。
    const wildUnitCost = useV3Wildcards && hand.length > 12
        ? 700 : useV3Wildcards && hand.length > 8 ? 450 : 80;
    const wildCost = wildCount * wildUnitCost;
    const type = identifyHand(play, levelCard);
    const controlCost = type.value / 1000;
    const isPowerPlay = type.type === HAND_TYPES.BOMB
        || type.type === HAND_TYPES.STRAIGHT_FLUSH
        || type.type === HAND_TYPES.ROCKET;
    const isLeadDecision = !context || !context.v2 || context.v2.phase === 'lead';
    // 强牌的价值主要是夺回牌权。非收官阶段主动领炸弹/同花顺，通常等于白白放弃一次控制机会。
    const useStructuralCoverage = AI_STRUCTURAL_COVERAGE_ENABLED
        || Boolean(context && context.v2 && context.v2.useV4StructuralCoverage);
    const powerLeadCost = useStructuralCoverage && isLeadDecision && isPowerPlay && remaining.length > 0
        ? (remaining.length <= 2 ? 80 : 650)
        : 0;
    const isSequence = type.type === HAND_TYPES.STRAIGHT
        || type.type === HAND_TYPES.DOUBLE_STRAIGHT
        || type.type === HAND_TYPES.TRIPLE_STRAIGHT;
    const sequenceTempoRisk = useV3Wildcards && v2.phase === 'lead'
        && hand.length > 10 && isSequence ? 180 : 0;
    let score = remainingTurns * 1000 + effectiveDamage * 20 + singletonLiability + finishPowerBonus
        + wildCost + sequenceTempoRisk + powerLeadCost + controlCost - play.length;
    // 两手收尾时先用已知封顶单张拿住牌权，再整手出完；不把中盘“先清小牌”
    // 机械套用到残局。只依据自己手牌和公开已出牌，不查看对手底牌。
    if (v2 && v2.useControlFinish && v2.phase === 'lead' && hand.length <= 5
        && remaining.length > 0 && identifyHand(remaining, levelCard).valid
        && type.type === HAND_TYPES.SINGLE
        && !hasUnseenHigherSingle(v2.unseen, type.value, levelCard)) {
        score -= 700;
    }
    if (v2) score += scoreV2Adjustment(play, levelCard, type, v2, remaining);
    if (v2 && v2.useV4Search && v2.phase === 'lead'
        && hand.length <= 8 && v2.minOpp <= 2
        && type.type !== HAND_TYPES.BOMB
        && type.type !== HAND_TYPES.STRAIGHT_FLUSH
        && type.type !== HAND_TYPES.ROCKET) {
        const teamWinProbability = estimateTeamTrickWinProbability(play, type, levelCard, v2);
        if (teamWinProbability !== null) {
            const riskWeight = (v2.minOpp === 1 ? 300 : 180) * v2.v4SearchWeightScale;
            score += (1 - teamWinProbability) * riskWeight;
        }
    }
    return score;
}

/**
 * v2情境评分调整（只在v2策略且带引擎上下文时生效）：
 * 1. 领牌复用对手公开表示压不了的牌型
 * 2. 下家即将走完时，惩罚喂小单/小对（封顶单张除外）
 * 3. 队友濒临出完且对手还远时，奖励喂小牌帮队友接手
 */
function scoreV2Adjustment(play, levelCard, type, v2, remaining) {
    let adjustment = 0;
    if (v2.phase === 'lead' && v2.nextOpponentId === 0
        && v2.humanOpponentCount <= v2.humanProfileLeadMaxCount
        && v2.humanOpponentProfile && typeof estimateHumanPassSignal === 'function') {
        const signal = estimateHumanPassSignal(
            v2.humanOpponentProfile, type.type, type.value, v2.humanOpponentCount
        );
        adjustment -= (signal.passRate - 0.5) * signal.confidence
            * v2.humanAdaptationWeight;
    }
    if (v2.phase === 'lead') {
        // 对手本局压不了的牌型，继续出同类的命中率更高。
        if (v2.useV4PassInference) {
            const evidencePlayers = new Set((v2.opponentPasses || [])
                .filter(entry => entry.against === type.type
                    && entry.length === type.length
                    && entry.value <= type.value)
                .map(entry => entry.player));
            adjustment -= Math.min(2, evidencePlayers.size) * 65;
        } else if (v2.oppPassTypes.includes(type.type)) {
            adjustment -= 90;
        }

        // 下家只剩1-3张：喂小单/小对等于送出牌权，宁可顶大或出长牌型。
        if (v2.nextOppCount <= 3) {
            if (type.type === HAND_TYPES.SINGLE) {
                const value = getCardSingleValue(play[0], levelCard);
                const hasSeatPassEvidence = v2.nextOpponentPasses.some(entry => (
                    entry.against === HAND_TYPES.SINGLE && entry.value <= value
                ));
                if (v2.useV4LeadProbability
                    && (v2.nextOppCount === 1 || hasSeatPassEvidence)) {
                    const beatProbability = estimateSeatSingleBeatProbability(
                        v2.unseen,
                        value,
                        levelCard,
                        v2.nextOppCount,
                        v2.nextOpponentPasses
                    );
                    adjustment += beatProbability * (4 - v2.nextOppCount) * 300;
                } else {
                    const isTopSingle = !hasUnseenHigherSingle(v2.unseen, value, levelCard);
                    if (!isTopSingle) adjustment += (4 - v2.nextOppCount) * 260;
                }
            } else if (type.type === HAND_TYPES.PAIR && type.value <= 12 && v2.nextOppCount <= 2) {
                adjustment += 320;
            }
        }

        // 队友只剩1-2张且对手都不急：喂小牌让队友接手出完。
        if (!v2.teammateFinished && v2.teammateCount > 0 && v2.teammateCount <= 2 && v2.minOpp >= 4) {
            if (type.type === HAND_TYPES.SINGLE && type.value <= 11) adjustment -= 180;
            else if (type.type === HAND_TYPES.PAIR && type.value <= 9) adjustment -= 90;
        }
    } else if (v2.useV3Endgame && v2.nextOppCount <= 2) {
        // 跟牌拦截残局对手时不再永远选择“刚好大一点”的牌，优先把门槛抬到外面难以再接。
        if (type.type === HAND_TYPES.SINGLE) {
            const value = getCardSingleValue(play[0], levelCard);
            if (v2.useV4FollowProbability) {
                adjustment += estimateSeatSingleBeatProbability(
                    v2.unseen,
                    value,
                    levelCard,
                    v2.nextOppCount,
                    v2.nextOpponentPasses
                ) * 320;
            } else if (hasUnseenHigherSingle(v2.unseen, value, levelCard)) {
                adjustment += 220;
            }
        } else if (type.type === HAND_TYPES.PAIR && type.value <= 12) {
            adjustment += 140;
        }
        if (remaining.length === 0) adjustment -= 2000;
    }
    return adjustment;
}

function removePlayedCards(hand, play) {
    const ids = new Set(play.map(card => card.id));
    return hand.filter(card => !ids.has(card.id));
}

/**
 * 衡量剩余手牌中难以再次组合的小单张。
 * 小牌越难取得出牌权，残局风险越高；A、级牌和王则保留控制价值。
 * 已经能进入自然顺子的牌不计入负担，避免为了“清小牌”反而拆掉顺子。
 */
function calculateLowSingletonLiability(hand, levelCard) {
    const regular = hand.filter(card => !card.isJoker && !isWildLevelCard(card, levelCard));
    const groups = groupByRank(regular);
    const protectedPlays = findStraights(regular, -Infinity, 5, levelCard);
    if (AI_SINGLE_COVERAGE_ENABLED) {
        protectedPlays.push(...findAllStraightFlushes(regular, levelCard));
    }
    const protectedIds = new Set(protectedPlays.flatMap(play => play.map(card => card.id)));
    let liability = 0;
    for (const cards of Object.values(groups)) {
        if (cards.length !== 1 || protectedIds.has(cards[0].id)) continue;
        const value = getCardSingleValue(cards[0], levelCard);
        liability += lowSingletonValueLiability(value);
    }
    return liability;
}

function lowSingletonValueLiability(value) {
    if (value <= 10) return (11 - value) * 6;
    if (value <= 13) return (14 - value) * 2;
    return 0;
}

function calculateStructureDamage(hand, play, levelCard) {
    const before = groupByRank(hand.filter(card => !card.isJoker));
    const used = groupByRank(play.filter(card => !card.isJoker));
    let damage = 0;

    for (const rank of Object.keys(used)) {
        const beforeCount = before[rank] ? before[rank].length : 0;
        const usedCount = used[rank].length;
        const leftCount = beforeCount - usedCount;
        if (beforeCount >= 4 && leftCount > 0) damage += 100;
        else if (beforeCount === 3 && usedCount < 3) damage += 25;
        else if (beforeCount === 2 && usedCount === 1) damage += 12;
    }

    const naturalFlushes = findAllStraightFlushes(
        hand.filter(card => !isWildLevelCard(card, levelCard)),
        levelCard
    );
    for (const flush of naturalFlushes) {
        const flushIds = new Set(flush.map(card => card.id));
        const usedFromFlush = play.filter(card => flushIds.has(card.id)).length;
        if (usedFromFlush > 0 && usedFromFlush < flush.length) damage += 40;
    }
    return damage;
}

/** 点数计数向量上的有界记忆化搜索，估算剩余手牌最少还需几手。 */
function createTurnEstimator(levelCard, options = {}) {
    const memo = new Map();
    const residueMemo = new Map();
    let visited = 0;
    let residueVisited = 0;
    const maxNodes = options.wildcardAware ? 30000 : 12000;
    const straightIndexes = getStraightRankSequences()
        .map(sequence => sequence.map(rank => RANKS.indexOf(rank)));

    const visitMoves = (counts, visit) => {
        const first = counts.findIndex(count => count > 0);
        // 单张、对子、三张、炸弹。
        visit([[first, 1]], true);
        if (counts[first] >= 2) visit([[first, 2]], false);
        if (counts[first] >= 3) visit([[first, 3]], false);
        if (counts[first] >= 4) {
            for (let size = 4; size <= counts[first]; size++) visit([[first, size]], false);
        }

        // 王不参与普通顺子、木板、钢板和三带二。
        if (first < RANKS.length) {
            for (const sequence of straightIndexes) {
                if (sequence.includes(first) && sequence.every(index => counts[index] >= 1)) {
                    visit(sequence.map(index => [index, 1]), false);
                }
            }
            for (let start = 0; start <= RANKS.length - 3; start++) {
                const sequence = [start, start + 1, start + 2];
                if (sequence.includes(first) && sequence.every(index => counts[index] >= 2)) {
                    visit(sequence.map(index => [index, 2]), false);
                }
            }
            for (let start = 0; start <= RANKS.length - 2; start++) {
                const sequence = [start, start + 1];
                if (sequence.includes(first) && sequence.every(index => counts[index] >= 3)) {
                    visit(sequence.map(index => [index, 3]), false);
                }
            }
            if (counts[first] >= 3) {
                for (let pair = 0; pair < RANKS.length; pair++) {
                    if (pair !== first && counts[pair] >= 2) visit([[first, 3], [pair, 2]], false);
                }
            }
            if (counts[first] >= 2) {
                for (let triple = 0; triple < RANKS.length; triple++) {
                    if (triple !== first && counts[triple] >= 3) visit([[first, 2], [triple, 3]], false);
                }
            }
        }

        // 四王炸。
        if (counts[RANKS.length] + counts[RANKS.length + 1] === 4) {
            visit([[RANKS.length, counts[RANKS.length]], [RANKS.length + 1, counts[RANKS.length + 1]]], false);
        }
    };

    const afterMove = (counts, removals) => {
        const next = [...counts];
        for (const [index, amount] of removals) next[index] -= amount;
        return next;
    };

    const solve = counts => {
        const key = counts.join(',');
        if (memo.has(key)) return memo.get(key);
        if (counts.every(count => count === 0)) return 0;
        if (++visited > maxNodes) return fallbackTurnEstimate(counts);

        let best = Infinity;
        visitMoves(counts, removals => {
            best = Math.min(best, 1 + solve(afterMove(counts, removals)));
        });

        memo.set(key, best);
        return best;
    };

    const solveResidue = counts => {
        const key = counts.join(',');
        if (residueMemo.has(key)) return residueMemo.get(key);
        if (counts.every(count => count === 0)) return 0;
        if (++residueVisited > maxNodes) return fallbackPlannedResidue(counts, levelCard);

        const targetTurns = solve(counts);
        const first = counts.findIndex(count => count > 0);
        let best = Infinity;
        visitMoves(counts, (removals, isSingle) => {
            const next = afterMove(counts, removals);
            if (1 + solve(next) !== targetTurns) return;
            let local = 0;
            if (isSingle && first < RANKS.length) {
                local = lowSingletonValueLiability(getCardSingleValue({
                    rank: RANKS[first],
                    value: RANK_VALUE[RANKS[first]],
                    isJoker: false
                }, levelCard));
            }
            best = Math.min(best, local + solveResidue(next));
        });
        if (!Number.isFinite(best)) best = fallbackPlannedResidue(counts, levelCard);
        residueMemo.set(key, best);
        return best;
    };

    const toCounts = hand => {
        const counts = Array(RANKS.length + 2).fill(0);
        let wildCount = 0;
        hand.forEach(card => {
            if (options.wildcardAware && isWildLevelCard(card, levelCard)) {
                wildCount++;
            } else if (card.isJoker) {
                counts[RANKS.length + (card.rank === JOKER_BIG ? 1 : 0)]++;
            } else {
                counts[RANKS.indexOf(card.rank)]++;
            }
        });
        return { counts, wildCount };
    };

    const evaluateAssignments = (hand, includeResidue) => {
        if (options.resetBudgetPerHand) {
            visited = 0;
            residueVisited = 0;
        }
        const { counts, wildCount } = toCounts(hand);
        if (!options.wildcardAware || wildCount === 0) {
            return includeResidue ? { turns: solve(counts), residue: solveResidue(counts) } : solve(counts);
        }

        let bestTurns = Infinity;
        let bestResidue = Infinity;
        const assignWilds = depth => {
            if (depth === wildCount) {
                const turns = solve(counts);
                if (turns < bestTurns) {
                    bestTurns = turns;
                    bestResidue = includeResidue ? solveResidue(counts) : Infinity;
                } else if (includeResidue && turns === bestTurns) {
                    bestResidue = Math.min(bestResidue, solveResidue(counts));
                }
                return;
            }
            for (let rank = 0; rank < RANKS.length; rank++) {
                counts[rank]++;
                assignWilds(depth + 1);
                counts[rank]--;
            }
        };
        assignWilds(0);
        return includeResidue ? { turns: bestTurns, residue: bestResidue } : bestTurns;
    };

    const estimator = hand => evaluateAssignments(hand, false);
    estimator.residue = hand => evaluateAssignments(hand, true).residue;
    return estimator;
}

function fallbackPlannedResidue(counts, levelCard) {
    return counts.reduce((debt, count, index) => {
        if (count !== 1 || index >= RANKS.length) return debt;
        return debt + lowSingletonValueLiability(getCardSingleValue({
            rank: RANKS[index],
            value: RANK_VALUE[RANKS[index]],
            isJoker: false
        }, levelCard));
    }, 0);
}

function fallbackTurnEstimate(counts) {
    return counts.reduce((turns, count) => {
        if (count === 0) return turns;
        return turns + (count >= 4 ? 1 : 1);
    }, 0);
}

/**
 * 找所有炸弹
 */
function findAllBombs(hand, levelCard) {
    const results = [];
    const rankGroups = groupByRank(hand);

    for (let rank in rankGroups) {
        if (rankGroups[rank].length >= 4) {
            for (let size = 4; size <= rankGroups[rank].length; size++) {
                results.push(...buildStructuralCardVariants(rankGroups, [[rank, size]]));
            }
        }
    }
    return dedupeCardPlays(results);
}

/**
 * 找比指定炸弹大的炸弹
 */
function findBiggerBombs(hand, lastType, levelCard) {
    const bombs = findAllBombs(hand, levelCard);
    return bombs.filter(b => {
        const t = identifyHand(b, levelCard);
        return t.type === HAND_TYPES.BOMB && canBeat(t, lastType);
    });
}

/**
 * 找所有同花顺
 */
function findAllStraightFlushes(hand, levelCard) {
    const results = [];
    const suitGroups = {};

    for (let card of hand) {
        if (card.isJoker) continue;
        if (!suitGroups[card.suit]) suitGroups[card.suit] = [];
        suitGroups[card.suit].push(card);
    }

    for (let suit in suitGroups) {
        const byRank = groupByRank(suitGroups[suit]);
        for (const ranks of getStraightRankSequences()) {
            if (!ranks.every(rank => byRank[rank])) continue;
            const flush = ranks.map(rank => byRank[rank][0]);
            if (identifyHand(flush, levelCard).type === HAND_TYPES.STRAIGHT_FLUSH) results.push(flush);
        }
    }
    return results;
}

/**
 * 定向搜索必须使用红桃级牌补成的炸弹。
 * 复杂度只与13个点数和最多10张炸弹长度有关，可安全用于27张手牌。
 */
function findWildcardBombs(hand, levelCard) {
    const wilds = hand.filter(card => isWildLevelCard(card, levelCard));
    if (wilds.length === 0) return [];

    const regular = hand.filter(card => !isWildLevelCard(card, levelCard) && !card.isJoker);
    const rankGroups = groupByRank(regular);
    const results = [];

    for (const rank of Object.keys(rankGroups)) {
        const naturalCards = rankGroups[rank];
        const maxSize = naturalCards.length + wilds.length;
        const minSize = AI_PARTIAL_WILDCARD_BOMBS_ENABLED ? 4
            : Math.max(4, naturalCards.length + 1);
        for (let size = minSize; size <= maxSize; size++) {
            const minWilds = AI_PARTIAL_WILDCARD_BOMBS_ENABLED ? 1
                : size - naturalCards.length;
            for (let wildNeeded = minWilds; wildNeeded <= wilds.length; wildNeeded++) {
                const naturalNeeded = size - wildNeeded;
                if (naturalNeeded < 1 || naturalNeeded > naturalCards.length) continue;
                const variants = AI_PARTIAL_WILDCARD_BOMBS_ENABLED
                    ? buildStructuralCardVariants(rankGroups, [[rank, naturalNeeded]])
                    : [naturalCards.slice(0, naturalNeeded)];
                for (const variant of variants) {
                    const combo = [...variant, ...wilds.slice(0, wildNeeded)];
                    if (identifyHand(combo, levelCard).type === HAND_TYPES.BOMB) results.push(combo);
                }
            }
        }
    }
    return dedupeCardPlays(results);
}

/** 定向搜索必须使用红桃级牌补成的五张同花顺。 */
function findWildcardStraightFlushes(hand, levelCard) {
    const wilds = hand.filter(card => isWildLevelCard(card, levelCard));
    if (wilds.length === 0) return [];

    const regular = hand.filter(card => !isWildLevelCard(card, levelCard) && !card.isJoker);
    const results = [];
    for (const suit of SUITS) {
        const suitCards = regular.filter(card => card.suit === suit);
        const byRank = groupByRank(suitCards);
        for (const ranks of getStraightRankSequences()) {
            const missingRanks = ranks.filter(rank => !byRank[rank]);
            if (missingRanks.length === 0 || missingRanks.length > wilds.length) continue;
            const combo = [
                ...ranks.filter(rank => byRank[rank]).map(rank => byRank[rank][0]),
                ...wilds.slice(0, missingRanks.length)
            ];
            if (identifyHand(combo, levelCard).type === HAND_TYPES.STRAIGHT_FLUSH) results.push(combo);
        }
    }
    return dedupeCardPlays(results);
}

function findWildcardPowerPlays(hand, levelCard) {
    return dedupeCardPlays([
        ...findWildcardBombs(hand, levelCard),
        ...findWildcardStraightFlushes(hand, levelCard)
    ]);
}

/**
 * v3定向生成含百搭的普通组合。按牌型模板构造，复杂度只与点数组合有关，
 * 因而不需要在中盘对20多张手牌做指数级子集穷举。
 */
function findWildcardPatternPlays(hand, levelCard, lastType = null) {
    const wilds = hand.filter(card => isWildLevelCard(card, levelCard));
    if (wilds.length === 0) return [];
    const regular = hand.filter(card => !isWildLevelCard(card, levelCard) && !card.isJoker);
    const groups = groupByRank(regular);
    const results = [];

    const addPattern = requirements => {
        let missing = 0;
        const cards = [];
        for (const [rank, count] of requirements) {
            const available = groups[rank] || [];
            const used = Math.min(count, available.length);
            cards.push(...available.slice(0, used));
            missing += count - used;
        }
        if (missing < 1 || missing > wilds.length) return;
        const play = [...cards, ...wilds.slice(0, missing)];
        const type = identifyHand(play, levelCard);
        if (type.valid && (!lastType || canBeat(type, lastType))) results.push(play);
    };

    // 对子、三张，以及三带二。
    for (const rank of RANKS) {
        addPattern([[rank, 2]]);
        addPattern([[rank, 3]]);
        for (const pairRank of RANKS) {
            if (pairRank !== rank) addPattern([[rank, 3], [pairRank, 2]]);
        }
    }

    // 顺子、木板、钢板。
    for (const ranks of getStraightRankSequences()) {
        addPattern(ranks.map(rank => [rank, 1]));
    }
    for (let start = 0; start <= RANKS.length - 3; start++) {
        addPattern(RANKS.slice(start, start + 3).map(rank => [rank, 2]));
    }
    for (let start = 0; start <= RANKS.length - 2; start++) {
        addPattern(RANKS.slice(start, start + 2).map(rank => [rank, 3]));
    }

    return dedupeCardPlays([...results, ...findWildcardPowerPlays(hand, levelCard)])
        .filter(play => !lastType || canBeat(identifyHand(play, levelCard), lastType));
}

/** 队友牌权只有在能直接走完或必须封锁下家残局对手时才接管。 */
function findTeammateTakeover(hand, lastType, levelCard, v3, context) {
    const allType = identifyHand(hand, levelCard);
    if (allType.valid && canBeat(allType, lastType)) return [...hand];
    if (v3.nextOppCount > 2 || v3.teammateFinished) return null;
    if (lastType.type !== HAND_TYPES.SINGLE && lastType.type !== HAND_TYPES.PAIR) return null;
    // 报单的对手无法接对子，队友已经封住其最后一张，无需再抬高对子。
    if (lastType.type === HAND_TYPES.PAIR && v3.nextOppCount < 2) return null;

    const regular = hand.filter(card => !isWildLevelCard(card, levelCard));
    let candidates = findAllBeatingPlays(regular, lastType, levelCard)
        .filter(play => identifyHand(play, levelCard).type === lastType.type);
    if (candidates.length === 0) return null;

    if (v3.useV4TeamProbability && lastType.type === HAND_TYPES.SINGLE) {
        const currentRisk = estimateSeatSingleBeatProbability(
            v3.unseen,
            lastType.value,
            levelCard,
            v3.nextOppCount,
            v3.nextOpponentPasses
        );
        candidates = candidates.filter(play => {
            const candidateType = identifyHand(play, levelCard);
            const candidateRisk = estimateSeatSingleBeatProbability(
                v3.unseen,
                candidateType.value,
                levelCard,
                v3.nextOppCount,
                v3.nextOpponentPasses
            );
            return currentRisk >= 0.25 && candidateRisk <= currentRisk - 0.12;
        });
        if (candidates.length === 0) return null;
    }

    const planner = createTurnEstimator(levelCard);
    candidates = [...candidates].sort((a, b) => {
        const typeA = identifyHand(a, levelCard);
        const typeB = identifyHand(b, levelCard);
        const topA = typeA.type === HAND_TYPES.SINGLE
            && !hasUnseenHigherSingle(v3.unseen, typeA.value, levelCard) ? 0 : 1;
        const topB = typeB.type === HAND_TYPES.SINGLE
            && !hasUnseenHigherSingle(v3.unseen, typeB.value, levelCard) ? 0 : 1;
        if (topA !== topB) return topA - topB;
        return scoreStrategicPlay(hand, a, levelCard, planner, context)
            - scoreStrategicPlay(hand, b, levelCard, planner, context);
    });
    return candidates[0];
}

/**
 * 找比指定同花顺大的同花顺
 */
function findBiggerStraightFlushes(hand, lastType, levelCard) {
    const flushes = findAllStraightFlushes(hand, levelCard);
    return flushes.filter(f => {
        const t = identifyHand(f, levelCard);
        return t.type === HAND_TYPES.STRAIGHT_FLUSH && canBeat(t, lastType);
    });
}

/**
 * 找火箭（4王）
 */
function findRocket(hand) {
    const jokers = hand.filter(c => c.isJoker);
    if (jokers.length >= 4) {
        return jokers.slice(0, 4);
    }
    return null;
}

// ==================== 辅助函数 ====================

/**
 * 按点数分组
 */
function groupByRank(hand) {
    const groups = {};
    for (let card of hand) {
        const key = card.isJoker ? card.rank : card.rank;
        if (!groups[key]) groups[key] = [];
        groups[key].push(card);
    }
    return groups;
}

/**
 * 为同一牌型保留少量“实物牌”变体。
 * 两副牌里同一点数常有多张可选；只取数组前几张会无意拆掉某一花色的潜在同花顺。
 * 基准方案之外，分别尝试避开四种花色，候选数量最多放大5倍但能覆盖关键结构差异。
 */
let AI_STRUCTURAL_COVERAGE_ENABLED = false;
let AI_SINGLE_COVERAGE_ENABLED = false;
let AI_INDEPENDENT_POWER_COUNT_ENABLED = false;
let AI_PARTIAL_WILDCARD_BOMBS_ENABLED = false;

function buildStructuralCardVariants(rankGroups, requirements) {
    const variants = [];
    const protectedSuits = AI_STRUCTURAL_COVERAGE_ENABLED ? [null, ...SUITS] : [null];
    for (const protectedSuit of protectedSuits) {
        const cards = [];
        let valid = true;
        for (const [rank, count] of requirements) {
            const available = rankGroups[rank] || [];
            if (available.length < count) {
                valid = false;
                break;
            }
            const ordered = protectedSuit
                ? [...available].sort((a, b) => Number(a.suit === protectedSuit) - Number(b.suit === protectedSuit))
                : available;
            cards.push(...ordered.slice(0, count));
        }
        if (valid) variants.push(cards);
    }
    return dedupeCardPlays(variants);
}

function getStraightRankSequences() {
    const sequences = [['A', '2', '3', '4', '5']];
    for (let start = 0; start <= RANKS.length - 5; start++) {
        sequences.push(RANKS.slice(start, start + 5));
    }
    return sequences;
}

function isWildLevelCard(card, levelCard) {
    return Boolean(card && !card.isJoker && card.suit === '♥' && card.rank === levelCard);
}

/** 在8张以内的残局穷举含百搭的合法出牌。 */
function findWildcardPlays(hand, levelCard, lastType = null) {
    if (!hand.some(card => isWildLevelCard(card, levelCard)) || hand.length > 8) return [];

    const results = [];
    const selected = [];
    const visit = startIndex => {
        if (selected.length >= 2 && selected.some(card => isWildLevelCard(card, levelCard))) {
            const type = identifyHand(selected, levelCard);
            if (type.valid && (!lastType || canBeat(type, lastType))) results.push([...selected]);
        }
        for (let index = startIndex; index < hand.length; index++) {
            selected.push(hand[index]);
            visit(index + 1);
            selected.pop();
        }
    };
    visit(0);
    return results;
}

function compareWildcardPlays(a, b, levelCard) {
    if (a.length !== b.length) return b.length - a.length;
    const wildA = a.filter(card => isWildLevelCard(card, levelCard)).length;
    const wildB = b.filter(card => isWildLevelCard(card, levelCard)).length;
    if (wildA !== wildB) return wildA - wildB;
    return a.map(card => card.value).reduce((sum, value) => sum + value, 0)
        - b.map(card => card.value).reduce((sum, value) => sum + value, 0);
}

function dedupeCardPlays(plays) {
    const seen = new Set();
    return plays.filter(play => {
        const key = play.map(card => card.id).sort().join('|');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/** 优先使用规则上最小的强牌，同等强度时少用百搭。 */
function comparePowerPlays(a, b, levelCard) {
    const typeA = identifyHand(a, levelCard);
    const typeB = identifyHand(b, levelCard);
    if (canBeat(typeA, typeB)) return 1;
    if (canBeat(typeB, typeA)) return -1;
    const wildA = a.filter(card => isWildLevelCard(card, levelCard)).length;
    const wildB = b.filter(card => isWildLevelCard(card, levelCard)).length;
    return wildA - wildB;
}

/**
 * 推荐出牌：根据当前牌面和上家出牌，找出能压过的最小代价牌型
 * @param {Array} hand - 玩家手牌
 * @param {Object} lastType - 上家牌型（null表示自由出牌）
 * @param {string} levelCard - 当前级牌
 * @returns {Array|null} 推荐的牌组，null表示无法出牌
 */
function recommendPlay(hand, lastType, levelCard) {
    if (!hand || hand.length === 0) return null;
    
    // 自由出牌：与AI同级的整手牌策略搜索（不再只推荐最小单张）
    if (!lastType) {
        const regularHand = hand.filter(card => !isWildLevelCard(card, levelCard));
        if (hand.length <= 5) {
            const allType = identifyHand(hand, levelCard);
            if (allType.valid) return [...hand];
        }
        const searchHand = regularHand.length > 0 ? regularHand : hand;
        const candidates = findLeadCandidates(searchHand, levelCard);
        const pick = chooseStrategicPlay(searchHand, candidates, levelCard, null);
        if (pick) return pick;
        const sorted = [...searchHand].sort((a, b) => {
            const aVal = getCardSingleValue(a, levelCard);
            const bVal = getCardSingleValue(b, levelCard);
            return aVal - bVal;
        });
        return [sorted[0]];
    }
    
    // 跟牌：找能压过的最小牌型
    const beating = findAllBeatingPlays(hand, lastType, levelCard);
    
    if (beating.length === 0) {
        // 没有同牌型时，统一搜索自然/百搭强牌并严格验证能否压过。
        const regularHand = hand.filter(card => !isWildLevelCard(card, levelCard));
        const powerPlays = dedupeCardPlays([
            ...findAllBombs(regularHand, levelCard),
            ...findAllStraightFlushes(regularHand, levelCard),
            ...findWildcardPowerPlays(hand, levelCard)
        ]).filter(play => canBeat(identifyHand(play, levelCard), lastType));
        powerPlays.sort((a, b) => comparePowerPlays(a, b, levelCard));
        return powerPlays[0] || null;
    }
    
    // 选择最小的能压过的牌
    beating.sort((a, b) => {
        const typeA = identifyHand(a, levelCard);
        const typeB = identifyHand(b, levelCard);
        return typeA.value - typeB.value;
    });
    
    return beating[0];
}
