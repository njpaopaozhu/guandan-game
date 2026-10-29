/**
 * 掼蛋游戏 - Node.js 核心功能测试脚本
 * 使用 eval 加载浏览器风格的 JS 文件
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// 模拟浏览器环境
global.document = { getElementById: () => ({ querySelector: () => null, classList: { add: () => {}, remove: () => {} } }) };
global.window = { onload: null };

// 加载游戏模块（使用 vm.runInThisContext 使 class/function 在全局可用）
const cardsCode = fs.readFileSync(path.join(__dirname, 'js/cards.js'), 'utf8');
vm.runInThisContext(cardsCode, { filename: 'cards.js' });

const engineCode = fs.readFileSync(path.join(__dirname, 'js/engine.js'), 'utf8');
vm.runInThisContext(engineCode, { filename: 'engine.js' });

const policyWeightsCode = fs.readFileSync(path.join(__dirname, 'js/ai-policy-weights.js'), 'utf8');
vm.runInThisContext(policyWeightsCode, { filename: 'ai-policy-weights.js' });
const policyCode = fs.readFileSync(path.join(__dirname, 'js/ai-policy.js'), 'utf8');
vm.runInThisContext(policyCode, { filename: 'ai-policy.js' });

const humanProfileCode = fs.readFileSync(path.join(__dirname, 'js/human-profile.js'), 'utf8');
vm.runInThisContext(humanProfileCode, { filename: 'human-profile.js' });

const aiCode = fs.readFileSync(path.join(__dirname, 'js/ai.js'), 'utf8');
vm.runInThisContext(aiCode, { filename: 'ai.js' });

const gameCode = fs.readFileSync(path.join(__dirname, 'js/game.js'), 'utf8');
vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'js/strategy-storage.js'), 'utf8'), { filename: 'strategy-storage.js' });
vm.runInThisContext(gameCode, { filename: 'game.js' });

let passCount = 0;
let failCount = 0;

function assert(condition, msg) {
    if (condition) {
        console.log(`  ✓ ${msg}`);
        passCount++;
    } else {
        console.log(`  ✗ FAIL: ${msg}`);
        failCount++;
    }
}

console.log('=== 掼蛋游戏核心功能测试 ===\n');

// ==================== A. 牌级权重测试 ====================

console.log('A. 牌级权重测试\n');

// 测试A1: getCardSingleValue 函数存在且正确
console.log('测试A1: getCardSingleValue 统一函数');
const levelCard5 = '5';
const bigJoker = { suit: '', rank: '大王', value: 101, isJoker: true, id: 'joker_b_1' };
const smallJoker = { suit: '', rank: '小王', value: 100, isJoker: true, id: 'joker_s_1' };
const fiveCard = { suit: '♠', rank: '5', value: 5, isJoker: false, id: '♠5_0' };
const aceCard = { suit: '♠', rank: 'A', value: 14, isJoker: false, id: '♠A_0' };
const kingCard = { suit: '♠', rank: 'K', value: 13, isJoker: false, id: '♠K_0' };

const bigJokerVal = getCardSingleValue(bigJoker, levelCard5);
const smallJokerVal = getCardSingleValue(smallJoker, levelCard5);
const fiveVal = getCardSingleValue(fiveCard, levelCard5);
const aceVal = getCardSingleValue(aceCard, levelCard5);

assert(bigJokerVal === 201, `大王值=${bigJokerVal} (应201)`);
assert(smallJokerVal === 200, `小王值=${smallJokerVal} (应200)`);
assert(fiveVal === 199, `级牌5值=${fiveVal} (应199)`);
assert(aceVal === 14, `A值=${aceVal} (应14)`);
assert(bigJokerVal > smallJokerVal, '大王 > 小王');
assert(smallJokerVal > fiveVal, '小王 > 级牌5');
assert(fiveVal > aceVal, '级牌5 > A');

// 测试A2: identifyHand 单张使用 getCardSingleValue
console.log('\n测试A2: identifyHand 单张级牌加权');
const fiveType = identifyHand([fiveCard], levelCard5);
const aceType = identifyHand([aceCard], levelCard5);
assert(fiveType.value === 199, `级牌5单张值=${fiveType.value} (应199)`);
assert(aceType.value === 14, `A单张值=${aceType.value} (应14)`);
assert(canBeat(fiveType, aceType), '级牌5能压过A');
assert(!canBeat(aceType, fiveType), 'A不能压过级牌5');

// 测试A3: AI findSingles 使用统一函数
console.log('\n测试A3: AI findSingles 使用 getCardSingleValue');
const testHand = [bigJoker, smallJoker, fiveCard, aceCard, kingCard];
const singles = findSingles(testHand, 14, levelCard5);
assert(singles.length === 3, `找大于A的单张: ${singles.length}个 (应3: 大王、小王、级牌5)`);
const hasLevelCard = singles.some(s => s[0].rank === '5');
assert(hasLevelCard, 'findSingles能找到级牌5压过A');

// 测试A4: 炸弹同张数时级牌最大，张数仍优先
console.log('\n测试A4: 级牌炸弹比较');
const levelBomb = ['♠', '♥', '♦', '♣'].map((suit, index) => normalCard('5', suit, `level-bomb-${index}`));
const aceBomb = ['♠', '♥', '♦', '♣'].map((suit, index) => normalCard('A', suit, `ace-bomb-${index}`));
const fiveCardTwoBomb = [0, 1, 2, 3, 4].map((_, index) => normalCard('2', SUITS[index % 4], `five-two-${index}`));
assert(canBeat(identifyHand(levelBomb, '5'), identifyHand(aceBomb, '5')),
    '同为四张炸弹时，当前级牌炸弹能压过A炸弹');
assert(!canBeat(identifyHand(aceBomb, '5'), identifyHand(levelBomb, '5')),
    'A炸弹不能反压同张数的当前级牌炸弹');
assert(canBeat(identifyHand(fiveCardTwoBomb, '5'), identifyHand(levelBomb, '5')),
    '炸弹仍先比较张数，五张2能压过四张级牌');

// ==================== B. 升级机制测试 ====================

console.log('\nB. 升级机制测试\n');

// 测试B1: 双上升3级
console.log('测试B1: 双上升3级');
const engine1 = new GameEngine();
engine1.reset();
engine1.startRound();
engine1.finishOrder = [0, 2, 1, 3]; // 玩家0和2（A队）包揽前两名
engine1.playerFinished = [true, true, true, true];
const result1 = engine1.endRound();
assert(result1.result.type === 'double_win', `胜负类型: ${result1.result.type} (应double_win)`);
assert(result1.result.levelUp === 3, `升级数: ${result1.result.levelUp} (应3)`);
assert(engine1.teamLevel.a === 3, `A队级别: ${engine1.teamLevel.a} (应3, 从0升3)`);
assert(result1.result.levelBefore === '2', `升级前: ${result1.result.levelBefore} (应2)`);
assert(result1.result.levelAfter === '5', `升级后: ${result1.result.levelAfter} (应5)`);

// 测试B2: 头游对末游升2级
console.log('\n测试B2: 头游对末游升2级');
const engine2 = new GameEngine();
engine2.reset();
engine2.startRound();
engine2.finishOrder = [0, 1, 2, 3]; // A队头游(0)，B队末游(3)
engine2.playerFinished = [true, true, true, true];
const result2 = engine2.endRound();
assert(result2.result.type === 'head_tail', `胜负类型: ${result2.result.type} (应head_tail)`);
assert(result2.result.levelUp === 2, `升级数: ${result2.result.levelUp} (应2)`);
assert(engine2.teamLevel.a === 2, `A队级别: ${engine2.teamLevel.a} (应2)`);

// 测试B3: 普通胜利升1级
console.log('\n测试B3: 普通胜利升1级');
const engine3 = new GameEngine();
engine3.reset();
engine3.startRound();
engine3.finishOrder = [0, 1, 3, 2]; // A队头游(0)，A队末游(2)=队友末游
engine3.playerFinished = [true, true, true, true];
const result3 = engine3.endRound();
assert(result3.result.type === 'normal_win', `胜负类型: ${result3.result.type} (应normal_win)`);
assert(result3.result.levelUp === 1, `升级数: ${result3.result.levelUp} (应1)`);
assert(engine3.teamLevel.a === 1, `A队级别: ${engine3.teamLevel.a} (应1)`);

// 测试B4: K升级到A后必须实际打A级
console.log('\n测试B4: A级必打');
const engine4 = new GameEngine();
engine4.reset();
engine4.teamLevel.a = 11; // K级别
engine4.startRound();
engine4.finishOrder = [0, 2, 1, 3]; // 双上
engine4.playerFinished = [true, true, true, true];
const result4 = engine4.endRound();
assert(engine4.teamLevel.a === 12, `A队级别: ${engine4.teamLevel.a} (应12=A, 不能超)`);
assert(result4.result.gameOver !== true && !engine4.matchOver, 'K升到A只获得打A级资格，不能直接结束');
const aceRound = engine4.startRound();
assert(aceRound.levelCard === 'A', 'K升级后的下一局必须实际打A');

// 测试B5: 下一局级牌由上游方升级结果决定
console.log('\n测试B5: getLevelCard 使用本局级别');
const engine5 = new GameEngine();
engine5.reset();
engine5.teamLevel.a = 3; // 打5
engine5.teamLevel.b = 5; // 打7
engine5.roundLevel = 3;
const levelCard = engine5.getLevelCard();
assert(levelCard === '5', `级牌: ${levelCard} (应5, 由上游方级别决定)`);

// 测试B6: A级局头游且队友不是末游才真正过A
console.log('\n测试B6: 过A成功');
const acePassEngine = new GameEngine();
acePassEngine.reset();
acePassEngine.teamLevel.a = 12;
acePassEngine.roundLevel = 12;
acePassEngine.startRound();
acePassEngine.finishOrder = [0, 1, 2, 3];
acePassEngine.playerFinished = [true, true, true, true];
const acePassResult = acePassEngine.endRound();
assert(acePassResult.result.gameOver === true && acePassEngine.matchWinner === 'a',
    'A级局取得头游且队友不是末游，过A成功');
assert(acePassResult.result.tributes.length === 0, '真正过A后没有下一局，不生成贡牌');

// 测试B7: A级局队友末游时过A失败
console.log('\n测试B7: 过A失败继续打A');
const aceFailEngine = new GameEngine();
aceFailEngine.reset();
aceFailEngine.teamLevel.a = 12;
aceFailEngine.roundLevel = 12;
aceFailEngine.startRound();
aceFailEngine.finishOrder = [0, 1, 3, 2];
aceFailEngine.playerFinished = [true, true, true, true];
const aceFailResult = aceFailEngine.endRound();
assert(aceFailResult.result.gameOver !== true && !aceFailEngine.matchOver,
    'A级局虽获头游但队友末游，不能过A');
assert(aceFailEngine.startRound().levelCard === 'A', '过A失败后继续打A');

// 测试B8: 对方不能借别人的A级局直接越过A
console.log('\n测试B8: 对方到A仍需再打A级');
const opponentAceEngine = new GameEngine();
opponentAceEngine.reset();
opponentAceEngine.teamLevel.a = 12;
opponentAceEngine.teamLevel.b = 11;
opponentAceEngine.roundLevel = 12;
opponentAceEngine.startRound();
opponentAceEngine.finishOrder = [1, 3, 0, 2];
opponentAceEngine.playerFinished = [true, true, true, true];
const opponentAceResult = opponentAceEngine.endRound();
assert(opponentAceEngine.teamLevel.b === 12 && opponentAceResult.result.gameOver !== true,
    '对方在A级牌局中从K升到A，仍不能立即结束');

// ==================== C. 末家进贡/还牌测试 ====================

console.log('\nC. 末家进贡/还牌测试\n');

// 测试C1: 普通胜利末游向头游进贡
console.log('测试C1: 普通胜利贡牌计算');
const engine6 = new GameEngine();
engine6.reset();
engine6.startRound();
// 给玩家3（末游）一些牌，给玩家0（头游）一些牌
engine6.hands[3] = [
    { suit: '♠', rank: 'A', value: 14, isJoker: false, id: '♠A_1' },
    { suit: '♥', rank: 'K', value: 13, isJoker: false, id: '♥K_1' }
];
engine6.hands[0] = [
    { suit: '♠', rank: '2', value: 2, isJoker: false, id: '♠2_1' },
    { suit: '♥', rank: '3', value: 3, isJoker: false, id: '♥3_1' }
];
engine6.finishOrder = [0, 1, 2, 3]; // 普通胜利
engine6.playerFinished = [true, true, true, true];
const result6 = engine6.endRound();
assert(result6.result.tributes.length === 1, `贡牌关系数: ${result6.result.tributes.length} (应1)`);
const tribute6 = result6.result.tributes[0];
assert(tribute6.from === 3, `贡牌方: ${tribute6.from} (应3=末游)`);
assert(tribute6.to === 0, `接收方: ${tribute6.to} (应0=头游)`);
assert(tribute6.tributeCard.rank === 'A', `贡牌: ${tribute6.tributeCard.rank} (应A=最大)`);

// 测试C2: 执行贡牌交换（实际移动牌）
console.log('\n测试C2: executeTribute 实际交换牌');
const engine7 = new GameEngine();
engine7.reset();
engine7.levelCard = '2';
engine7.hands[3] = [
    { suit: '♠', rank: 'A', value: 14, isJoker: false, id: '♠A_test' },
    { suit: '♥', rank: 'K', value: 13, isJoker: false, id: '♥K_test' }
];
engine7.hands[0] = [
    { suit: '♠', rank: '2', value: 2, isJoker: false, id: '♠2_test' },
    { suit: '♥', rank: '3', value: 3, isJoker: false, id: '♥3_test' }
];
engine7.state = 'finished';
const tributes7 = [
    {
        from: 3,
        to: 0,
        tributeCard: { suit: '♠', rank: 'A', value: 14, isJoker: false, id: '♠A_test' },
        returnCard: { suit: '♥', rank: '3', value: 3, isJoker: false, id: '♥3_test' }
    }
];
engine7.executeTribute(tributes7);
const hasAInPlayer0 = engine7.hands[0].some(c => c.id === '♠A_test');
const has3InPlayer3 = engine7.hands[3].some(c => c.id === '♥3_test');
const noAInPlayer3 = !engine7.hands[3].some(c => c.id === '♠A_test');
const no3InPlayer0 = !engine7.hands[0].some(c => c.id === '♥3_test');
assert(hasAInPlayer0, '玩家0收到贡牌A');
assert(has3InPlayer3, '玩家3收到还牌3');
assert(noAInPlayer3, '玩家3失去贡牌A');
assert(no3InPlayer0, '玩家0失去还牌3');
assert(engine7.state === 'idle', `状态: ${engine7.state} (应idle)`);

// 测试C3: 双上时双下两人分别进贡
console.log('\n测试C3: 双上对应双贡');
const engine8 = new GameEngine();
engine8.reset();
engine8.startRound();
engine8.finishOrder = [0, 2, 1, 3]; // 双上
engine8.playerFinished = [true, true, true, true];
const result8 = engine8.endRound();
assert(result8.result.tributes.length === 2, `双上贡牌关系数: ${result8.result.tributes.length} (应2)`);

// 测试C4: 空手牌不崩溃
console.log('\n测试C4: 空手牌安全处理');
const engine9 = new GameEngine();
engine9.reset();
engine9.levelCard = '2';
engine9.hands[3] = [];
engine9.hands[0] = [];
engine9.state = 'finished';
const tributes9 = [];
const result9 = engine9.executeTribute(tributes9);
assert(result9 === true, '空贡牌数组不崩溃');
assert(engine9.state === 'idle', '状态正常转为idle');

// 测试C5: 上一局留下的贡牌关系在新手牌上真正执行
console.log('\n测试C5: 跨局贡还牌实际执行');
const engine10 = new GameEngine();
engine10.reset();
engine10.levelCard = '2';
engine10.hands[3] = [
    { suit: '♠', rank: 'A', value: 14, isJoker: false, id: 'flow_A' },
    { suit: '♣', rank: 'K', value: 13, isJoker: false, id: 'flow_K' }
];
engine10.hands[0] = [
    { suit: '♠', rank: '10', value: 10, isJoker: false, id: 'flow_10' },
    { suit: '♣', rank: '3', value: 3, isJoker: false, id: 'flow_3' }
];
engine10.hands[1] = [];
engine10.hands[2] = [];
engine10.pendingTributes = [{ from: 3, to: 0 }];
const appliedTributes = engine10.applyPendingTributes();
assert(appliedTributes.length === 1, '下一局发牌后生成一组实际贡还牌结果');
assert(appliedTributes[0].tributeCard.id === 'flow_A', '进贡方交出最大牌A');
// 还牌对象是对手，v2策略还最小牌（3 < 10）而非旧逻辑的最大牌，避免资敌
assert(appliedTributes[0].returnCard.id === 'flow_3', '受贡方还给对手最小牌3（不高于10）');
assert(engine10.hands[0].some(card => card.id === 'flow_A')
    && engine10.hands[3].some(card => card.id === 'flow_3'), '贡牌和还牌已在双方手牌中交换');
assert(engine10.pendingTributes.length === 0, '实际交换后清空待进贡状态，避免重复执行');

// 测试C6: 两张大王抗贡
console.log('\n测试C6: 两张大王抗贡');
const engine11 = new GameEngine();
engine11.reset();
engine11.hands[3] = [
    { suit: '', rank: JOKER_BIG, value: 101, isJoker: true, id: 'resist_big_1' },
    { suit: '', rank: JOKER_BIG, value: 101, isJoker: true, id: 'resist_big_2' }
];
engine11.hands[0] = [{ suit: '♣', rank: '3', value: 3, isJoker: false, id: 'resist_3' }];
engine11.hands[1] = [];
engine11.hands[2] = [];
engine11.pendingTributes = [{ from: 3, to: 0 }];
const resistedTributes = engine11.applyPendingTributes();
assert(resistedTributes.length === 0 && engine11.lastTributeResisted, '贡方持两张大王时抗贡，不交换手牌');
assert(engine11.tributeOpeningPlayer === 0, '抗贡后由原受贡方先出牌');

// 测试C7: 真人受贡时暂停并自主选择还牌
console.log('\n测试C7: 真人选择还牌');
const engine12 = new GameEngine();
engine12.reset();
engine12.levelCard = '2';
engine12.hands[3] = [
    { suit: '♠', rank: 'A', value: 14, isJoker: false, id: 'manual_A' },
    { suit: '♣', rank: 'K', value: 13, isJoker: false, id: 'manual_K' }
];
engine12.hands[0] = [
    { suit: '♠', rank: '10', value: 10, isJoker: false, id: 'manual_10' },
    { suit: '♣', rank: 'Q', value: 12, isJoker: false, id: 'manual_Q' }
];
engine12.hands[1] = [];
engine12.hands[2] = [];
engine12.pendingTributes = [{ from: 3, to: 0 }];
const deferredTributes = engine12.applyPendingTributes({ deferPlayerReturn: true });
engine12.lastTributeExchanges = deferredTributes;
engine12.state = 'tribute';
assert(deferredTributes.length === 0 && engine12.pendingPlayerReturns.length === 1,
    '真人是受贡方时暂停自动交换并进入待还牌状态');
assert(!engine12.completePlayerReturn('manual_Q').success, '拒绝用高于10的牌还牌');
const manualReturnResult = engine12.completePlayerReturn('manual_10');
assert(manualReturnResult.success && engine12.state === 'playing', '选择合法牌后完成还牌并进入出牌阶段');
assert(engine12.hands[0].some(card => card.id === 'manual_A')
    && engine12.hands[3].some(card => card.id === 'manual_10'), '真人选择的还牌与贡牌实际交换');

// 测试C8: 双贡由贡牌较大的一方先出
console.log('\n测试C8: 双贡先手判定');
const doubleOpeningPlayer = engine12.getTributeOpeningPlayer([
    { from: 3, to: 0, tributeCard: { suit: '♠', rank: 'K', value: 13, isJoker: false, id: 'open_K' } },
    { from: 1, to: 2, tributeCard: { suit: '♠', rank: 'A', value: 14, isJoker: false, id: 'open_A' } }
]);
assert(doubleOpeningPlayer === 1, '双贡时进贡牌更大的玩家先出牌');

// ==================== 原有测试 ====================

console.log('\nD. 原有功能测试\n');

// 测试D1: 创建牌组
console.log('测试D1: 创建牌组');
const deck = createDeck();
assert(deck.length === 108, `牌组数量: ${deck.length} (应该108)`);
assert(deck.filter(c => c.isJoker).length === 4, `大小王数量: ${deck.filter(c => c.isJoker).length} (应该4)`);

// 测试D2: 洗牌
console.log('\n测试D2: 洗牌');
const shuffled = shuffle([...deck]);
assert(shuffled.length === 108, `洗牌后数量: ${shuffled.length}`);

// 测试D3: 发牌
console.log('\n测试D3: 发牌');
const hands = dealCards();
assert(hands[0].length === 27, `玩家0手牌: ${hands[0].length}张`);
assert(hands[1].length === 27, `玩家1手牌: ${hands[1].length}张`);
assert(hands[2].length === 27, `玩家2手牌: ${hands[2].length}张`);
assert(hands[3].length === 27, `玩家3手牌: ${hands[3].length}张`);

// 测试D4: 大小王单张比较
console.log('\n测试D4: 大小王单张比较');
const bigJokerType = identifyHand([bigJoker], '2');
const smallJokerType = identifyHand([smallJoker], '2');
const aceType2 = identifyHand([aceCard], '2');
assert(bigJokerType.value > smallJokerType.value, '大王 > 小王');
assert(smallJokerType.value > aceType2.value, '小王 > A');
assert(canBeat(bigJokerType, aceType2), '大王能压过A');
assert(!canBeat(aceType2, bigJokerType), 'A不能压过大王');

// 测试D5: 游戏引擎
console.log('\n测试D5: 游戏引擎');
const engine = new GameEngine();
engine.reset();
const result = engine.startRound();
assert(engine.state === 'playing', `游戏状态: ${engine.state}`);
assert(result.levelCard === '2', `当前级牌: ${result.levelCard}`);

// 测试D6: AI决策
console.log('\n测试D6: AI决策');
const aiCards = aiDecidePlay(1, engine);
if (aiCards && aiCards.length > 0) {
    const aiType = identifyHand(aiCards, engine.levelCard);
    assert(aiType.valid, `AI出牌牌型有效: ${aiType.type}`);
} else {
    console.log('  AI选择过牌');
}

// 测试D7: 推荐出牌
console.log('\n测试D7: 推荐出牌');
const testHand2 = [...engine.hands[0]];
const recFree = recommendPlay(testHand2, null, engine.levelCard);
assert(recFree && recFree.length > 0, `自由出牌推荐: ${recFree ? recFree.length + '张' : 'null'}`);

// ==================== E. 边界回归测试 ====================

console.log('\nE. 边界回归测试\n');

function normalCard(rank, suit = '♠', suffix = Math.random().toString(36).slice(2)) {
    return { suit, rank, value: RANK_VALUE[rank], isJoker: false, id: `${suit}${rank}_${suffix}` };
}

const strategicLeadHand = [
    ...['3', '3', '4', '4', '5', '5'].map((rank, i) => normalCard(rank, SUITS[i % 4], `plan-pair${i}`)),
    normalCard('6', '♠', 'plan-six'),
    normalCard('7', '♦', 'plan-seven')
];
const strategicLead = aiFreePlay(strategicLeadHand, 1, { levelCard: '9' });
assert(strategicLead.length === 1 && strategicLead[0].rank === '6',
    'AI在334455双顺外还有6、7时先清较小孤张6，不把两张小单留到最后');

const preserveTripleHand = [
    ...Array.from({ length: 3 }, (_, i) => normalCard('5', SUITS[i], `keep-triple${i}`)),
    normalCard('6', '♠', 'keep-pair-a'),
    normalCard('6', '♥', 'keep-pair-b')
];
const pairFourType = identifyHand([
    normalCard('4', '♠', 'last-pair-a'),
    normalCard('4', '♥', 'last-pair-b')
], '9');
const strategicFollowEngine = {
    levelCard: '9',
    lastPlayer: 0,
    lastPlayType: pairFourType,
    hands: [Array(8).fill(null), preserveTripleHand, Array(8).fill(null), Array(8).fill(null)],
    playerFinished: [false, false, false, false],
    getTeam: id => id % 2 === 0 ? 'a' : 'b'
};
const strategicPairFollow = aiFollowPlay(preserveTripleHand, 1, strategicFollowEngine, 3);
assert(strategicPairFollow && strategicPairFollow.every(card => card.rank === '6'),
    'AI跟对子时选择66并保留555三张，而不是机械出最小对子55');

const preserveBombHand = [
    ...Array.from({ length: 4 }, (_, i) => normalCard('5', SUITS[i], `keep-bomb${i}`)),
    normalCard('6', '♠', 'keep-bomb-six'),
    ...['8', '9', '10', 'J'].map((rank, i) => normalCard(rank, SUITS[i % 4], `keep-bomb-extra${i}`))
];
strategicFollowEngine.lastPlayType = identifyHand([normalCard('4', '♠', 'last-single-four')], '9');
strategicFollowEngine.hands[1] = preserveBombHand;
const strategicSingleFollow = aiFollowPlay(preserveBombHand, 1, strategicFollowEngine, 3);
assert(strategicSingleFollow && strategicSingleFollow[0].rank === '6',
    'AI跟单张时优先出6，避免拆开四张5炸弹');

const usefulStraightHand = [
    ...['3', '4', '5', '6', '7'].map((rank, i) => normalCard(rank, SUITS[i % 4], `useful-straight${i}`)),
    normalCard('9', '♠', 'useful-pair-a'),
    normalCard('9', '♥', 'useful-pair-b')
];
const usefulStraightPlay = aiFreePlay(usefulStraightHand, 1, { levelCard: 'K' });
assert(identifyHand(usefulStraightPlay, 'K').type === HAND_TYPES.STRAIGHT,
    '顺子确实能减少剩余手数时，AI仍会合理选择顺子');

const wheel = ['A', '2', '3', '4', '5'].map((rank, index) => normalCard(rank, SUITS[index % SUITS.length], `wheel${index}`));
assert(identifyHand(wheel, '7').type === HAND_TYPES.STRAIGHT, 'A-2-3-4-5 识别为顺子');
const sixStraight = ['3', '4', '5', '6', '7', '8'].map((rank, index) => normalCard(rank, '♠', `six${index}`));
assert(!identifyHand(sixStraight, '9').valid, '6张连牌不误判为顺子');
const fourPairs = ['3', '4', '5', '6'].flatMap((rank, i) => [normalCard(rank, '♠', `pair${i}a`), normalCard(rank, '♥', `pair${i}b`)]);
assert(!identifyHand(fourPairs, '9').valid, '4连对不误判为标准木板');
const threeTriples = ['3', '4', '5'].flatMap((rank, i) => Array.from({ length: 3 }, (_, j) => normalCard(rank, SUITS[j], `triple${i}${j}`)));
assert(!identifyHand(threeTriples, '9').valid, '3连三不误判为标准钢板');

const bomb4A = Array.from({ length: 4 }, (_, i) => normalCard('A', SUITS[i], `b4a${i}`));
const bomb5Three = Array.from({ length: 5 }, (_, i) => normalCard('3', SUITS[i % 4], `b53${i}`));
const straightFlush = ['3', '4', '5', '6', '7'].map((rank, i) => normalCard(rank, '♥', `sf${i}`));
const bomb6Three = Array.from({ length: 6 }, (_, i) => normalCard('3', SUITS[i % 4], `b63${i}`));
assert(canBeat(identifyHand(bomb5Three, '9'), identifyHand(bomb4A, '9')), '5张炸弹压4张A炸');
assert(canBeat(identifyHand(straightFlush, '9'), identifyHand(bomb5Three, '9')), '同花顺压5张炸弹');
assert(canBeat(identifyHand(bomb6Three, '9'), identifyHand(straightFlush, '9')), '6张炸弹压同花顺');

const guardEngine = new GameEngine();
guardEngine.startRound();
const originalLength = guardEngine.hands[0].length;
const fakeCard = normalCard('3', '♠', 'not-in-hand');
assert(!guardEngine.playCards(0, [fakeCard]).success, '拒绝不属于手牌的牌');
const repeated = guardEngine.hands[0][0];
assert(!guardEngine.playCards(0, [repeated, repeated, repeated, repeated]).success, '拒绝重复ID伪造炸弹');
assert(guardEngine.hands[0].length === originalLength, '非法出牌不修改手牌');

const finishEngine = new GameEngine();
finishEngine.startRound();
finishEngine.hands = [[normalCard('3', '♠', 'last0')], [], [], [normalCard('4', '♠', 'last3')]];
finishEngine.playerFinished = [false, true, true, false];
finishEngine.finishOrder = [1, 2];
finishEngine.currentPlayer = 0;
const finishResult = finishEngine.playCards(0, [...finishEngine.hands[0]]);
assert(finishResult.type === 'roundEnd' && finishResult.handType.type === HAND_TYPES.SINGLE, '最后一手返回结算与牌型');
assert(finishResult.result.finishOrder.length === 4, '结算结果包含完整名次');

const windEngine = new GameEngine();
windEngine.startRound();
windEngine.playerFinished = [true, false, false, false];
windEngine.lastPlayer = 0;
windEngine.lastPlay = [normalCard('A', '♠', 'wind')];
windEngine.lastPlayType = identifyHand(windEngine.lastPlay, windEngine.levelCard);
windEngine.currentPlayer = 1;
windEngine.passCards(1);
windEngine.passCards(2);
const windResult = windEngine.passCards(3);
assert(windResult.type === 'newRound' && windEngine.currentPlayer === 2, '出完后由队友接风');

const jokerPair = [
    { suit: '', rank: JOKER_SMALL, value: 100, isJoker: true, id: 'js_a' },
    { suit: '', rank: JOKER_SMALL, value: 100, isJoker: true, id: 'js_b' }
];
assert(identifyHand(jokerPair, '2').type === HAND_TYPES.PAIR, '两张小王识别为对子');
assert(findBestPair(jokerPair, '2').length === 2, 'AI可处理只剩王对的手牌');

const duplicateFlushHand = ['3', '3', '4', '4', '5', '5', '6', '6', '7', '7']
    .map((rank, i) => normalCard(rank, '♥', `dup${i}`));
assert(findAllStraightFlushes(duplicateFlushHand, '9').length > 0, 'AI不因双副牌重复点数漏掉同花顺');
const bomb8 = Array.from({ length: 8 }, (_, i) => normalCard('6', SUITS[i % 4], `b8${i}`));
assert(findAllBombs(bomb8, '9').some(cards => cards.length === 8), 'AI可搜索7/8张炸弹');

const nineCardWildcardBomb = [
    ...Array.from({ length: 8 }, (_, index) => normalCard('9', SUITS[index % 4], `b9-${index}`)),
    normalCard('5', '♥', 'b9-wild')
];
assert(findWildcardBombs(nineCardWildcardBomb, '5').some(cards => cards.length === 9),
    'AI可搜索8张自然牌加百搭形成的9张炸弹');
assert(aiFreePlay(nineCardWildcardBomb, 1, { levelCard: '5' }).length === 9,
    '整手是9张百搭炸弹时AI会直接走完，不会留下红桃级牌');

const wildFive = normalCard('5', '♥', 'wild-five');
const wildPair = [wildFive, normalCard('8', '♠', 'wild-pair')];
assert(identifyHand(wildPair, '5').type === HAND_TYPES.PAIR, '红桃级牌可作通配组对');
const wildStraight = [wildFive, ...['6', '7', '8', '10'].map((rank, i) => normalCard(rank, SUITS[i], `wild-straight${i}`))];
assert(identifyHand(wildStraight, '5').type === HAND_TYPES.STRAIGHT, '红桃级牌可补顺子');
const wildBomb = [wildFive, ...Array.from({ length: 3 }, (_, i) => normalCard('9', SUITS[i], `wild-bomb${i}`))];
assert(identifyHand(wildBomb, '5').type === HAND_TYPES.BOMB, '红桃级牌可补炸弹');
assert(findWildcardBombs(wildBomb, '5').some(cards => cards.length === 4),
    'AI定向搜索可用红桃百搭补四张炸弹');

const twoWildBombHand = [
    normalCard('5', '♥', 'wild-bomb-double-a'),
    normalCard('5', '♥', 'wild-bomb-double-b'),
    normalCard('Q', '♠', 'wild-bomb-q-a'),
    normalCard('Q', '♦', 'wild-bomb-q-b')
];
const twoWildBomb = findWildcardBombs(twoWildBombHand, '5')
    .find(cards => cards.length === 4);
assert(twoWildBomb && new Set(twoWildBomb.map(card => card.id)).size === 4,
    'AI可用两张百搭补炸弹且不会重复使用同一张牌');

const wildcardFlushHand = [
    normalCard('5', '♥', 'wild-flush-card'),
    ...['8', '9', '10', 'Q'].map((rank, i) => normalCard(rank, '♠', `wild-flush${i}`)),
    ...['2', '3', '6', 'K', 'A'].map((rank, i) => normalCard(rank, SUITS[i % 4], `wild-flush-extra${i}`))
];
assert(findWildcardStraightFlushes(wildcardFlushHand, '5').some(cards => {
    return identifyHand(cards, '5').type === HAND_TYPES.STRAIGHT_FLUSH;
}), 'AI定向搜索可用红桃百搭补同花顺');

const twoWildFlushHand = [
    normalCard('5', '♥', 'wild-flush-double-a'),
    normalCard('5', '♥', 'wild-flush-double-b'),
    ...['8', '10', 'Q'].map((rank, i) => normalCard(rank, '♣', `wild-flush-double${i}`))
];
assert(findWildcardStraightFlushes(twoWildFlushHand, '5').some(cards => {
    return identifyHand(cards, '5').type === HAND_TYPES.STRAIGHT_FLUSH;
}), 'AI可用两张百搭补同花顺的两个缺口');

const lastEightBomb = identifyHand(
    Array.from({ length: 4 }, (_, i) => normalCard('8', SUITS[i], `last-eight${i}`)),
    '5'
);
const longWildcardBombHand = [
    normalCard('5', '♥', 'long-wild-bomb'),
    ...Array.from({ length: 3 }, (_, i) => normalCard('9', SUITS[i], `long-nine${i}`)),
    ...['2', '3', '4', '6', '7', '10', 'J', 'Q', 'K'].map((rank, i) => normalCard(rank, SUITS[i % 4], `long-extra${i}`))
];
const longBombEngine = {
    levelCard: '5',
    lastPlayer: 0,
    lastPlayType: lastEightBomb,
    hands: [Array(9).fill(null), longWildcardBombHand, Array(9).fill(null), Array(9).fill(null)],
    playerFinished: [false, false, false, false],
    getTeam: id => id % 2 === 0 ? 'a' : 'b'
};
const longWildcardBombPlay = aiFollowPlay(longWildcardBombHand, 1, longBombEngine, 3);
assert(longWildcardBombPlay
    && longWildcardBombPlay.some(card => isWildLevelCard(card, '5'))
    && identifyHand(longWildcardBombPlay, '5').type === HAND_TYPES.BOMB,
    'AI手牌超过8张时仍会用百搭炸弹压较小炸弹');

const urgentWildcardPairHand = [
    normalCard('5', '♥', 'urgent-pair-wild'),
    normalCard('Q', '♠', 'urgent-pair-q'),
    ...['2', '3', '4', '6', '7', '8', '9', '10', 'K'].map((rank, index) => (
        normalCard(rank, SUITS[index % 4], `urgent-pair-extra-${index}`)
    ))
];
const urgentLastPair = [
    normalCard('J', '♠', 'urgent-last-j-a'),
    normalCard('J', '♦', 'urgent-last-j-b')
];
const urgentWildcardPairEngine = {
    levelCard: '5',
    lastPlay: urgentLastPair,
    lastPlayType: identifyHand(urgentLastPair, '5'),
    lastPlayer: 0,
    currentPlayer: 1,
    hands: [[normalCard('3', '♣', 'urgent-leader-last')], urgentWildcardPairHand,
        Array(9).fill(null), Array(9).fill(null)],
    playerFinished: [false, false, false, false],
    playedCards: urgentLastPair,
    passMemory: [],
    passCount: 0,
    getTeam: id => id % 2,
    getTeammate: id => (id + 2) % 4,
    getStrategyMode: () => 'v3',
    aiPolicyMode: 'legacy'
};
const urgentWildcardPairPlay = aiDecidePlay(1, urgentWildcardPairEngine);
assert(urgentWildcardPairPlay
    && urgentWildcardPairPlay.some(card => isWildLevelCard(card, '5'))
    && identifyHand(urgentWildcardPairPlay, '5').type === HAND_TYPES.PAIR,
    '默认v3在对手仅剩1张时会用红桃百搭补对子拦截，不再错误过牌');

const lowStraightFlush = identifyHand(
    ['2', '3', '4', '5', '6'].map((rank, i) => normalCard(rank, '♥', `last-flush${i}`)),
    'K'
);
const longFlushEngine = {
    ...longBombEngine,
    lastPlayType: lowStraightFlush,
    hands: [Array(9).fill(null), wildcardFlushHand, Array(9).fill(null), Array(9).fill(null)]
};
const wildcardFlushPlay = aiFollowPlay(wildcardFlushHand, 1, longFlushEngine, 3);
assert(wildcardFlushPlay
    && wildcardFlushPlay.some(card => isWildLevelCard(card, '5'))
    && identifyHand(wildcardFlushPlay, '5').type === HAND_TYPES.STRAIGHT_FLUSH,
    'AI会用红桃百搭补成更大的同花顺跟牌');

const wildReserveHand = [
    normalCard('5', '♥', 'ai-wild-reserve'),
    ...['2', '3', '4', '6', '8', '10', 'Q', 'K', 'A'].map((rank, i) => normalCard(rank, SUITS[i % 4], `reserve${i}`))
];
const reservedLead = aiFreePlay(wildReserveHand, 1, { levelCard: '5' });
assert(!reservedLead.some(card => isWildLevelCard(card, '5')), 'AI常规领出会保留红桃百搭');

const naturalLevelPairHand = [
    normalCard('5', '♥', 'pair-wild'),
    normalCard('5', '♦', 'pair-natural-a'),
    normalCard('5', '♣', 'pair-natural-b'),
    normalCard('2', '♠', 'pair-extra-2'),
    normalCard('9', '♠', 'pair-extra-9'),
    normalCard('K', '♠', 'pair-extra-k')
];
const naturalLevelPairPlay = aiFreePlay(naturalLevelPairHand, 1, { levelCard: '5' });
assert(!naturalLevelPairPlay.some(card => isWildLevelCard(card, '5'))
    && (naturalLevelPairPlay[0].rank === '2'
        || naturalLevelPairPlay.every(card => card.rank === '5')),
    'AI优先清小单张2；若出级牌对子也不会浪费红桃百搭');

const naturalStraightHand = [
    normalCard('5', '♥', 'straight-wild'),
    normalCard('5', '♦', 'straight-natural'),
    ...['2', '3', '4', '6', 'K'].map((rank, i) => normalCard(rank, SUITS[i % 4], `straight-extra${i}`))
];
const naturalStraightPlay = aiFreePlay(naturalStraightHand, 1, { levelCard: '5' });
assert(identifyHand(naturalStraightPlay, '5').type === HAND_TYPES.STRAIGHT
    && naturalStraightPlay.every(card => !isWildLevelCard(card, '5')),
    'AI顺子有自然5时不浪费红桃5');

assert(GUANDAN_POLICY.featureVersion === 'gd-candidate-v2'
    && GUANDAN_POLICY.modelType === 'extra-trees'
    && GUANDAN_POLICY.trainingStates === 500
    && GUANDAN_POLICY.trainingSchema === 'gd-selfplay-v6'
    && GUANDAN_POLICY.targetVersion === 'team-level-public-rollout-v1'
    && GUANDAN_POLICY.worldPrefix === 10,
    '已加载公开信息十世界团队升级标签的候选评分模型');
const policyProbePlanner = createTurnEstimator('5');
const policyProbeFeatures = encodeGuandanPolicyFeatures(
    naturalStraightHand,
    naturalStraightPlay,
    '5',
    policyProbePlanner,
    { playerId: 1, engine: null, phase: 'lead',
        featureVersion: GUANDAN_POLICY.featureVersion }
);
assert(policyProbeFeatures.length === GUANDAN_POLICY.inputSize
    && Number.isFinite(predictGuandanPolicy(policyProbeFeatures)),
    '训练模型在浏览器同构特征上可完成有限值推理');
const v2PolicyProbeFeatures = encodeGuandanPolicyFeatures(
    naturalStraightHand,
    naturalStraightPlay,
    '5',
    policyProbePlanner,
    { playerId: 1, engine: null, phase: 'lead', featureVersion: 'gd-candidate-v2' }
);
assert(v2PolicyProbeFeatures.length === 36,
    '第二代策略特征包含座位风险、过牌证据、残局小单和剩余强牌等36维信息');
const physicalFeatureHand = [
    normalCard('9', '♠', 'feature-nine-spade'),
    normalCard('9', '♥', 'feature-nine-heart'),
    normalCard('3', '♣', 'feature-three-club')
];
const v3PolicySpadeFeatures = encodeGuandanPolicyFeatures(
    physicalFeatureHand,
    [physicalFeatureHand[0]],
    '5',
    policyProbePlanner,
    { playerId: 1, engine: null, phase: 'lead', featureVersion: 'gd-candidate-v3' }
);
const v3PolicyHeartFeatures = encodeGuandanPolicyFeatures(
    physicalFeatureHand,
    [physicalFeatureHand[1]],
    '5',
    policyProbePlanner,
    { playerId: 1, engine: null, phase: 'lead', featureVersion: 'gd-candidate-v3' }
);
assert(v3PolicySpadeFeatures.length === 144
    && v3PolicySpadeFeatures.some((value, index) => value !== v3PolicyHeartFeatures[index]),
    '第三代策略特征保留动作和剩余手牌的具体花色结构，不再混淆等点数实体牌');

const controlReserveHand = [
    normalCard('A', '♠', 'reserve-control-ace'),
    ...['3', '4', '6', '7', '8'].flatMap((rank, index) => [
        normalCard(rank, SUITS[index % 4], `reserve-${rank}-a`),
        normalCard(rank, SUITS[(index + 1) % 4], `reserve-${rank}-b`)
    ])
];
const controlReserveLast = normalCard('Q', '♣', 'reserve-last-q');
const controlReserveEngine = {
    levelCard: '5',
    lastPlay: [controlReserveLast],
    lastPlayType: identifyHand([controlReserveLast], '5'),
    lastPlayer: 0,
    hands: [Array(12).fill(null), controlReserveHand, Array(12).fill(null), Array(11).fill(null)],
    playerFinished: [false, false, false, false],
    playedCards: [controlReserveLast],
    passMemory: [],
    passCount: 0,
    getTeam: id => id % 2,
    getTeammate: id => (id + 2) % 4,
    getStrategyMode: () => 'v4-control-reserve',
    aiPolicyMode: 'legacy'
};
const passProbePlanner = createTurnEstimator('5');
const passProbeContext = {
    playerId: 1,
    engine: controlReserveEngine,
    phase: 'follow',
    v2: buildAIContext(controlReserveEngine, 1, 'follow')
};
const passProbeFeatures = encodeGuandanPassFeatures(
    controlReserveHand,
    [controlReserveHand[0]],
    '5',
    passProbePlanner,
    passProbeContext
);
assert(passProbeFeatures.length === 57 && passProbeFeatures.every(Number.isFinite),
    '跟牌/过牌模型生成57维公开信息特征，且所有数值可直接用于浏览器推理');
const hiddenVariantEngine = {
    ...controlReserveEngine,
    hands: [
        Array.from({ length: 12 }, (_, index) => normalCard('3', SUITS[index % 4], `hidden-a-${index}`)),
        controlReserveHand,
        Array.from({ length: 12 }, (_, index) => normalCard('K', SUITS[index % 4], `hidden-b-${index}`)),
        Array.from({ length: 11 }, (_, index) => normalCard('9', SUITS[index % 4], `hidden-c-${index}`))
    ]
};
const hiddenVariantFeatures = encodeGuandanPassFeatures(
    controlReserveHand,
    [controlReserveHand[0]],
    '5',
    passProbePlanner,
    {
        playerId: 1,
        engine: hiddenVariantEngine,
        phase: 'follow',
        v2: buildAIContext(hiddenVariantEngine, 1, 'follow')
    }
);
assert(passProbeFeatures.every((value, index) => value === hiddenVariantFeatures[index]),
    '跟牌/过牌特征不随其他三家隐藏牌面变化，只使用公开牌数和已出牌');
assert(aiFollowPlay(controlReserveHand, 1, controlReserveEngine, 3) === null,
    '实验控制牌保留策略会放过非紧急中盘，避免用A做一次大概率守不住的跟单');
const controlBudgetHand = [
    normalCard('A', '♠', 'budget-control-ace'),
    normalCard('2', '♣', 'budget-low-single'),
    ...['6', '8', '10'].flatMap((rank, index) => [
        normalCard(rank, SUITS[index % 4], `budget-${rank}-a`),
        normalCard(rank, SUITS[(index + 1) % 4], `budget-${rank}-b`),
        normalCard(rank, SUITS[(index + 2) % 4], `budget-${rank}-c`)
    ])
];
controlReserveEngine.hands[1] = controlBudgetHand;
controlReserveEngine.getStrategyMode = () => 'v4-control-budget';
assert(aiFollowPlay(controlBudgetHand, 1, controlReserveEngine, 3) === null,
    '实验控制预算只保护最后一份控制牌，且要求剩余手牌确有低散牌债务');
const overlappingStraightHand = ['2', '3', '4', '5', '6', '7'].map((rank, index) => (
    normalCard(rank, SUITS[index % 4], `planned-residue-${rank}`)
));
const overlappingStraightPlanner = createTurnEstimator('9');
assert(calculateLowSingletonLiability(overlappingStraightHand, '9') === 0
    && overlappingStraightPlanner.residue(overlappingStraightHand) === 24,
    '完整分解能识别重叠顺子最终必留一张7，避免把所有可入顺子的牌都误判为零散牌债务');

const lowSingletonHand = [
    normalCard('3', '♠', 'low-single-3'),
    normalCard('A', '♠', 'control-single-a'),
    normalCard('6', '♠', 'low-single-6a'),
    normalCard('6', '♥', 'low-single-6b'),
    normalCard('9', '♠', 'low-single-9a'),
    normalCard('9', '♥', 'low-single-9b'),
    normalCard('9', '♣', 'low-single-9c')
];
const lowSingletonEngine = new GameEngine();
lowSingletonEngine.hands = [[], lowSingletonHand, [], []];
lowSingletonEngine.levelCard = '5';
lowSingletonEngine.lastPlay = null;
lowSingletonEngine.lastPlayer = -1;
lowSingletonEngine.playerFinished = [false, false, false, false];
const clearLowSingleton = aiFreePlay(lowSingletonHand, 1, lowSingletonEngine);
assert(clearLowSingleton.length === 1 && clearLowSingleton[0].rank === '3',
    'AI同等手数方案优先清掉小单张3，保留A作为残局控制牌');

const learnedHighSingle = [lowSingletonHand[1]];
const originalLearnedChooser = chooseLearnedPolicyPlay;
chooseLearnedPolicyPlay = () => learnedHighSingle;
const correctedLearnedSingle = chooseStrategicPlay(
    lowSingletonHand,
    [[lowSingletonHand[0]], learnedHighSingle],
    '5',
    null
);
chooseLearnedPolicyPlay = originalLearnedChooser;
assert(correctedLearnedSingle[0].rank === '3',
    '学习模型即使偏好A，最终单张决策仍会清掉低散张3');

const splitLowPairHand = [
    normalCard('8', '♠', 'split-low-pair-a'),
    normalCard('8', '♣', 'split-low-pair-b'),
    { suit: '', rank: JOKER_BIG, value: 101, isJoker: true, id: 'reserve-big-joker' },
    ...['3', '4', '5', '6', 'J', 'Q'].map((rank, index) => (
        normalCard(rank, SUITS[index % 4], `single-disposal-filler-${rank}`)
    ))
];
const learnedBigJoker = [splitLowPairHand[2]];
chooseLearnedPolicyPlay = () => learnedBigJoker;
const splitLowPairChoice = chooseStrategicPlay(
    splitLowPairHand,
    [[splitLowPairHand[0]], learnedBigJoker],
    '9',
    { v2: { urgent: false } }
);
const urgentSingleChoice = chooseStrategicPlay(
    splitLowPairHand,
    [[splitLowPairHand[0]], learnedBigJoker],
    '9',
    { v2: { urgent: true } }
);
chooseLearnedPolicyPlay = originalLearnedChooser;
assert(splitLowPairChoice[0].rank === '8',
    '普通中盘可适度拆小对子出单张，保留大王控制牌');
assert(urgentSingleChoice[0].isJoker && urgentSingleChoice[0].rank === JOKER_BIG,
    '任一对手报双以内时恢复封堵优先，可用大王抬高单张门槛');

const straightAndSpareHand = [
    ...['3', '4', '5', '6', '7'].map((rank, index) => (
        normalCard(rank, SUITS[index % 4], `protected-straight-${rank}`)
    )),
    normalCard('9', '♣', 'disposable-nine'),
    { suit: '', rank: JOKER_BIG, value: 101, isJoker: true, id: 'straight-reserve-joker' }
];
chooseLearnedPolicyPlay = () => [straightAndSpareHand[6]];
const protectedStraightSingle = chooseStrategicPlay(
    straightAndSpareHand,
    [[straightAndSpareHand[0]], [straightAndSpareHand[5]], [straightAndSpareHand[6]]],
    'Q',
    { v2: { urgent: false } }
);
chooseLearnedPolicyPlay = originalLearnedChooser;
assert(protectedStraightSingle[0].rank === '9',
    '清小单时仍保护完整顺子，优先处理不增加剩余手数的散张');

// 新牌谱回归：清小单后处理不能把已经规划好的残局拆成更多手。
const compactFinishHand = [
    { suit: '', rank: JOKER_BIG, value: 101, isJoker: true, id: 'compact-joker' },
    normalCard('7', '♠', 'compact-pair-a'), normalCard('7', '♥', 'compact-pair-b'),
    ...['♠', '♥', '♦', '♣'].map((suit, index) => normalCard('5', suit, `compact-bomb-${index}`))
];
const compactPlanner = createTurnEstimator('8');
const compactSingles = [[compactFinishHand[0]], [compactFinishHand[1]]];
const compactSix = compactFinishHand.slice(0, 6);
assert(refineLearnedSingleChoice(compactSix, compactSingles[0],
    findSingles(compactSix, -Infinity, '8'), '8', createTurnEstimator('8'),
    { v2: { urgent: false } })[0].isJoker,
    '6张残局大王+77+555保护三带二收尾，不改拆对子');
const compactChoice = refineLearnedSingleChoice(compactFinishHand, compactSingles[0],
    compactSingles, '8', compactPlanner, { v2: { urgent: false } });
assert(compactChoice[0].isJoker
    && compactPlanner(removePlayedCards(compactFinishHand, compactChoice)) === 2,
    '7张残局大王+77+5555不再为了清小单拆77，平白多留一手');
assert(refineLearnedSingleChoice(compactFinishHand, compactSingles[0],
    findSingles(compactFinishHand, -Infinity, '8'), '8', compactPlanner,
    { v2: { urgent: false } })[0].isJoker,
    '完整单张候选中不转而拆5555，保留原战术选择');
const compactEight = [...compactFinishHand, normalCard('A', '♣', 'compact-eight-ace')];
assert(refineLearnedSingleChoice(compactEight, compactSingles[0], compactSingles, '8',
    createTurnEstimator('8'), { v2: { urgent: false } })[0].isJoker,
    '8张残局也保护原有剩余手数');
const compactMidgame = [...compactEight, normalCard('K', '♣', 'compact-mid-king')];
assert(refineLearnedSingleChoice(compactMidgame, compactSingles[0], compactSingles, '8',
    createTurnEstimator('8'), { v2: { urgent: false } })[0].rank === '7',
    '无两手收尾路径的中盘仍能清理小单张');

const compactWildHand = [normalCard('2', '♥', 'compact-wild'),
    ...['♠', '♣', '♦'].map((suit, index) => normalCard('2', suit, `compact-level-${index}`)),
    normalCard('A', '♣', 'compact-ace'), normalCard('5', '♥', 'compact-five')];
const compactWildEngine = new GameEngine();
compactWildEngine.levelCard = '2';
compactWildEngine.hands = [compactWildHand, Array(22).fill(null), Array(27).fill(null), Array(16).fill(null)];
compactWildEngine.playerFinished = [false, false, false, false];
compactWildEngine.lastPlay = null;
compactWildEngine.lastPlayer = -1;
const compactWildChoice = aiDecidePlay(0, compactWildEngine);
assert(identifyHand(compactWildChoice, '2').valid
    && identifyHand(removePlayedCards(compactWildHand, compactWildChoice), '2').valid,
    '级2的2222+A+5保留两手收尾路径，不先炸弹留下两张散牌');
compactWildEngine.hands[0] = compactWildHand.slice(0, 4);
assert(aiDecidePlay(0, compactWildEngine).length === 4,
    '整手百搭炸弹可以直接走完时不被残局保护阻拦');
const compactBombAndPair = [...compactWildHand.slice(0, 4),
    normalCard('5', '♠', 'compact-tail-a'), normalCard('5', '♣', 'compact-tail-b')];
compactWildEngine.hands[0] = compactBombAndPair;
const compactPairChoice = aiDecidePlay(0, compactWildEngine);
assert(identifyHand(compactPairChoice, '2').valid
    && identifyHand(removePlayedCards(compactBombAndPair, compactPairChoice), '2').valid,
    '百搭炸弹加对子仍能保留两手走完的合法路径');
const bombFallbackHand = [
    ...['♥', '♥', '♦', '♣'].map((suit, index) => normalCard('K', suit, `bomb-fallback-k-${index}`)),
    ...['♠', '♥', '♦', '♦', '♣'].map((suit, index) => normalCard('2', suit, `bomb-fallback-two-${index}`))
];
const bombFallbackEngine = new GameEngine();
bombFallbackEngine.levelCard = '8';
bombFallbackEngine.hands = [bombFallbackHand, Array(22).fill(null),
    Array(21).fill(null), Array(12).fill(null)];
bombFallbackEngine.playerFinished = [false, false, false, false];
bombFallbackEngine.lastPlay = [normalCard('J', '♣', 'bomb-fallback-last-j')];
bombFallbackEngine.lastPlayType = identifyHand(bombFallbackEngine.lastPlay, '8');
bombFallbackEngine.lastPlayer = 3;
const bombFallbackChoice = aiDecidePlay(0, bombFallbackEngine);
assert(bombFallbackChoice && identifyHand(bombFallbackChoice, '8').type === HAND_TYPES.BOMB
    && bombFallbackChoice.length === 4,
    '真人牌谱：9张全是两组炸弹时，对手单张J不能因拒绝拆炸弹而直接过牌');
for (const threatCount of [1, 2]) {
    compactWildEngine.hands[0] = compactWildHand;
    compactWildEngine.hands[1] = Array(threatCount).fill(null);
    const blockingChoice = aiDecidePlay(0, compactWildEngine);
    assert(blockingChoice.length > threatCount
        && identifyHand(blockingChoice, '2').valid,
        `对手剩${threatCount}张时残局保护不强制喂小单，仍使用多张组合封堵`);
}

const followWild = normalCard('5', '♥', 'ai-wild-follow');
const lowFollowCards = ['2', '3', '4', '6', '7', '8', '9', '10', 'J']
    .map((rank, i) => normalCard(rank, SUITS[i % 4], `follow${i}`));
const followHand = [followWild, ...lowFollowCards];
const aceToBeat = identifyHand([normalCard('A', '♠', 'ace-to-beat')], '5');
const followEngine = {
    levelCard: '5',
    lastPlayer: 0,
    lastPlayType: aceToBeat,
    hands: [Array(5).fill(null), followHand, Array(5).fill(null), Array(5).fill(null)],
    playerFinished: [false, false, false, false],
    getTeam: id => id % 2 === 0 ? 'a' : 'b'
};
assert(aiFollowPlay(followHand, 1, followEngine, 3) === null, 'AI非残局不用百搭单张勉强压A');
const naturalLevelFollower = normalCard('5', '♦', 'natural-level-follower');
const mixedFollowHand = [followWild, naturalLevelFollower, ...lowFollowCards];
followEngine.hands[1] = mixedFollowHand;
const naturalLevelFollowPlay = aiFollowPlay(mixedFollowHand, 1, followEngine, 3);
assert(naturalLevelFollowPlay && naturalLevelFollowPlay[0].id === naturalLevelFollower.id,
    'AI跟单时先出普通级牌，保留红桃百搭');
followEngine.hands[0] = [normalCard('3', '♠', 'threat-last-card')];
followEngine.hands[1] = followHand;
const threatPlay = aiFollowPlay(followHand, 1, followEngine, 3);
assert(threatPlay && threatPlay.length === 1 && isWildLevelCard(threatPlay[0], '5'), 'AI在对手剩1张时会用百搭封锁');

const wildEndgameHand = [
    normalCard('5', '♥', 'ai-wild-endgame'),
    ...['6', '7', '8', '10', '2'].map((rank, i) => normalCard(rank, SUITS[i % 4], `endgame${i}`))
];
const wildEndgamePlay = aiFreePlay(wildEndgameHand, 1, { levelCard: '5' });
assert(wildEndgamePlay.some(card => isWildLevelCard(card, '5'))
    && identifyHand(wildEndgamePlay, '5').type === HAND_TYPES.STRAIGHT,
    'AI残局会用百搭补顺子快速收尾');

const midgameWildcardHand = [
    normalCard('5', '♥', 'v3-mid-wild'),
    normalCard('7', '♠', 'v3-seven-a'),
    normalCard('7', '♥', 'v3-seven-b'),
    normalCard('7', '♣', 'v3-seven-c'),
    normalCard('9', '♠', 'v3-nine'),
    ...['2', '3', '4', '6', '8', 'J', 'K', 'A'].map((rank, i) => (
        normalCard(rank, SUITS[i % 4], `v3-mid-extra-${i}`)
    ))
];
const midgameWildPatterns = findWildcardPatternPlays(midgameWildcardHand, '5');
assert(midgameWildcardHand.length > 8 && midgameWildPatterns.some(play => {
    return identifyHand(play, '5').type === HAND_TYPES.TRIPLE_PAIR
        && play.some(card => isWildLevelCard(card, '5'));
}), 'v3在中盘超过8张牌时也会生成百搭三带二候选');

function followWholeHand(hand, lastPlay) {
    return aiDecidePlay(1, {
        levelCard: '5',
        lastPlayer: 0,
        lastPlay,
        lastPlayType: identifyHand(lastPlay, '5'),
        hands: [Array(6).fill(null), hand, Array(6).fill(null), Array(6).fill(null)],
        playedCards: lastPlay,
        passMemory: [],
        playerFinished: [false, false, false, false],
        getTeam: id => id % 2,
        getTeammate: id => (id + 2) % 4,
        getStrategyMode: () => 'v3'
    });
}

const wholeFollowSingle = [normalCard('3', '♠', 'whole-follow-last-three')];
const wholeFollowKings = SUITS.map((suit, index) => normalCard('K', suit, `whole-follow-king-${index}`));
const wholeFollowRocket = createDeck().filter(card => card.isJoker);
const wholeFollowFlush = ['7', '8', '9', '10', 'J']
    .map((rank, index) => normalCard(rank, '♥', `whole-follow-flush-${index}`));
const wholeFollowWildcardBomb = [
    ...Array.from({ length: 8 }, (_, index) => normalCard('K', SUITS[index % 4], `whole-follow-wild-king-${index}`)),
    normalCard('5', '♥', 'whole-follow-wild-a'),
    normalCard('5', '♥', 'whole-follow-wild-b')
];
for (const [label, hand] of [
    ['四张K炸弹', wholeFollowKings],
    ['四王', wholeFollowRocket],
    ['同花顺', wholeFollowFlush],
    ['十张百搭炸弹', wholeFollowWildcardBomb]
]) {
    const play = followWholeHand(hand, wholeFollowSingle);
    assert(play && play.length === hand.length
        && hand.every(card => play.some(chosen => chosen.id === card.id))
        && canBeat(identifyHand(play, '5'), identifyHand(wholeFollowSingle, '5')),
    `AI跟对手单张时会用整手${label}走完，不再拆牌留下残局`);
}
const wholeFollowAces = SUITS.map((suit, index) => normalCard('A', suit, `whole-follow-ace-${index}`));
assert(followWholeHand(wholeFollowKings, wholeFollowAces) === null,
    '整手虽是合法炸弹但小于对手炸弹时仍须过牌');
const wholeFollowPair = wholeFollowKings.slice(0, 2);
const wholeFollowPairPlay = followWholeHand(wholeFollowPair, wholeFollowSingle);
assert(wholeFollowPairPlay && wholeFollowPairPlay.length === 1,
    '整手是对子时不能当作整手跟单，仍选择合法单张');

// 强牌的value不在同一量纲：必须按规则层级排序，不能把同花顺的点数与炸弹编码相减。
const orderedPowerPlays = [bomb4A, bomb5Three, straightFlush, bomb6Three, wholeFollowRocket];
assert(orderedPowerPlays.every((play, index) => orderedPowerPlays.slice(index + 1).every(stronger => (
    comparePowerPlays(play, stronger, '9') < 0
    && comparePowerPlays(stronger, play, '9') > 0
))), '强牌代价顺序遵循4炸 < 5炸 < 同花顺 < 6炸 < 四王');
const wildKingBomb = [wholeFollowKings[0], wholeFollowKings[1], wholeFollowKings[2],
    normalCard('5', '♥', 'power-order-wild-king')];
assert(comparePowerPlays(wholeFollowKings, wildKingBomb, '5') < 0,
    '同等大小炸弹优先用自然牌，保留百搭');

const fiveAceBomb = [...wholeFollowAces, normalCard('A', '♠', 'power-follow-fifth-ace')];
const sixAceBomb = [...fiveAceBomb, normalCard('A', '♥', 'power-follow-sixth-ace')];
const powerWildFlush = [normalCard('5', '♥', 'power-follow-flush-wild'),
    ...['8', '9', '10', 'Q'].map((rank, index) => normalCard(rank, '♠', `power-follow-gap-${index}`))];
const powerWildFiveBomb = [
    ...SUITS.map((suit, index) => normalCard('8', suit, `power-follow-eight-${index}`)),
    normalCard('5', '♥', 'power-follow-bomb-wild')
];
for (const [label, hand, lastPlay, expectedType, expectedLength] of [
    ['自然同花顺压5炸时保住6炸', [...bomb6Three, ...wholeFollowFlush], fiveAceBomb,
        HAND_TYPES.STRAIGHT_FLUSH, 5],
    ['百搭同花顺压5炸时保住自然6炸', [...bomb6Three, ...powerWildFlush], fiveAceBomb,
        HAND_TYPES.STRAIGHT_FLUSH, 5],
    ['百搭5炸可压4炸时保住自然同花顺', [...powerWildFiveBomb, ...wholeFollowFlush], wholeFollowAces,
        HAND_TYPES.BOMB, 5],
    ['跟同花顺优先较小同花顺，保住6炸', [...bomb6Three, ...wholeFollowFlush], straightFlush,
        HAND_TYPES.STRAIGHT_FLUSH, 5],
    ['6炸可压对手时保住四王', [...sixAceBomb, ...wholeFollowRocket], bomb6Three,
        HAND_TYPES.BOMB, 6],
    ['只有四王可压6炸时残局正常接牌', [...wholeFollowRocket, normalCard('2', '♣', 'power-rocket-tail')],
        sixAceBomb, HAND_TYPES.ROCKET, 4],
    ['整手十张百搭炸弹能走完时优先走完', wholeFollowWildcardBomb, fiveAceBomb,
        HAND_TYPES.BOMB, 10]
]) {
    const play = followWholeHand(hand, lastPlay);
    const type = play && identifyHand(play, '5');
    assert(play && type.type === expectedType && play.length === expectedLength
        && canBeat(type, identifyHand(lastPlay, '5'))
        && new Set(play.map(card => card.id)).size === play.length
        && play.every(card => hand.some(held => held.id === card.id)), `AI强牌跟牌：${label}，出牌合法`);
}
assert(followWholeHand([...bomb6Three, ...wholeFollowFlush], wholeFollowRocket) === null,
    '对手出四王时不会误用其它强牌接牌');
const ordinaryPowerReserve = [...wholeFollowKings,
    ...['2', '3', '4', '6', '7', '8', '9', '10', 'J', 'Q', 'A', '2']
        .map((rank, index) => normalCard(rank, SUITS[index % 4], `power-reserve-${index}`))];
assert(followWholeHand(ordinaryPowerReserve, [bigJoker]) === null,
    '普通牌跟牌仍保持节制：大手牌且无威胁时不用炸弹抢大王');

const teammateLast = identifyHand([normalCard('Q', '♠', 'v3-mate-q')], '5');
const teammateTakeoverHand = [
    normalCard('2', '♠', 'v3-own-two'),
    normalCard('A', '♠', 'v3-own-ace')
];
const teammateTakeoverEngine = {
    levelCard: '5',
    lastPlayer: 3,
    lastPlayType: teammateLast,
    hands: [Array(5).fill(null), teammateTakeoverHand, [normalCard('K', '♣', 'v3-threat-k')], Array(4).fill(null)],
    playedCards: [],
    passMemory: [],
    playerFinished: [false, false, false, false],
    getTeam: id => id % 2 === 0 ? 'a' : 'b',
    getTeammate: id => (id + 2) % 4,
    getStrategyMode: () => 'v3'
};
const teammateTakeoverPlay = aiFollowPlay(teammateTakeoverHand, 1, teammateTakeoverEngine, 3);
assert(teammateTakeoverPlay && teammateTakeoverPlay.length === 1
    && teammateTakeoverPlay[0].rank === 'A',
    'v3在下家对手仅剩1张时会用A接管队友的Q，而不是机械过牌');

const protectedTeammateBomb = [
    ...SUITS.map((suit, index) => normalCard('Q', suit, `mate-protected-q-${index}`)),
    normalCard('4', '♣', 'mate-protected-four')
];
const teammateLowPair = [
    normalCard('3', '♠', 'mate-low-pair-a'),
    normalCard('3', '♦', 'mate-low-pair-b')
];
const teammatePairEngine = {
    ...teammateTakeoverEngine,
    lastPlay: teammateLowPair,
    lastPlayType: identifyHand(teammateLowPair, '5'),
    hands: [Array(5).fill(null), protectedTeammateBomb,
        [normalCard('K', '♣', 'mate-pair-opponent-last')], Array(4).fill(null)]
};
assert(aiDecidePlay(1, teammatePairEngine) === null,
    '队友对子已封住下家报单时AI过牌，不再拆QQQQ炸弹抢队友');

const probabilityUnseen = {};
for (const rank of RANKS) probabilityUnseen[rank] = 8;
probabilityUnseen[JOKER_SMALL] = 2;
probabilityUnseen[JOKER_BIG] = 2;
const oneCardQRisk = estimateSeatSingleBeatProbability(probabilityUnseen, 12, '5', 1);
const fourCardQRisk = estimateSeatSingleBeatProbability(probabilityUnseen, 12, '5', 4);
const oneCardARisk = estimateSeatSingleBeatProbability(probabilityUnseen, 14, '5', 1);
const passedQRisk = estimateSeatSingleBeatProbability(probabilityUnseen, 12, '5', 1, [{
    against: HAND_TYPES.SINGLE,
    value: 12
}]);
const unpassedTenRisk = estimateSeatSingleBeatProbability(probabilityUnseen, 10, '5', 1);
const passedKingEntries = [{ against: HAND_TYPES.SINGLE, value: 13 }];
const passedKingAceRisk = estimateSeatSingleBeatProbability(
    probabilityUnseen, 14, '5', 1, passedKingEntries
);
const passedKingTenRisk = estimateSeatSingleBeatProbability(
    probabilityUnseen, 10, '5', 1, passedKingEntries
);
assert(fourCardQRisk > oneCardQRisk && oneCardQRisk > oneCardARisk,
    'v4座位概率随对手手牌增加而升高，并随我方单张变大而降低');
assert(passedQRisk < oneCardQRisk * 0.3,
    'v4会利用指定座位曾对同级单张过牌的信息下调其压牌概率');
assert(passedKingAceRisk < oneCardARisk * 0.3
    && Math.abs(passedKingTenRisk - unpassedTenRisk) < 1e-12,
    '对手对K过牌只证明其难压A等更高牌，不会错误推断其压不了10');

const precisePassContext = {
    phase: 'lead',
    useV4PassInference: true,
    opponentPasses: [{ player: 0, against: HAND_TYPES.SINGLE, value: 13, length: 1 }],
    oppPassTypes: [HAND_TYPES.SINGLE],
    nextOppCount: 8,
    teammateFinished: false,
    teammateCount: 8,
    minOpp: 8
};
const acePassReward = scoreV2Adjustment(
    [normalCard('A', '♠', 'pass-evidence-ace')], '5',
    { type: HAND_TYPES.SINGLE, value: 14, length: 1 }, precisePassContext, []
);
const tenPassReward = scoreV2Adjustment(
    [normalCard('10', '♠', 'pass-evidence-ten')], '5',
    { type: HAND_TYPES.SINGLE, value: 10, length: 1 }, precisePassContext, []
);
assert(acePassReward < tenPassReward,
    '精确过牌推理只奖励达到已过门槛的领牌，不再把任意同牌型都当成对手弱项');

const probabilityLeadHand = [
    normalCard('2', '♠', 'v4-lead-two'),
    normalCard('A', '♠', 'v4-lead-ace')
];
const probabilityLeadEngine = {
    levelCard: '5',
    lastPlay: null,
    lastPlayer: -1,
    hands: [Array(5).fill(null), probabilityLeadHand, Array(1).fill(null), Array(4).fill(null)],
    playedCards: [],
    passMemory: [],
    playerFinished: [false, false, false, false],
    getTeam: id => id % 2 === 0 ? 'a' : 'b',
    getTeammate: id => (id + 2) % 4,
    getStrategyMode: () => 'v4'
};
const probabilityLeadPlay = aiFreePlay(probabilityLeadHand, 1, probabilityLeadEngine);
assert(probabilityLeadPlay.length === 1 && probabilityLeadPlay[0].rank === 'A',
    'v4面对仅剩1张的下家时优先用A封堵，而不是用2送对手出完');

const determinizationDeck = createDeck();
const determinizationOwn = [
    determinizationDeck.find(card => card.id === '♠2_0'),
    determinizationDeck.find(card => card.id === '♠A_0')
];
const determinizationUnknownIds = new Set(['♣3_0', '♦4_0', '♠5_0']);
const determinizationPlayed = determinizationDeck.filter(card => (
    !determinizationOwn.some(own => own.id === card.id) && !determinizationUnknownIds.has(card.id)
));
const determinizationEngine = {
    levelCard: '9',
    roundNumber: 3,
    hands: [determinizationOwn, Array(1).fill(null), Array(1).fill(null), Array(1).fill(null)],
    playedCards: determinizationPlayed,
    passMemory: [],
    playerFinished: [false, false, false, false],
    getTeam: id => id % 2 === 0 ? 'a' : 'b',
    getTeammate: id => (id + 2) % 4,
    getStrategyMode: () => 'v4-search'
};
const determinizationContext = buildAIContext(determinizationEngine, 0, 'lead');
const lowControlProbability = estimateLeadControlProbability(
    [determinizationOwn[0]],
    identifyHand([determinizationOwn[0]], '9'),
    '9',
    determinizationContext
);
const highControlProbability = estimateLeadControlProbability(
    [determinizationOwn[1]],
    identifyHand([determinizationOwn[1]], '9'),
    '9',
    determinizationContext
);
assert(lowControlProbability === 0 && highControlProbability === 1,
    '受限搜索只用公开未知牌池，能区分必被压的2和可守住牌权的A');
assert(getDeterminizedHands(determinizationContext) === getDeterminizedHands(determinizationContext),
    '同一次决策的所有候选复用完全相同的可能牌分布');
const lowTeamTrickProbability = estimateTeamTrickWinProbability(
    [determinizationOwn[0]],
    identifyHand([determinizationOwn[0]], '9'),
    '9',
    determinizationContext
);
const highTeamTrickProbability = estimateTeamTrickWinProbability(
    [determinizationOwn[1]],
    identifyHand([determinizationOwn[1]], '9'),
    '9',
    determinizationContext
);
assert(highTeamTrickProbability > lowTeamTrickProbability,
    '受限搜索会继续模拟队友反压和对手再接，并按最终牌权归属评分');

const weakerFiveBomb = identifyHand(
    Array.from({ length: 5 }, (_, i) => normalCard('7', SUITS[i % 4], `v3-last-seven-${i}`)),
    '2'
);
const ambiguousWildBombHand = [
    ...Array.from({ length: 4 }, (_, i) => normalCard('3', SUITS[i], `v3-three-${i}`)),
    normalCard('2', '♥', 'v3-bomb-wild'),
    ...['4', '6', '8', '10', 'Q'].map((rank, i) => normalCard(rank, SUITS[i % 4], `v3-bomb-extra-${i}`))
];
const ambiguousBombEngine = {
    ...teammateTakeoverEngine,
    levelCard: '2',
    lastPlayer: 0,
    lastPlayType: weakerFiveBomb,
    hands: [Array(6).fill(null), ambiguousWildBombHand, Array(6).fill(null), Array(6).fill(null)]
};
const ambiguousBombPlay = aiFollowPlay(ambiguousWildBombHand, 1, ambiguousBombEngine, 3);
assert(!ambiguousBombPlay || canBeat(identifyHand(ambiguousBombPlay, '2'), weakerFiveBomb),
    '百搭存在多种解释时，AI不会打出实际压不过上家的炸弹');

const tributeText = formatTributeExchanges([{
    from: 3,
    to: 0,
    tributeCard: normalCard('A', '♠', 'format-tribute'),
    returnCard: normalCard('10', '♥', 'format-return')
}]);
assert(tributeText.includes('右侧对手进贡♠A') && tributeText.includes('你还牌♥10'), '升级后贡还牌提示正确显示座位、贡牌与还牌');

// 同一牌型必须覆盖不同实物牌选择，否则“先取数组第一张”会拆掉潜在同花顺。
const protectedFlushCards = ['3', '4', '5', '6', '7']
    .map(rank => normalCard(rank, '♠', `coverage-spade-${rank}`));
const expendableStraightCards = [
    normalCard('3', '♥', 'coverage-alt-3'),
    normalCard('4', '♦', 'coverage-alt-4'),
    normalCard('5', '♣', 'coverage-alt-5'),
    normalCard('6', '♥', 'coverage-alt-6'),
    normalCard('7', '♦', 'coverage-alt-7')
];
const structuralCoverageHand = protectedFlushCards.flatMap((card, index) => [
    card,
    expendableStraightCards[index]
]);
AI_STRUCTURAL_COVERAGE_ENABLED = true;
const structuralStraightCandidates = findStraights(structuralCoverageHand, -Infinity, 5, 'K');
const preservingStraight = structuralStraightCandidates.find(play => (
    play.every(card => card.suit !== '♠')
));
assert(Boolean(preservingStraight), '同牌型候选会尝试不同实物牌，能保住已有同花顺');
const structuralChoice = chooseStrategicPlay(
    structuralCoverageHand,
    findLeadCandidates(structuralCoverageHand, 'K'),
    'K',
    null
);
const structuralRemainingIds = new Set(removePlayedCards(structuralCoverageHand, structuralChoice).map(card => card.id));
assert(protectedFlushCards.every(card => structuralRemainingIds.has(card.id)),
    'AI会选不拆同花顺的等价出法，而不是机械拿每组第一张');
AI_STRUCTURAL_COVERAGE_ENABLED = false;
const structuralDefaultEngine = {
    hands: [Array(12).fill(null), structuralCoverageHand, Array(12).fill(null), Array(12).fill(null)],
    levelCard: 'K',
    lastPlay: null,
    lastPlayer: -1,
    passCount: 0,
    passMemory: [],
    playedCards: [],
    playerFinished: [false, false, false, false],
    getStrategyMode: () => 'v3',
    getTeammate: id => (id + 2) % 4,
    getTeam: id => id % 2 === 0 ? 'a' : 'b'
};
const structuralDefaultChoice = aiDecidePlay(1, structuralDefaultEngine);
const structuralDefaultRemaining = new Set(
    removePlayedCards(structuralCoverageHand, structuralDefaultChoice).map(card => card.id)
);
assert(protectedFlushCards.every(card => structuralDefaultRemaining.has(card.id)),
    '默认v3策略已启用结构候选扩充和强牌领出保护');

const spareThree = normalCard('3', '♥', 'single-coverage-spare-three');
const singleCoverageHand = [
    protectedFlushCards[0],
    spareThree,
    ...protectedFlushCards.slice(1)
];
AI_SINGLE_COVERAGE_ENABLED = true;
const duplicateSingleCandidates = findSingles(singleCoverageHand, -Infinity, 'K');
AI_SINGLE_COVERAGE_ENABLED = false;
assert(duplicateSingleCandidates.filter(play => play[0].rank === '3').length === 2,
    '实验候选会保留同点数单张的不同实物牌选择');
const singleCoverageEngine = {
    ...structuralDefaultEngine,
    hands: [Array(12).fill(null), singleCoverageHand, Array(12).fill(null), Array(12).fill(null)],
    getStrategyMode: () => 'v4-single-coverage'
};
const singleCoverageChoice = aiDecidePlay(1, singleCoverageEngine);
assert(singleCoverageChoice.length === 1 && singleCoverageChoice[0].id === spareThree.id,
    '实验策略会打散张3并保住黑桃3-7同花顺');
singleCoverageEngine.getStrategyMode = () => 'v3';
const defaultSingleCoverageChoice = aiDecidePlay(1, singleCoverageEngine);
assert(defaultSingleCoverageChoice.length === 1 && defaultSingleCoverageChoice[0].id === spareThree.id,
    '默认v3策略已启用单张实物候选和可控收尾评分');

const planningWild = normalCard('5', '♥', 'wild-planner-heart-five');
const wildcardRun = [
    planningWild,
    normalCard('3', '♠', 'wild-planner-3'),
    normalCard('4', '♦', 'wild-planner-4'),
    normalCard('5', '♣', 'wild-planner-5'),
    normalCard('6', '♠', 'wild-planner-6')
];
const naturalOnlyTurns = createTurnEstimator('5')(wildcardRun);
const wildcardAwareTurns = createTurnEstimator('5', {
    resetBudgetPerHand: true,
    wildcardAware: true
})(wildcardRun);
assert(wildcardAwareTurns === 1 && naturalOnlyTurns > wildcardAwareTurns,
    '实验残局规划器能识别百搭补顺子，不再把红桃级牌当普通5估算');

const wildcardPlanHand = [
    planningWild,
    normalCard('3', '♠', 'wild-plan-choice-3'),
    normalCard('4', '♦', 'wild-plan-choice-4'),
    normalCard('5', '♣', 'wild-plan-choice-5'),
    normalCard('6', '♠', 'wild-plan-choice-6'),
    ...Array.from({ length: 3 }, (_, i) => normalCard('9', SUITS[i], `wild-plan-choice-9-${i}`))
];
const wildcardPlanEngine = {
    ...structuralDefaultEngine,
    hands: [Array(12).fill(null), wildcardPlanHand, Array(12).fill(null), Array(12).fill(null)],
    levelCard: '5',
    getStrategyMode: () => 'v4-wild-plan'
};
const wildcardPlanChoice = aiDecidePlay(1, wildcardPlanEngine);
assert(identifyHand(wildcardPlanChoice, '5').type === HAND_TYPES.TRIPLE
    && wildcardPlanChoice.every(card => card.rank === '9'),
    '实验策略会先出三张，留下百搭顺子形成两手可控出完路径');

const sharedWildcardPowerHand = [
    normalCard('5', '♥', 'shared-power-wild'),
    ...Array.from({ length: 3 }, (_, i) => normalCard('7', SUITS[i], `shared-power-7-${i}`)),
    ...Array.from({ length: 3 }, (_, i) => normalCard('9', SUITS[i], `shared-power-9-${i}`))
];
assert(countPowerPlays(sharedWildcardPowerHand, '5') >= 2,
    '旧计数会把一张百搭可补出的多个互斥炸弹当成多套强牌');
assert(countIndependentPowerPlays(sharedWildcardPowerHand, '5') === 1,
    '独立强牌计数会识别多个炸弹候选共用同一张百搭');
const disjointPowerHand = [
    ...Array.from({ length: 4 }, (_, i) => normalCard('7', SUITS[i], `disjoint-power-7-${i}`)),
    ...Array.from({ length: 4 }, (_, i) => normalCard('9', SUITS[i], `disjoint-power-9-${i}`))
];
assert(countIndependentPowerPlays(disjointPowerHand, '5') === 2,
    '两套不重叠的自然炸弹仍正确计为至少两套强牌');

const originalPolicyPredictor = predictGuandanPolicy;
let policyProbeCalls = 0;
predictGuandanPolicy = () => {
    policyProbeCalls++;
    return 0;
};
const leadOnlyPolicyHand = [
    normalCard('3', '♠', 'lead-only-policy-3'),
    normalCard('4', '♦', 'lead-only-policy-4'),
    normalCard('A', '♣', 'lead-only-policy-a')
];
const leadOnlyPolicyCandidates = [[leadOnlyPolicyHand[0]], [leadOnlyPolicyHand[1]]];
const leadOnlyPolicyContext = {
    phase: 'follow',
    v2: {
        useV4LeadOnlyPolicy: true,
        useV3Endgame: true,
        phase: 'follow',
        nextOppCount: 8,
        minOpp: 8,
        teammateCount: 8,
        teammateFinished: false,
        oppPassTypes: []
    }
};
chooseStrategicPlay(leadOnlyPolicyHand, leadOnlyPolicyCandidates, '5', leadOnlyPolicyContext);
assert(policyProbeCalls === 0, '领牌专用模型策略在跟牌阶段完全回退到规则评分');
leadOnlyPolicyContext.phase = 'lead';
leadOnlyPolicyContext.v2.phase = 'lead';
chooseStrategicPlay(leadOnlyPolicyHand, leadOnlyPolicyCandidates, '5', leadOnlyPolicyContext);
assert(policyProbeCalls > 0, '领牌专用模型策略在领牌阶段仍使用训练模型重排');
predictGuandanPolicy = originalPolicyPredictor;

const learnedHumanProfile = cloneHumanOpponentProfile();
const pairPassSignal = estimateHumanPassSignal(learnedHumanProfile, HAND_TYPES.PAIR, 10);
assert(learnedHumanProfile.followObservations === 1987
    && Number.isFinite(pairPassSignal.passRate),
    '真人画像已从现有牌谱训练接牌概率模型');
const updatedHumanProfile = observeHumanStrategy(learnedHumanProfile, {
    action: 'pass', phase: 'follow', levelCard: '5', hand: [], cards: [],
    lastPlayType: { type: HAND_TYPES.PAIR }
});
assert(updatedHumanProfile.observations === learnedHumanProfile.observations + 1
    && updatedHumanProfile.followByType[HAND_TYPES.PAIR].pass
        === learnedHumanProfile.followByType[HAND_TYPES.PAIR].pass + 1
    && updatedHumanProfile.followByTypeBand['对子:low'].pass
        === learnedHumanProfile.followByTypeBand['对子:low'].pass + 1,
    '真人每次行动都会增量更新对手画像');
assert(estimateHumanPassSignal(learnedHumanProfile, HAND_TYPES.SINGLE, 199).passRate
    > estimateHumanPassSignal(learnedHumanProfile, HAND_TYPES.SINGLE, 6).passRate,
    '真人画像能区分同牌型不同强度，不再把小单张和控制单张混为一谈');
assert(learnedHumanProfile.observations === 2438 && learnedHumanProfile.choiceObservations === 1096
    && learnedHumanProfile.choiceComparisons === 6283,
    '累计2438步真人牌谱已转化为1096次选牌、6283组成对训练样本');

const onlineChoiceProfile = emptyHumanOpponentProfile();
const onlineChoiceHand = [
    normalCard('3', '♠', 'online-choice-3'),
    normalCard('A', '♣', 'online-choice-a')
];
for (let repetition = 0; repetition < 12; repetition++) {
    trainHumanChoiceModel(onlineChoiceProfile, {
        action: 'play', phase: 'lead', levelCard: '5', hand: onlineChoiceHand,
        cards: [onlineChoiceHand[0]], recordedAt: `2026-09-13T00:00:${String(repetition).padStart(2, '0')}Z`
    });
}
const learnedLowPreference = estimateHumanChoiceSignal(
    onlineChoiceProfile, onlineChoiceHand, [onlineChoiceHand[0]], '5', 'lead'
).preference;
const learnedHighPreference = estimateHumanChoiceSignal(
    onlineChoiceProfile, onlineChoiceHand, [onlineChoiceHand[1]], '5', 'lead'
).preference;
assert(onlineChoiceProfile.choiceObservations === 12
    && onlineChoiceProfile.choiceComparisons === 12
    && onlineChoiceProfile.choiceValidation.decisions === 12
    && learnedLowPreference > learnedHighPreference,
    '真人每次选牌都会立即用实际选择对比其他合法候选并更新偏好');
assert(chooseHumanChoiceScale(learnedHumanProfile) === 0,
    '历史留出验证未胜过稳定策略时，选牌模型只继续学习而不干预正式出牌');
const validatedChoiceProfile = cloneHumanOpponentProfile(learnedHumanProfile);
validatedChoiceProfile.choiceValidation = { decisions: 50, modelCorrect: 35, baselineCorrect: 27 };
assert(chooseHumanChoiceScale(validatedChoiceProfile) === 0.15,
    '滚动样本足够且明显胜过稳定策略后，才自动开启受限的个性化选牌权重');
const profileScoreContext = {
    phase: 'lead', nextOpponentId: 0, nextOppCount: 5,
    humanOpponentCount: 5, humanAdaptationWeight: 400,
    humanProfileLeadMaxCount: 5,
    humanOpponentProfile: learnedHumanProfile,
    useV4PassInference: false, oppPassTypes: [], opponentPasses: [],
    teammateFinished: false, teammateCount: 10, minOpp: 10
};
const pairProfileAdjustment = scoreV2Adjustment(
    [normalCard('6', '♠', 'profile-pair-a'), normalCard('6', '♦', 'profile-pair-b')],
    '5', { type: HAND_TYPES.PAIR, value: 6, length: 2 }, profileScoreContext, []
);
const pairNoProfileAdjustment = scoreV2Adjustment(
    [normalCard('6', '♠', 'profile-pair-c'), normalCard('6', '♦', 'profile-pair-d')],
    '5', { type: HAND_TYPES.PAIR, value: 6, length: 2 },
    { ...profileScoreContext, humanOpponentProfile: null }, []
);
assert(pairProfileAdjustment !== pairNoProfileAdjustment,
    '对立AI会用真人接牌概率修正残局候选评分');
const wrongSeatProfileAdjustment = scoreV2Adjustment(
    [normalCard('6', '♠', 'profile-pair-e'), normalCard('6', '♦', 'profile-pair-f')],
    '5', { type: HAND_TYPES.PAIR, value: 6, length: 2 },
    { ...profileScoreContext, nextOpponentId: 2 }, []
);
assert(wrongSeatProfileAdjustment === pairNoProfileAdjustment,
    '真人画像只在真人确实是下一位对手时生效，不会误套到其AI队友');
const profileVisibilityEngine = new GameEngine();
profileVisibilityEngine.startRound();
profileVisibilityEngine.humanOpponentProfile = learnedHumanProfile;
assert(buildAIContext(profileVisibilityEngine, 1, 'lead').humanOpponentProfile === learnedHumanProfile
    && buildAIContext(profileVisibilityEngine, 2, 'lead').humanOpponentProfile === null,
    '真人画像只对敌方AI可见，不会让真人队友反向利用');
const firstAdaptationWeight = chooseHumanAdaptationWeight(learnedHumanProfile);
const resultLearnedProfile = observeHumanMatchResult(
    learnedHumanProfile, { winnerTeam: 'b' }, firstAdaptationWeight
);
assert(firstAdaptationWeight === 400
    && resultLearnedProfile.experiments.adaptive.games === 1
    && resultLearnedProfile.experiments.adaptive.wins === 1,
    '真人实战胜负会反馈给画像策略与稳定策略的轻量对照学习');

{
const finishEngine = new GameEngine();
finishEngine.levelCard = '9';
finishEngine.hands = [Array(8).fill(null), [normalCard('3', '♣', 'finish-low'),
    { id: 'finish-big', isJoker: true, rank: JOKER_BIG, value: 101, suit: '' }],
    Array(8).fill(null), Array(8).fill(null)];
finishEngine.playerFinished = [false, false, false, false];
finishEngine.lastPlay = null;
finishEngine.lastPlayer = -1;
finishEngine.controlFinishByPlayer = [false, false, false, false];
assert(aiDecidePlay(1, finishEngine)[0].rank === '3',
    '旧版残局会先放小单张，把封顶控制牌留在手里');
finishEngine.controlFinishByPlayer[1] = true;
assert(aiDecidePlay(1, finishEngine)[0].rank === JOKER_BIG,
    '两手收尾先用封顶大王控住牌权，再出最后一张');
finishEngine.hands[1][1] = normalCard('A', '♣', 'finish-ace');
assert(aiDecidePlay(1, finishEngine)[0].rank === '3',
    '外面还有王和级牌时不把A误当封顶牌');

const originalStorage = global.localStorage;
let profileStorage = JSON.stringify({ ...cloneHumanOpponentProfile(), observations: 184,
    trainedThrough: '2026-09-12T08:35:39.023Z', choiceModelVersion: 'old',
    experiments: { adaptive: { games: 7, wins: 3 }, baseline: { games: 6, wins: 2 } } });
global.localStorage = { getItem: () => profileStorage, setItem: (_key, value) => { profileStorage = value; } };
const cachedPass = { action: 'pass', phase: 'follow', levelCard: '5', hand: [], cards: [],
    lastPlayType: { type: HAND_TYPES.PAIR, value: 8 }, recordedAt: '2026-09-27T00:00:01.000Z' };
const cachedLater = { ...cachedPass, recordedAt: '2026-09-27T00:00:02.000Z' };
const migratedProfile = loadHumanOpponentProfile([cachedLater, cachedPass, cachedPass]);
assert(migratedProfile.observations === 2440 && migratedProfile.followObservations === 1989
    && migratedProfile.experiments.adaptive.games === 7,
    '升级画像后补学乱序缓存中的新增跟过牌，去重且保留实战统计');
const reloadedProfile = loadHumanOpponentProfile([cachedPass, cachedLater]);
assert(reloadedProfile.observations === 2440 && reloadedProfile.followObservations === 1989,
    '重复加载同一批缓存不会重复学习');
if (originalStorage === undefined) delete global.localStorage;
else global.localStorage = originalStorage;
}

let simulatedRoundsOk = true;
{
const originalDocument = global.document;
const originalStorage = global.localStorage;
vm.runInThisContext(`
    globalThis.__historyRaw = null;
    globalThis.__historyModalOpened = false;
    globalThis.__historyModalFocused = false;
    globalThis.__historyTriggerFocused = false;
    globalThis.__historyContent = { innerHTML: '' };
    globalThis.__historyModalNode = {
        querySelector: selector => selector === '.modal' ? { scrollTop: 25 }
            : { focus: () => { globalThis.__historyModalFocused = true; } },
        classList: {
            add: name => { if (name === 'show') globalThis.__historyModalOpened = true; },
            remove: name => { if (name === 'show') globalThis.__historyModalOpened = false; }
        }
    };
    globalThis.document = {
        activeElement: { isConnected: true, focus: () => { globalThis.__historyTriggerFocused = true; } },
        getElementById: (id) => id === 'history-modal'
            ? globalThis.__historyModalNode
            : (id === 'history-content' ? globalThis.__historyContent : null)
    };
    globalThis.localStorage = {
        getItem: () => globalThis.__historyRaw,
        setItem: (_key, value) => { globalThis.__historyRaw = value; }
    };
    globalThis.__historyTestState = { savedGameHistoryCount, gameHistoryStorageWarning, gameHistoryStorageReadable };
    globalThis.__historyOriginalHistory = engine.history;
    engine.history = [
        { round: 2, result: { description: '队伍A双上！升3级' }, timestamp: '10:01:02' },
        { round: 3, result: null, timestamp: '' },
        null,
        { round: 4, result: { description: '<img src=x onerror=alert(1)>' }, timestamp: '10:03:04' }
    ];
    savedGameHistoryCount = 0;
    gameHistoryStorageWarning = '';
    gameHistoryStorageReadable = true;
    globalThis.__historyTestSaved = saveCurrentGameHistory();
    showHistoryModal();
`, { filename: 'history-modal-test.js' });
assert(global.__historyTestSaved && global.__historyRaw && JSON.parse(global.__historyRaw).length === 4,
    '对局结束后会把本局记录持久保存在本机');
assert(global.__historyModalOpened && global.__historyContent.innerHTML.includes('第2局')
    && global.__historyContent.innerHTML.includes('结果信息不完整'),
    '历史弹窗能显示完整记录和缺少结果字段的旧记录');
assert(global.__historyContent.innerHTML.includes('&lt;img src=x onerror=alert(1)&gt;')
    && !global.__historyContent.innerHTML.includes('<img src=x onerror=alert(1)>'),
    '历史记录中的文本会转义，损坏或恶意缓存不能插入页面');
assert(global.__historyModalFocused, '打开历史弹窗时键盘焦点进入弹窗');
vm.runInThisContext("closeModal('history-modal');", { filename: 'history-modal-test.js' });
assert(!global.__historyModalOpened && global.__historyTriggerFocused, '关闭历史弹窗后键盘焦点回到原入口');
vm.runInThisContext('globalThis.__historyRaw = "{bad json"; showHistoryModal();', { filename: 'history-modal-test.js' });
assert(global.__historyContent.innerHTML.includes('本局记录仍可查看')
    && global.__historyContent.innerHTML.includes('第2局'),
    '损坏的历史缓存不会阻断本局记录查看，并会给出恢复提示');
vm.runInThisContext(`
    globalThis.__reviewPreviousPending = pendingReviewPositionId;
    globalThis.__reviewOriginal = {hands:engine.hands,state:engine.state,currentPlayer:engine.currentPlayer,
        levelCard:engine.levelCard,lastPlay:engine.lastPlay,lastPlayer:engine.lastPlayer,playedCards:engine.playedCards,selectedCards};
    globalThis.__reviewStore = new Map();
    localStorage = { getItem:key => globalThis.__reviewStore.get(key) ?? null,
        setItem:(key,value) => globalThis.__reviewStore.set(key,value) };
    const privateHand = new Proxy([{id:'secret-opponent'}], {get(target,key) {
        if (key !== 'length') throw new Error('opponent hand read'); return target.length;
    }});
    engine.hands = [[{id:'own-1',suit:'♠',rank:'2'}],privateHand,privateHand,privateHand];
    engine.state='playing';engine.currentPlayer=0;engine.levelCard='5';engine.lastPlay=[];engine.lastPlayer=-1;engine.playedCards=[];selectedCards=[];
    markReviewPosition();
    completeReviewPosition('play', [engine.hands[0][0]]);
    globalThis.__reviewRecorded = localStorage.getItem(REVIEW_POSITIONS_KEY);
    globalThis.__reviewId = JSON.parse(globalThis.__reviewRecorded)[0].id;
    deleteReviewPosition({dataset:{reviewId:globalThis.__reviewId}});
    globalThis.__reviewAfterDelete = localStorage.getItem(REVIEW_POSITIONS_KEY);
    const unsafeRecord = JSON.parse(globalThis.__reviewRecorded)[0];
    unsafeRecord.levelCard = '<img src=x onerror=alert(1)>';
    unsafeRecord.hand[0].rank = '<script>alert(1)</script>';
    localStorage.setItem(REVIEW_POSITIONS_KEY, JSON.stringify([unsafeRecord]));
    showHistoryModal();
    globalThis.__reviewRendered = globalThis.__historyContent.innerHTML;
    localStorage.setItem(REVIEW_POSITIONS_KEY,'{bad json');
    markReviewPosition();
    globalThis.__reviewCorrupt = localStorage.getItem(REVIEW_POSITIONS_KEY);
    const {selectedCards: savedSelection, ...savedEngineFields} = globalThis.__reviewOriginal;
    Object.assign(engine, savedEngineFields);
    selectedCards=globalThis.__reviewOriginal.selectedCards;
    pendingReviewPositionId=globalThis.__reviewPreviousPending;
    delete globalThis.__reviewPreviousPending;
    delete globalThis.__reviewOriginal;
`, { filename: 'review-position-test.js' });
assert(global.__reviewRecorded && JSON.parse(global.__reviewRecorded)[0].hand[0].id === 'own-1'
    && JSON.parse(global.__reviewRecorded)[0].action === 'play'
    && JSON.parse(global.__reviewRecorded)[0].actionCards[0].id === 'own-1'
    && !global.__reviewRecorded.includes('secret-opponent'), '局面记录只包含本人手牌、公开信息和实际选择');
assert(global.__reviewCorrupt === '{bad json', '损坏的局面记录不会被覆盖');
assert(global.__reviewAfterDelete === '[]', '可按标识删除单条本机局面记录');
assert(global.__reviewRendered.includes('&lt;img src=x onerror=alert(1)&gt;')
    && global.__reviewRendered.includes('&lt;script&gt;alert(1)&lt;/script&gt;')
    && !global.__reviewRendered.includes('<script>alert(1)</script>'), '局面记录中的缓存文本被安全转义');
delete global.__reviewRecorded;
delete global.__reviewCorrupt;
delete global.__reviewId;
delete global.__reviewAfterDelete;
delete global.__reviewRendered;
delete global.__reviewStore;
vm.runInThisContext(`
    engine.history = globalThis.__historyOriginalHistory;
    savedGameHistoryCount = globalThis.__historyTestState.savedGameHistoryCount;
    gameHistoryStorageWarning = globalThis.__historyTestState.gameHistoryStorageWarning;
    gameHistoryStorageReadable = globalThis.__historyTestState.gameHistoryStorageReadable;
    delete globalThis.__historyTestState;
    delete globalThis.__historyTestSaved;
    delete globalThis.__historyOriginalHistory;
    delete globalThis.__historyRaw;
    delete globalThis.__historyModalOpened;
    delete globalThis.__historyContent;
    delete globalThis.__historyModalNode;
    delete globalThis.__historyModalFocused;
    delete globalThis.__historyTriggerFocused;
`, { filename: 'history-modal-test.js' });
global.document = originalDocument;
if (originalStorage === undefined) delete global.localStorage;
else global.localStorage = originalStorage;
}

for (let simulation = 0; simulation < 20 && simulatedRoundsOk; simulation++) {
    const simulationEngine = new GameEngine();
    simulationEngine.startRound();
    let steps = 0;
    while (simulationEngine.state === 'playing' && steps < 3000) {
        const playerId = simulationEngine.currentPlayer;
        const choice = aiDecidePlay(playerId, simulationEngine);
        const actionResult = choice && choice.length > 0
            ? simulationEngine.playCards(playerId, choice)
            : simulationEngine.passCards(playerId);
        if (!actionResult.success) {
            simulatedRoundsOk = false;
            break;
        }
        steps++;
    }
    if (simulationEngine.state === 'playing') simulatedRoundsOk = false;
}
assert(simulatedRoundsOk, '20局AI自动对局均能合法结束，无死循环');

console.log(`\n=== 测试结果: ${passCount}通过, ${failCount}失败 ===`);
if (failCount === 0) {
    console.log('✓ 所有测试通过！\n');
    process.exit(0);
} else {
    console.log('✗ 有测试失败，请检查！\n');
    process.exit(1);
}
