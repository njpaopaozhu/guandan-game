/**
 * 掼蛋游戏 - 游戏引擎模块
 * 包含：游戏状态管理、规则校验、出牌逻辑、升级系统、贡牌还牌
 */

// ==================== 游戏引擎类 ====================

class GameEngine {
    constructor() {
        this.reset();
    }

    /**
     * 重置游戏状态
     */
    reset() {
        this.hands = [[], [], [], []];          // 4个玩家的手牌
        this.currentPlayer = 0;                 // 当前出牌玩家
        this.lastPlay = null;                   // 上一次出牌的牌组
        this.lastPlayType = null;               // 上一次出牌的牌型
        this.lastPlayer = -1;                   // 上一次出牌的玩家
        this.passCount = 0;                     // 连续过牌数
        this.roundNumber = 1;                   // 当前局数
        
        // 队伍级别（0-12对应2-A）
        this.teamLevel = { a: 0, b: 0 };       // 从0开始，0=打2
        this.roundLevel = 0;                    // 下一副牌实际使用的级别
        this.matchOver = false;
        this.matchWinner = null;
        
        // 出完牌顺序
        this.finishOrder = [];
        
        // 玩家是否已出完牌
        this.playerFinished = [false, false, false, false];
        
        // 游戏状态
        this.state = 'idle'; // idle, playing, tribute, returnCard, finished
        
        // 历史记录
        this.history = [];
        
        // 当前级牌
        this.levelCard = '2';
        this.pendingTributes = [];
        this.lastTributeExchanges = [];
        this.lastTributeResisted = false;
        this.tributeOpeningPlayer = null;
        this.pendingPlayerReturns = [];

        // 记牌器：本局所有玩家已打出的牌与过牌记录（公开信息，AI可用于推理）
        this.playedCards = [];
        this.passMemory = [];
        // 按座位保存公开行动序列；专业模型桥接可据此重建历史，绝不包含未出手牌。
        this.publicActionHistory = [];
        // AI策略版本（'v1' 旧策略 / 'v2' 上一版 / 'v3' 当前版；v4-* 为实验），用于A/B评测
        this.aiStrategyByPlayer = null;
        this.aiStrategyMode = null;
    }

    /**
     * 获取指定玩家的AI策略版本
     */
    getStrategyMode(playerId) {
        if (Array.isArray(this.aiStrategyByPlayer) && Number.isInteger(playerId)) {
            return this.aiStrategyByPlayer[playerId] || 'v3';
        }
        return this.aiStrategyMode || 'v3';
    }

    /**
     * 获取当前级牌（由上一副牌上游方的升级结果决定）
     */
    getLevelCard() {
        const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
        return ranks[Math.max(0, Math.min(this.roundLevel, 12))];
    }

    /**
     * 开始新一局
     */
    startRound() {
        this.levelCard = this.getLevelCard();
        this.hands = dealCards();
        
        // 排序所有手牌
        for (let i = 0; i < 4; i++) {
            sortHand(this.hands[i], this.levelCard);
        }

        // 进贡发生在新一局发牌后，不能交换上一局已经出完的旧手牌。
        this.lastTributeExchanges = this.applyPendingTributes({ deferPlayerReturn: true });
        
        this.currentPlayer = this.tributeOpeningPlayer !== null
            ? this.tributeOpeningPlayer
            : this.lastTributeExchanges.length > 0 ? this.getTributeOpeningPlayer(this.lastTributeExchanges) : 0;
        this.tributeOpeningPlayer = null;
        this.lastPlay = null;
        this.lastPlayType = null;
        this.lastPlayer = -1;
        this.passCount = 0;
        this.finishOrder = [];
        this.playerFinished = [false, false, false, false];
        this.playedCards = [];
        this.passMemory = [];
        this.publicActionHistory = [];
        this.state = this.pendingPlayerReturns.length > 0 ? 'tribute' : 'playing';
        
        return {
            hands: this.hands,
            levelCard: this.levelCard,
            teamLevel: { ...this.teamLevel },
            tributeExchanges: [...this.lastTributeExchanges],
            tributeResisted: this.lastTributeResisted,
            pendingPlayerReturns: [...this.pendingPlayerReturns]
        };
    }

    /**
     * 玩家出牌
     */
    playCards(playerId, cards) {
        if (this.state !== 'playing') return { success: false, error: '游戏未在进行中' };
        if (this.currentPlayer !== playerId) return { success: false, error: '不是你的回合' };
        if (this.playerFinished[playerId]) return { success: false, error: '你已出完牌' };
        if (!Array.isArray(cards) || cards.length === 0) {
            return { success: false, error: '请选择要出的牌' };
        }

        const hand = this.hands[playerId];
        const cardIds = cards.map(card => card && card.id);
        if (cardIds.some(id => !id) || new Set(cardIds).size !== cardIds.length) {
            return { success: false, error: '出牌数据无效' };
        }
        if (cardIds.some(id => !hand.some(card => card.id === id))) {
            return { success: false, error: '选中的牌不在手牌中' };
        }
        
        // 识别牌型
        const handType = identifyHand(cards, this.levelCard);
        if (!handType.valid) return { success: false, error: '无效的牌型' };
        
        // 如果有上家出牌，需要比大小
        if (this.lastPlay && this.lastPlayer !== playerId) {
            if (!canBeat(handType, this.lastPlayType)) {
                return { success: false, error: '你的牌没有上家大' };
            }
        }
        
        // 从手牌中移除
        for (let card of cards) {
            const idx = hand.findIndex(c => c.id === card.id);
            if (idx !== -1) hand.splice(idx, 1);
        }
        
        // 更新状态
        this.lastPlay = [...cards];
        this.lastPlayType = handType;
        this.lastPlayer = playerId;
        this.passCount = 0;
        this.playedCards.push(...cards);
        this.publicActionHistory.push({ player: playerId, action: 'play',
            cards: cards.map(card => ({ id: card.id, suit: card.suit, rank: card.rank,
                isJoker: Boolean(card.isJoker) })) });
        
        // 检查是否出完
        if (hand.length === 0) {
            this.playerFinished[playerId] = true;
            this.finishOrder.push(playerId);
            
            // 检查是否所有人都出完
            const remaining = this.playerFinished.filter(f => !f).length;
            if (remaining <= 1) {
                // 最后一个没出完的是末游
                if (remaining === 1) {
                    const lastPlayer = this.playerFinished.findIndex(f => !f);
                    this.finishOrder.push(lastPlayer);
                }
                const roundResult = this.endRound();
                return {
                    ...roundResult,
                    handType,
                    playerFinished: true
                };
            }
        }
        
        // 下一个玩家
        this.advanceToNextPlayer();
        
        return {
            success: true,
            handType: handType,
            nextPlayer: this.currentPlayer,
            playerFinished: this.playerFinished[playerId]
        };
    }

    /**
     * 玩家过牌
     */
    passCards(playerId) {
        if (this.state !== 'playing') return { success: false, error: '游戏未在进行中' };
        if (this.currentPlayer !== playerId) return { success: false, error: '不是你的回合' };
        if (!this.lastPlay) return { success: false, error: '你必须出牌（首轮）' };
        if (this.playerFinished[playerId]) return { success: false, error: '你已出完牌' };
        
        this.passCount++;
        // 记录“谁压不了哪种牌型”，供AI后续领牌时复用对手弱项。
        if (this.lastPlayType) {
            this.passMemory.push({
                player: playerId,
                against: this.lastPlayType.type,
                value: this.lastPlayType.value,
                length: this.lastPlayType.length,
                leader: this.lastPlayer
            });
        }
        this.publicActionHistory.push({ player: playerId, action: 'pass', cards: [] });
        
        // 所有仍需响应的玩家都过牌后，重置牌墩。
        const activeCount = this.playerFinished.filter(finished => !finished).length;
        const requiredPasses = activeCount - (this.playerFinished[this.lastPlayer] ? 0 : 1);
        if (this.passCount >= requiredPasses) {
            // 最后出牌者已出完时，由其尚未出完的队友“接风”。
            const teammate = this.getTeammate(this.lastPlayer);
            if (this.playerFinished[this.lastPlayer]) {
                this.currentPlayer = !this.playerFinished[teammate]
                    ? teammate
                    : this.findNextActivePlayer(this.lastPlayer);
            } else {
                this.currentPlayer = this.lastPlayer;
            }
            this.lastPlay = null;
            this.lastPlayType = null;
            this.passCount = 0;
            return { success: true, type: 'newRound', nextPlayer: this.currentPlayer };
        }
        
        this.advanceToNextPlayer();
        return { success: true, type: 'pass', nextPlayer: this.currentPlayer };
    }

    /**
     * 前进到下一个有效玩家
     */
    advanceToNextPlayer() {
        let next = (this.currentPlayer + 1) % 4;
        let attempts = 0;
        while (this.playerFinished[next] && attempts < 4) {
            next = (next + 1) % 4;
            attempts++;
        }
        this.currentPlayer = next;
    }

    findNextActivePlayer(playerId) {
        for (let offset = 1; offset <= 4; offset++) {
            const candidate = (playerId + offset) % 4;
            if (!this.playerFinished[candidate]) return candidate;
        }
        return playerId;
    }

    /**
     * 结束一局，计算结果
     */
    endRound() {
        this.state = 'finished';
        
        // finishOrder: [第一名, 第二名, 第三名, 第四名]
        const first = this.finishOrder[0];
        const second = this.finishOrder[1];
        const third = this.finishOrder[2];
        const fourth = this.finishOrder[3];
        
        // 确定队伍（0和2一队A，1和3一队B）
        const teamOf = (p) => (p % 2 === 0) ? 'a' : 'b';
        const firstTeam = teamOf(first);
        const secondTeam = teamOf(second);
        
        let result = {};
        
        if (firstTeam === secondTeam) {
            // 双上：一队包揽前两名
            result = {
                type: 'double_win',
                winnerTeam: firstTeam,
                levelUp: 3,  // 升3级
                description: `队伍${firstTeam.toUpperCase()}双上！升3级`
            };
        } else if (teamOf(fourth) !== firstTeam) {
            // 头游方对方末游
            result = {
                type: 'head_tail',
                winnerTeam: firstTeam,
                levelUp: 2,  // 升2级
                description: `队伍${firstTeam.toUpperCase()}头游，对方末游！升2级`
            };
        } else {
            // 头游方队友末游
            result = {
                type: 'normal_win',
                winnerTeam: firstTeam,
                levelUp: 1,  // 升1级
                description: `队伍${firstTeam.toUpperCase()}获胜！升1级`
            };
        }
        
        // 升级（级别范围0-12，对应2-A）
        const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
        const oldLevel = this.teamLevel[result.winnerTeam];
        this.teamLevel[result.winnerTeam] = Math.min(
            this.teamLevel[result.winnerTeam] + result.levelUp,
            12
        );
        const newLevel = this.teamLevel[result.winnerTeam];
        this.roundLevel = newLevel;
        result.levelBefore = ranks[oldLevel];
        result.levelAfter = ranks[newLevel];
        
        // A必须实际打过：升到A只获得打A级的资格；A级局还要求队友不是末游。
        const passedAce = this.levelCard === 'A'
            && oldLevel === 12
            && result.type !== 'normal_win';
        if (passedAce) {
            result.gameOver = true;
            this.matchOver = true;
            this.matchWinner = result.winnerTeam;
            result.description += ` 队伍${result.winnerTeam.toUpperCase()}获得最终胜利！`;
        }
        
        // 真正过A后没有下一局，不再生成贡牌安排。
        result.tribute = result.gameOver
            ? []
            : this.calculateTribute(first, second, third, fourth, result.type);
        result.tributes = result.tribute; // alias for clarity
        result.finishOrder = [...this.finishOrder];
        this.pendingTributes = result.tributes.map(({ from, to }) => ({ from, to }));
        
        // 记录历史
        this.history.push({
            round: this.roundNumber,
            finishOrder: [...this.finishOrder],
            result: result,
            timestamp: new Date().toLocaleTimeString()
        });
        
        this.roundNumber++;
        
        return { success: true, type: 'roundEnd', result: result };
    }

    /**
     * 计算贡牌关系（根据胜负类型）
     * @returns {Array} 贡牌关系数组，每项 {from, to, tributeCard, returnCard}
     */
    calculateTribute(first, second, third, fourth, resultType) {
        const tributes = [];
        const teamOf = (p) => (p % 2 === 0) ? 'a' : 'b';
        
        // 双上：双下两人分别向头游、二游进贡。
        if (resultType === 'double_win') {
            tributes.push(this.buildTributeRelation(fourth, first));
            tributes.push(this.buildTributeRelation(third, second));
            return tributes;
        }
        
        // 头游对末游（升2级）：末游向头游贡牌
        if (resultType === 'head_tail') {
            tributes.push(this.buildTributeRelation(fourth, first));
            return tributes;
        }
        
        // 普通胜利（升1级）：末游向头游贡牌
        if (resultType === 'normal_win') {
            tributes.push(this.buildTributeRelation(fourth, first));
            return tributes;
        }
        
        return tributes;
    }

    buildTributeRelation(from, to) {
        const relation = { from, to };
        const tributeCard = this.selectTributeCard(from);
        const returnCard = tributeCard ? this.selectReturnCard(to, tributeCard) : null;
        if (tributeCard && returnCard) {
            relation.tributeCard = tributeCard;
            relation.returnCard = returnCard;
        }
        return relation;
    }

    /** 在新一局手牌上执行上一局留下的进贡关系。 */
    applyPendingTributes(options = {}) {
        const deferPlayerReturn = Boolean(options.deferPlayerReturn);
        this.lastTributeResisted = false;
        this.pendingPlayerReturns = [];
        if (!this.pendingTributes || this.pendingTributes.length === 0) return [];

        const payerIds = [...new Set(this.pendingTributes.map(item => item.from))];
        const bigJokerCount = payerIds.reduce((total, playerId) => {
            return total + this.hands[playerId].filter(card => card.isJoker && card.rank === JOKER_BIG).length;
        }, 0);
        if (bigJokerCount >= 2) {
            this.lastTributeResisted = true;
            this.tributeOpeningPlayer = this.pendingTributes[0].to;
            this.pendingTributes = [];
            return [];
        }

        const exchanges = [];
        for (const relation of this.pendingTributes) {
            const tributeCard = this.selectTributeCard(relation.from);
            if (deferPlayerReturn && relation.to === 0 && tributeCard) {
                this.pendingPlayerReturns.push({ ...relation, tributeCard });
                continue;
            }
            const returnCard = this.selectReturnCard(relation.to, tributeCard);
            if (!tributeCard || !returnCard) continue;

            const exchange = { ...relation, tributeCard, returnCard };
            if (this.swapTributeCards(exchange)) exchanges.push(exchange);
        }
        this.pendingTributes = [];
        if (this.pendingPlayerReturns.length === 0 && exchanges.length > 0) {
            this.tributeOpeningPlayer = this.getTributeOpeningPlayer(exchanges);
        }
        return exchanges;
    }

    /** 真人受贡时选择一张不高于10的牌完成还牌。 */
    completePlayerReturn(cardId) {
        if (this.state !== 'tribute' || this.pendingPlayerReturns.length === 0) {
            return { success: false, error: '当前不在还牌阶段' };
        }

        const pending = this.pendingPlayerReturns[0];
        const returnCard = this.hands[pending.to].find(card => card.id === cardId);
        if (!returnCard || returnCard.isJoker || returnCard.value > 10) {
            return { success: false, error: '请选择一张不高于10的普通牌还牌' };
        }

        const exchange = { ...pending, returnCard };
        if (!this.swapTributeCards(exchange)) {
            return { success: false, error: '贡还牌交换失败' };
        }

        this.lastTributeExchanges.push(exchange);
        this.pendingPlayerReturns.shift();
        if (this.pendingPlayerReturns.length === 0) {
            this.tributeOpeningPlayer = this.getTributeOpeningPlayer(this.lastTributeExchanges);
            this.currentPlayer = this.tributeOpeningPlayer;
            this.tributeOpeningPlayer = null;
            this.state = 'playing';
        }

        return { success: true, exchange, pending: this.pendingPlayerReturns.length };
    }

    /** 单贡由进贡方先出；双贡由进贡牌较大的一方先出。 */
    getTributeOpeningPlayer(exchanges) {
        if (!Array.isArray(exchanges) || exchanges.length === 0) return 0;
        return [...exchanges].sort((a, b) => {
            return getCardSingleValue(b.tributeCard, this.levelCard)
                - getCardSingleValue(a.tributeCard, this.levelCard);
        })[0].from;
    }

    swapTributeCards(tribute) {
        const { from, to, tributeCard, returnCard } = tribute;
        const fromHand = this.hands[from];
        const toHand = this.hands[to];
        if (!fromHand || !toHand) return false;

        const tributeIdx = fromHand.findIndex(c => c.id === tributeCard.id);
        const returnIdx = toHand.findIndex(c => c.id === returnCard.id);
        if (tributeIdx === -1 || returnIdx === -1) return false;

        fromHand.splice(tributeIdx, 1);
        toHand.splice(returnIdx, 1);
        toHand.push(tributeCard);
        fromHand.push(returnCard);
        sortHand(fromHand, this.levelCard);
        sortHand(toHand, this.levelCard);
        return true;
    }
    
    /**
     * 选择贡牌（最大的牌）
     */
    selectTributeCard(playerId) {
        const hand = this.hands[playerId];
        if (!hand || hand.length === 0) return null;
        
        // 红桃级牌（逢人配）不能作为贡牌。
        const candidates = hand.filter(card => !(card.suit === '♥' && card.rank === this.levelCard));
        if (candidates.length === 0) return null;
        const sorted = [...candidates].sort((a, b) => {
            const aVal = getCardSingleValue(a, this.levelCard);
            const bVal = getCardSingleValue(b, this.levelCard);
            return bVal - aVal; // 降序
        });
        
        return sorted[0];
    }
    
    /**
     * 选择还牌（点数不高于10）
     * v2策略：还牌对象是对手，应尽量削弱对方——
     * 1. 红桃级牌（逢人配）绝不能还（旧逻辑在级牌≤10时反而会优先还出百搭，属重大失误）
     * 2. 优先还不破坏自己对子/三张的单张
     * 3. 同等条件下还最小的牌
     */
    selectReturnCard(playerId, tributeCard) {
        const hand = this.hands[playerId];
        if (!hand || hand.length === 0) return null;

        const mode = this.getStrategyMode(playerId);
        const isWild = (card) => !card.isJoker && card.suit === '♥' && card.rank === this.levelCard;

        if (mode !== 'v1') {
            let candidates = hand.filter(card => !card.isJoker && card.value <= 10 && !isWild(card));
            if (candidates.length === 0) {
                candidates = hand.filter(card => !card.isJoker && card.value <= 10);
            }
            if (candidates.length === 0) return null;
            const rankCounts = {};
            for (const card of hand) {
                if (!card.isJoker) rankCounts[card.rank] = (rankCounts[card.rank] || 0) + 1;
            }
            candidates.sort((a, b) => {
                // 优先还手中只有一张的点数，避免拆散自己的对子/三张
                const breakA = rankCounts[a.rank] >= 2 ? 1 : 0;
                const breakB = rankCounts[b.rank] >= 2 ? 1 : 0;
                if (breakA !== breakB) return breakA - breakB;
                return getCardSingleValue(a, this.levelCard) - getCardSingleValue(b, this.levelCard);
            });
            return candidates[0];
        }

        const candidates = hand.filter(card => !card.isJoker && card.value <= 10);
        if (candidates.length === 0) return null;
        const sorted = [...candidates].sort((a, b) => {
            const aVal = getCardSingleValue(a, this.levelCard);
            const bVal = getCardSingleValue(b, this.levelCard);
            return bVal - aVal;
        });

        return sorted[0];
    }
    
    /**
     * 执行贡牌交换（实际移动牌）
     * @param {Array} tributes - calculateTribute返回的贡牌关系数组
     */
    executeTribute(tributes) {
        if (!tributes || tributes.length === 0) {
            this.state = 'idle';
            return true;
        }
        
        for (const tribute of tributes) {
            if (!this.swapTributeCards(tribute)) return false;
        }
        
        this.state = 'idle';
        return true;
    }

    /**
     * 获取队友ID
     */
    getTeammate(playerId) {
        return (playerId + 2) % 4;
    }

    /**
     * 获取队伍
     */
    getTeam(playerId) {
        return playerId % 2 === 0 ? 'a' : 'b';
    }

    /**
     * 投降
     */
    surrender(playerId) {
        if (this.state !== 'playing') return { success: false };
        
        const team = this.getTeam(playerId);
        const winnerTeam = team === 'a' ? 'b' : 'a';
        
        this.state = 'finished';
        
        const result = {
            type: 'surrender',
            winnerTeam: winnerTeam,
            levelUp: 1,
            description: `队伍${team.toUpperCase()}投降！队伍${winnerTeam.toUpperCase()}获胜`,
            gameOver: false,
            levelBefore: this.getLevelCard(),
            finishOrder: [],
            tributes: []
        };
        
        const oldLevel = this.teamLevel[winnerTeam];
        this.teamLevel[winnerTeam] = Math.min(oldLevel + 1, 12);
        this.roundLevel = this.teamLevel[winnerTeam];
        result.levelAfter = this.getLevelCard();
        
        if (this.levelCard === 'A' && oldLevel === 12) {
            result.gameOver = true;
            this.matchOver = true;
            this.matchWinner = winnerTeam;
            result.description += ` 队伍${winnerTeam.toUpperCase()}获得最终胜利！`;
        }
        
        this.history.push({
            round: this.roundNumber,
            finishOrder: [],
            result: result,
            timestamp: new Date().toLocaleTimeString()
        });
        
        this.roundNumber++;
        
        return { success: true, type: 'roundEnd', result: result };
    }
}

// 全局引擎实例
const engine = new GameEngine();
