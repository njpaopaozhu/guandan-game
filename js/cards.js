/**
 * 掼蛋游戏 - 卡牌模块
 * 包含：卡牌定义、洗牌、发牌、牌型识别
 */

// ==================== 常量定义 ====================

// 花色
const SUITS = ['♠', '♥', '♦', '♣'];

// 点数（从小到大）
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

// 王牌
const JOKER_SMALL = '小王';
const JOKER_BIG = '大王';

// 牌型枚举
const HAND_TYPES = {
    SINGLE: '单张',
    PAIR: '对子',
    TRIPLE: '三张',
    TRIPLE_PAIR: '三带二',
    STRAIGHT: '顺子',
    DOUBLE_STRAIGHT: '双顺',
    TRIPLE_STRAIGHT: '飞机',
    PLANE_SINGLE: '飞机带单',
    PLANE_PAIR: '飞机带对',
    BOMB: '炸弹',
    STRAIGHT_FLUSH: '同花顺',
    ROCKET: '火箭',
    INVALID: '无效'
};

// 牌值映射
const RANK_VALUE = {
    '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8,
    '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14
};

// ==================== 卡牌操作 ====================

/**
 * 获取单张牌的比较值（统一函数）
 * 大王=201，小王=200，当前级牌=199，普通牌=2-14
 * @param {Object} card - 牌对象
 * @param {string} levelCard - 当前级牌（如 '5'）
 * @returns {number} 单张比较值
 */
function getCardSingleValue(card, levelCard) {
    if (card.isJoker) {
        return card.rank === JOKER_BIG ? 201 : 200;
    }
    if (card.rank === levelCard) {
        return 199; // 级牌在单张中仅次于小王
    }
    return card.value; // 2-14
}

/**
 * 创建一副牌（108张，两副扑克）
 */
function createDeck() {
    let deck = [];
    
    // 两副普通牌（每副52张）
    for (let deckNum = 0; deckNum < 2; deckNum++) {
        for (let suit of SUITS) {
            for (let rank of RANKS) {
                deck.push({
                    suit: suit,
                    rank: rank,
                    value: RANK_VALUE[rank],
                    isJoker: false,
                    id: `${suit}${rank}_${deckNum}`
                });
            }
        }
    }
    
    // 大小王各两张（共4张）
    deck.push({ suit: '', rank: JOKER_SMALL, value: 100, isJoker: true, id: 'joker_s_1' });
    deck.push({ suit: '', rank: JOKER_SMALL, value: 100, isJoker: true, id: 'joker_s_2' });
    deck.push({ suit: '', rank: JOKER_BIG, value: 101, isJoker: true, id: 'joker_b_1' });
    deck.push({ suit: '', rank: JOKER_BIG, value: 101, isJoker: true, id: 'joker_b_2' });
    
    return deck;
}

/**
 * 洗牌（Fisher-Yates算法）
 */
function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

/**
 * 发牌（每人27张）
 */
function dealCards() {
    const deck = shuffle(createDeck());
    const hands = [[], [], [], []];
    
    for (let i = 0; i < 108; i++) {
        hands[i % 4].push(deck[i]);
    }
    
    return hands;
}

/**
 * 排序手牌（从大到小）
 */
function sortHand(hand, levelCard) {
    hand.sort((a, b) => {
        // 王牌最大
        if (a.isJoker && !b.isJoker) return -1;
        if (!a.isJoker && b.isJoker) return 1;
        if (a.isJoker && b.isJoker) return b.value - a.value;
        
        // 级牌次之
        if (a.rank === levelCard && b.rank !== levelCard) return -1;
        if (b.rank === levelCard && a.rank !== levelCard) return 1;
        
        // 按点数排序
        if (a.value !== b.value) return b.value - a.value;
        
        // 按花色排序
        return SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit);
    });
}

// ==================== 牌型识别 ====================

/**
 * 识别牌型
 * @param {Array} cards - 要识别的牌
 * @param {string} levelCard - 当前级牌
 * @returns {Object} { type, value, length, valid }
 */
function identifyHand(cards, levelCard) {
    const naturalResult = identifyNaturalHand(cards, levelCard);
    if (!Array.isArray(cards) || cards.length <= 1) return naturalResult;

    const wildIndexes = [];
    cards.forEach((card, index) => {
        if (!card.isJoker && card.suit === '♥' && card.rank === levelCard) wildIndexes.push(index);
    });
    if (wildIndexes.length === 0) return naturalResult;

    let best = naturalResult;
    const assigned = [...cards];
    const candidates = [];
    for (const suit of SUITS) {
        for (const rank of RANKS) candidates.push({ suit, rank, value: RANK_VALUE[rank] });
    }

    const score = result => {
        const category = {
            [HAND_TYPES.ROCKET]: 100,
            [HAND_TYPES.BOMB]: 90,
            [HAND_TYPES.STRAIGHT_FLUSH]: 80,
            [HAND_TYPES.PLANE_PAIR]: 70,
            [HAND_TYPES.PLANE_SINGLE]: 69,
            [HAND_TYPES.TRIPLE_STRAIGHT]: 68,
            [HAND_TYPES.DOUBLE_STRAIGHT]: 60,
            [HAND_TYPES.STRAIGHT]: 50,
            [HAND_TYPES.TRIPLE_PAIR]: 40,
            [HAND_TYPES.TRIPLE]: 30,
            [HAND_TYPES.PAIR]: 20,
            [HAND_TYPES.SINGLE]: 10
        }[result.type] || 0;
        return category * 100000 + result.value;
    };

    const search = depth => {
        if (depth === wildIndexes.length) {
            const result = identifyNaturalHand(assigned, levelCard);
            if (result.valid && (!best.valid || score(result) > score(best))) {
                best = { ...result, wild: true };
            }
            return;
        }
        const index = wildIndexes[depth];
        const original = cards[index];
        for (const candidate of candidates) {
            assigned[index] = { ...original, ...candidate, isWildSubstitute: true };
            search(depth + 1);
        }
        assigned[index] = original;
    };

    search(0);
    return best;
}

function identifyNaturalHand(cards, levelCard) {
    if (!cards || cards.length === 0) {
        return { type: HAND_TYPES.INVALID, value: 0, length: 0, valid: false };
    }
    
    const len = cards.length;
    const isAllJoker = cards.every(c => c.isJoker);
    
    // 火箭（4张王）
    if (len === 4 && isAllJoker) {
        return { type: HAND_TYPES.ROCKET, value: 10000, length: 4, valid: true };
    }

    // 两副牌中同类王可以组成对子。
    if (len === 2 && isAllJoker && cards[0].rank === cards[1].rank) {
        return {
            type: HAND_TYPES.PAIR,
            value: cards[0].rank === JOKER_BIG ? 201 : 200,
            length: 2,
            valid: true
        };
    }
    
    // 统计各点数数量
    const rankCount = {};
    let jokerCount = 0;
    for (let card of cards) {
        if (card.isJoker) {
            jokerCount++;
        } else {
            rankCount[card.rank] = (rankCount[card.rank] || 0) + 1;
        }
    }
    
    const counts = Object.values(rankCount).sort((a, b) => b - a);
    const uniqueRanks = Object.keys(rankCount);
    
    // 同花顺（5张连续同花色）
    if (len === 5 && jokerCount === 0) {
        const flushCheck = checkStraightFlush(cards);
        if (flushCheck.valid) {
            return { type: HAND_TYPES.STRAIGHT_FLUSH, value: flushCheck.value, length: 5, valid: true };
        }
    }
    
    // 炸弹（4张或更多相同点数）
    if (len >= 4 && jokerCount === 0 && uniqueRanks.length === 1 && counts[0] >= 4) {
        const mainRank = uniqueRanks[0];
        // 同张数炸弹中当前级牌最大；保持点数值<100，确保张数仍是第一比较级。
        const mainValue = mainRank === levelCard ? 99 : RANK_VALUE[mainRank];
        // 炸弹先比张数，同张数再比点数。
        const value = len * 100 + mainValue;
        return { type: HAND_TYPES.BOMB, value, length: len, valid: true };
    }
    
    // 单张 — 大王(201) > 小王(200) > 级牌(199) > A(14) > K(13) > ... > 2(2)
    if (len === 1) {
        let value = getCardSingleValue(cards[0], levelCard);
        return { type: HAND_TYPES.SINGLE, value: value, length: 1, valid: true };
    }
    
    // 对子
    if (len === 2 && uniqueRanks.length === 1 && counts[0] === 2) {
        const mainValue = RANK_VALUE[uniqueRanks[0]];
        const isLevel = uniqueRanks[0] === levelCard;
        return { type: HAND_TYPES.PAIR, value: isLevel ? mainValue + 100 : mainValue, length: 2, valid: true };
    }
    
    // 三张
    if (len === 3 && uniqueRanks.length === 1 && counts[0] === 3) {
        const mainValue = RANK_VALUE[uniqueRanks[0]];
        const isLevel = uniqueRanks[0] === levelCard;
        return { type: HAND_TYPES.TRIPLE, value: isLevel ? mainValue + 100 : mainValue, length: 3, valid: true };
    }
    
    // 三带二
    if (len === 5 && counts[0] === 3 && counts[1] === 2) {
        const mainRank = uniqueRanks.find(r => rankCount[r] === 3);
        const mainValue = RANK_VALUE[mainRank];
        const isLevel = mainRank === levelCard;
        return { type: HAND_TYPES.TRIPLE_PAIR, value: isLevel ? mainValue + 100 : mainValue, length: 5, valid: true };
    }
    
    // 顺子（掜蛋顺子固定5张）
    if (len === 5 && jokerCount === 0 && uniqueRanks.length === len && counts[0] === 1) {
        const straightCheck = checkStraight(cards);
        if (straightCheck.valid) {
            return { type: HAND_TYPES.STRAIGHT, value: straightCheck.value, length: len, valid: true };
        }
    }
    
    // 木板：固定3对连续对子
    if (len === 6 && jokerCount === 0) {
        const doubleStraightCheck = checkDoubleStraight(cards, rankCount);
        if (doubleStraightCheck.valid) {
            return { type: HAND_TYPES.DOUBLE_STRAIGHT, value: doubleStraightCheck.value, length: len, valid: true };
        }
    }
    
    // 钢板：固定2个连续三张
    if (len === 6 && jokerCount === 0) {
        const tripleStraightCheck = checkTripleStraight(cards, rankCount);
        if (tripleStraightCheck.valid) {
            return { type: HAND_TYPES.TRIPLE_STRAIGHT, value: tripleStraightCheck.value, length: len, valid: true };
        }
    }
    
    return { type: HAND_TYPES.INVALID, value: 0, length: 0, valid: false };
}

/**
 * 检查是否是顺子
 */
function checkStraight(cards) {
    if (cards.length !== 5) return { valid: false, value: 0 };
    
    const sorted = [...cards].sort((a, b) => a.value - b.value);
    
    // A-2-3-4-5 中 A 按 1 计算。
    const values = sorted.map(card => card.value);
    if (values.join(',') === '2,3,4,5,14') {
        return { valid: true, value: 5 };
    }

    // 检查是否连续
    for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].value - sorted[i-1].value !== 1) {
            return { valid: false, value: 0 };
        }
    }
    
    // 返回最大牌的值
    return { valid: true, value: sorted[sorted.length - 1].value };
}

/**
 * 检查是否是同花顺
 */
function checkStraightFlush(cards) {
    if (cards.length !== 5) return { valid: false, value: 0 };
    
    // 检查是否同花色
    const suit = cards[0].suit;
    for (let card of cards) {
        if (card.suit !== suit) return { valid: false, value: 0 };
    }
    
    return checkStraight(cards);
}

/**
 * 检查是否是双顺
 */
function checkDoubleStraight(cards, rankCount) {
    // 检查是否每个点数都是2张
    for (let rank in rankCount) {
        if (rankCount[rank] !== 2) return { valid: false, value: 0 };
    }
    
    // 检查是否连续（至少3对）
    const ranks = Object.keys(rankCount).map(r => RANK_VALUE[r]).sort((a, b) => a - b);
    if (ranks.length < 3) return { valid: false, value: 0 };
    
    for (let i = 1; i < ranks.length; i++) {
        if (ranks[i] - ranks[i-1] !== 1) return { valid: false, value: 0 };
    }
    
    return { valid: true, value: ranks[ranks.length - 1] };
}

/**
 * 检查是否是三顺（飞机）
 */
function checkTripleStraight(cards, rankCount) {
    // 检查是否每个点数都是3张
    for (let rank in rankCount) {
        if (rankCount[rank] !== 3) return { valid: false, value: 0 };
    }
    
    // 检查是否连续（至少2个三张）
    const ranks = Object.keys(rankCount).map(r => RANK_VALUE[r]).sort((a, b) => a - b);
    if (ranks.length < 2) return { valid: false, value: 0 };
    
    for (let i = 1; i < ranks.length; i++) {
        if (ranks[i] - ranks[i-1] !== 1) return { valid: false, value: 0 };
    }
    
    return { valid: true, value: ranks[ranks.length - 1] };
}

/**
 * 检查是否是飞机带单
 */
function checkPlaneSingle(cards, rankCount) {
    // 找出三张的点数
    const triples = [];
    const singles = [];
    
    for (let rank in rankCount) {
        if (rankCount[rank] === 3) {
            triples.push(RANK_VALUE[rank]);
        } else if (rankCount[rank] === 1) {
            singles.push(RANK_VALUE[rank]);
        } else {
            return { valid: false, value: 0 };
        }
    }
    
    // 三张数量必须等于单张数量，且至少2个三张
    if (triples.length < 2 || triples.length !== singles.length) {
        return { valid: false, value: 0 };
    }
    
    // 检查三张是否连续
    triples.sort((a, b) => a - b);
    for (let i = 1; i < triples.length; i++) {
        if (triples[i] - triples[i-1] !== 1) return { valid: false, value: 0 };
    }
    
    return { valid: true, value: triples[triples.length - 1] };
}

/**
 * 检查是否是飞机带对
 */
function checkPlanePair(cards, rankCount) {
    // 找出三张的点数和对子
    const triples = [];
    const pairs = [];
    
    for (let rank in rankCount) {
        if (rankCount[rank] === 3) {
            triples.push(RANK_VALUE[rank]);
        } else if (rankCount[rank] === 2) {
            pairs.push(RANK_VALUE[rank]);
        } else {
            return { valid: false, value: 0 };
        }
    }
    
    // 三张数量必须等于对子数量，且至少2个三张
    if (triples.length < 2 || triples.length !== pairs.length) {
        return { valid: false, value: 0 };
    }
    
    // 检查三张是否连续
    triples.sort((a, b) => a - b);
    for (let i = 1; i < triples.length; i++) {
        if (triples[i] - triples[i-1] !== 1) return { valid: false, value: 0 };
    }
    
    return { valid: true, value: triples[triples.length - 1] };
}

/**
 * 判断是否能打过上家
 */
function canBeat(current, last) {
    if (!current.valid || !last.valid) return false;
    
    // 火箭最大
    if (current.type === HAND_TYPES.ROCKET) return last.type !== HAND_TYPES.ROCKET;
    if (last.type === HAND_TYPES.ROCKET) return false;
    
    // 标准特殊牌型层级：四王 > 6+张炸弹 > 同花顺 > 5张炸弹 > 4张炸弹。
    if (current.type === HAND_TYPES.BOMB && last.type === HAND_TYPES.STRAIGHT_FLUSH) {
        return current.length >= 6;
    }
    if (current.type === HAND_TYPES.STRAIGHT_FLUSH && last.type === HAND_TYPES.BOMB) {
        return last.length <= 5;
    }
    if (current.type === HAND_TYPES.BOMB && last.type === HAND_TYPES.BOMB) {
        return current.value > last.value;
    }
    if (current.type === HAND_TYPES.STRAIGHT_FLUSH && last.type !== HAND_TYPES.STRAIGHT_FLUSH) return true;
    if (last.type === HAND_TYPES.STRAIGHT_FLUSH && current.type !== HAND_TYPES.STRAIGHT_FLUSH) return false;
    if (current.type === HAND_TYPES.BOMB && last.type !== HAND_TYPES.BOMB) return true;
    if (last.type === HAND_TYPES.BOMB && current.type !== HAND_TYPES.BOMB) return false;
    
    // 同类型比大小
    if (current.type === last.type && current.length === last.length) {
        return current.value > last.value;
    }
    
    return false;
}
