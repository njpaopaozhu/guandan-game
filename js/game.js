/**
 * 掼蛋游戏 - 主控制模块
 * 包含：UI渲染、事件处理、游戏流程控制
 */

// ==================== 游戏状态 ====================

let selectedCards = [];  // 当前选中的牌
let soundEnabled = true; // 音效开关
// 深度思考是后台可选功能；默认快速模式保证本地直接打开也不等待Worker。
let deepThinkingEnabled = false;
const DEEP_THINKING_BUDGET_MS = 700;
let deepThinkingClient = null;
let aiDecisionSerial = 0;
const HUMAN_STRATEGY_LOG_KEY = 'guandanHumanStrategyLogV1';
const HUMAN_STRATEGY_LOG_LIMIT = 4000;
let humanStrategyEntries = null;
let humanStrategyStoredRaw = null;
let humanStrategyStorageBlocked = false;
let humanStrategyStorageWarning = '';
const GAME_HISTORY_STORAGE_KEY = 'guandanGameHistoryV1';
const GAME_HISTORY_LIMIT = 500;
let savedGameHistoryCount = 0;
let gameHistoryStorageWarning = '';
let gameHistoryStorageReadable = true;

function readSavedGameHistory() {
    try {
        if (typeof localStorage === 'undefined') throw new Error('Storage unavailable');
        const raw = localStorage.getItem(GAME_HISTORY_STORAGE_KEY);
        if (!raw) return [];
        const records = JSON.parse(raw);
        if (!Array.isArray(records)) throw new Error('Invalid game history');
        gameHistoryStorageReadable = true;
        return records.filter(record => record && typeof record === 'object');
    } catch (_error) {
        gameHistoryStorageReadable = false;
        gameHistoryStorageWarning = '历史记录缓存无法读取，本局记录仍可查看';
        return [];
    }
}

function saveCurrentGameHistory() {
    const current = Array.isArray(engine.history) ? engine.history : [];
    if (savedGameHistoryCount > current.length) savedGameHistoryCount = 0;
    const newRecords = current.slice(savedGameHistoryCount);
    if (newRecords.length === 0) return true;

    try {
        if (typeof localStorage === 'undefined') throw new Error('Storage unavailable');
        const raw = localStorage.getItem(GAME_HISTORY_STORAGE_KEY);
        const stored = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(stored)) throw new Error('Invalid game history');
        const records = stored.concat(newRecords).slice(-GAME_HISTORY_LIMIT);
        localStorage.setItem(GAME_HISTORY_STORAGE_KEY, JSON.stringify(records));
        savedGameHistoryCount = current.length;
        gameHistoryStorageReadable = true;
        gameHistoryStorageWarning = '';
        return true;
    } catch (_error) {
        gameHistoryStorageReadable = false;
        gameHistoryStorageWarning = '历史记录未保存，本局结束前仍可查看';
        return false;
    }
}

function getGameHistoryForDisplay() {
    const stored = readSavedGameHistory();
    const current = Array.isArray(engine.history) ? engine.history : [];
    if (!gameHistoryStorageReadable) return current;
    return stored.concat(current.slice(savedGameHistoryCount));
}

function escapeHistoryText(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
}

function formatGameHistoryRecord(record, index) {
    const source = record && typeof record === 'object' ? record : {};
    const result = source.result && typeof source.result === 'object' ? source.result : {};
    const round = source.round === undefined || source.round === null || source.round === ''
        ? `第${index + 1}局`
        : `第${source.round}局`;
    const winner = typeof result.winnerTeam === 'string' && /^[ab]$/i.test(result.winnerTeam)
        ? `队伍${result.winnerTeam.toUpperCase()}获胜`
        : '结果信息不完整';
    const description = typeof result.description === 'string' && result.description.trim()
        ? result.description.trim()
        : winner;
    const timestamp = typeof source.timestamp === 'string' && source.timestamp.trim()
        ? source.timestamp.trim()
        : (typeof source.recordedAt === 'string' && source.recordedAt.trim() ? source.recordedAt.trim() : '时间未记录');
    return {
        round: escapeHistoryText(round),
        description: escapeHistoryText(description),
        timestamp: escapeHistoryText(timestamp)
    };
}

function getHumanStrategyLog() {
    if (humanStrategyEntries !== null) return humanStrategyEntries;
    humanStrategyEntries = [];
    try {
        if (typeof localStorage === 'undefined') throw new Error('Storage unavailable');
        const raw = localStorage.getItem(HUMAN_STRATEGY_LOG_KEY) || '[]';
        humanStrategyEntries = decodeHumanStrategyLog(raw);
        humanStrategyStoredRaw = raw;
    } catch (_error) {
        // 旧记录不可读时不覆盖它；本次打开页面后的记录仍可在内存中学习和导出。
        humanStrategyStorageBlocked = true;
        humanStrategyStorageWarning = '历史记录未读取；本次记录请先导出';
    }
    return humanStrategyEntries;
}

function persistHumanStrategyLog() {
    const entries = refreshHumanStrategyLog();
    if (humanStrategyStorageBlocked) return false;
    try {
        const raw = encodeHumanStrategyLog(entries);
        localStorage.setItem(HUMAN_STRATEGY_LOG_KEY, raw);
        humanStrategyStoredRaw = raw;
        humanStrategyStorageWarning = '';
        return true;
    } catch (_error) {
        humanStrategyStorageWarning = '新记录未保存；关闭前请导出';
        return false;
    }
}

function refreshHumanStrategyLog() {
    const entries = getHumanStrategyLog();
    if (humanStrategyStorageBlocked) return entries;
    try {
        const raw = localStorage.getItem(HUMAN_STRATEGY_LOG_KEY) || '[]';
        if (raw === humanStrategyStoredRaw) return entries;
        const stored = decodeHumanStrategyLog(raw);
        // 另一个游戏页面可能已追加记录。按完整快照合并，保留本页未保存的行动；
        // 相同历史记录只取两个副本中的最大出现次数，不重复追加，也不删历史重复。
        const remaining = new Map();
        for (const entry of stored) {
            const key = JSON.stringify(entry);
            remaining.set(key, (remaining.get(key) || 0) + 1);
        }
        const merged = stored.slice();
        for (const entry of entries) {
            const key = JSON.stringify(entry);
            const count = remaining.get(key) || 0;
            if (count > 0) remaining.set(key, count - 1);
            else merged.push(entry);
        }
        merged.sort((a, b) => String(a.recordedAt || '').localeCompare(String(b.recordedAt || '')));
        humanStrategyEntries = merged.slice(-HUMAN_STRATEGY_LOG_LIMIT);
        humanStrategyStoredRaw = raw;
    } catch (_error) {
        humanStrategyStorageBlocked = true;
        humanStrategyStorageWarning = '存储记录无法读取；请先导出可用记录';
    }
    return humanStrategyEntries;
}

function strategyCardSnapshot(card) {
    return { suit: card.suit, rank: card.rank, isJoker: Boolean(card.isJoker), id: card.id };
}

function updateHumanLearningDisplay() {
    const target = document.getElementById('ai-learning');
    const profile = engine && engine.humanOpponentProfile;
    if (!target || !profile) return;
    const experiments = profile.experiments || {};
    const games = (experiments.adaptive && experiments.adaptive.games || 0)
        + (experiments.baseline && experiments.baseline.games || 0);
    target.textContent = `${profile.observations || 0}步 / ${profile.choiceObservations || 0}次选牌 / ${games}局`;
    if (humanStrategyStorageWarning) target.textContent += `（${humanStrategyStorageWarning}）`;
    target.title = humanStrategyStorageWarning || `本机可导出 ${getHumanStrategyLog().length} 条记录；仅学习公开信息`;
}

/** 仅保存真人出牌前可见的信息，绝不记录对手未公开手牌。 */
function recordHumanStrategy(action, cards = []) {
    if (!engine || engine.currentPlayer !== 0) return;
    try {
        const entry = {
            schema: 'guandan-local-human-strategy-v1',
            recordedAt: new Date().toISOString(),
            round: engine.roundNumber,
            levelCard: engine.levelCard,
            phase: !engine.lastPlay || engine.lastPlayer === 0 ? 'lead' : 'follow',
            hand: engine.hands[0].map(strategyCardSnapshot),
            action,
            cards: cards.map(strategyCardSnapshot),
            lastPlay: (engine.lastPlay || []).map(strategyCardSnapshot),
            lastPlayType: engine.lastPlayType ? { ...engine.lastPlayType } : null,
            lastPlayer: engine.lastPlayer,
            passCount: engine.passCount,
            cardCounts: engine.hands.map(hand => hand.length),
            playedCards: (engine.playedCards || []).map(strategyCardSnapshot),
            passMemory: (engine.passMemory || []).map(item => ({ ...item }))
        };
        const next = getHumanStrategyLog();
        next.push(entry);
        humanStrategyEntries = next.slice(-HUMAN_STRATEGY_LOG_LIMIT);
        // 保存失败不能再阻断画像学习；导出始终读取包含最新行动的内存记录。
        persistHumanStrategyLog();
        if (typeof observeHumanStrategy === 'function') {
            engine.humanOpponentProfile = observeHumanStrategy(engine.humanOpponentProfile, entry);
            if (typeof chooseHumanChoiceScale === 'function') {
                engine.humanChoiceScale = chooseHumanChoiceScale(engine.humanOpponentProfile);
            }
            saveHumanOpponentProfile(engine.humanOpponentProfile);
        }
        updateHumanLearningDisplay();
    } catch (_error) {
        // 浏览器禁用本地存储时不影响游戏进行。
    }
}

function exportHumanStrategyLog() {
    try {
        const entries = refreshHumanStrategyLog();
        if (!Array.isArray(entries) || entries.length === 0) {
            showMessage('还没有可导出的真人出牌记录。');
            return;
        }
        const blob = new Blob([JSON.stringify({
            schema: 'guandan-local-human-strategy-v1', exportedAt: new Date().toISOString(), entries
        }, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `guandan-human-strategy-${Date.now()}.json`;
        link.click();
        URL.revokeObjectURL(url);
        const warning = humanStrategyStorageBlocked ? '（仅包含当前页面可用记录）' : '';
        showMessage(`已导出 ${entries.length} 条真人策略记录${warning}。`);
    } catch (_error) {
        showMessage('导出失败：本机策略记录不可用。');
    }
}

// ==================== 游戏初始化 ====================

/**
 * 初始化游戏
 */
function initGame() {
    const entries = getHumanStrategyLog();
    // 在同一个key中原子替换为无损紧凑格式，保留旧版所有记录并释放容量。
    if (entries.length > 0) persistHumanStrategyLog();
    if (typeof loadHumanOpponentProfile === 'function') {
        engine.humanOpponentProfile = loadHumanOpponentProfile(entries);
        updateHumanLearningDisplay();
    }
    setupEventListeners();
    showWelcomeScreen();
}

/**
 * 设置事件监听器
 */
function setupEventListeners() {
    // 键盘快捷键
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            if (engine.state === 'playing' && engine.currentPlayer === 0) {
                playSelectedCards();
            }
        } else if (e.key === 'Escape') {
            if (engine.state === 'playing' && engine.currentPlayer === 0) {
                passTurn();
            }
        } else if (e.key === 's' || e.key === 'S') {
            sortMyCards();
        }
    });
}

/**
 * 显示欢迎界面
 */
function showWelcomeScreen() {
    updateUI();
    showMessage('点击"开始游戏"发牌');
}

// ==================== 游戏流程控制 ====================

/** 终止过期后台推演，避免上一局结果写入新局。 */
function cancelDeepThinking() {
    if (deepThinkingClient) deepThinkingClient.dispose();
    deepThinkingClient = null;
}

/** 快速内置AI始终在主线程同步生成，作为Worker异常或超时的合法回退。 */
function decideFastBuiltinAI(playerId, activeEngine) {
    const previousMode = activeEngine.aiStrategyMode;
    activeEngine.aiStrategyMode = 'v3';
    try {
        return aiDecidePlay(playerId, activeEngine);
    } finally {
        activeEngine.aiStrategyMode = previousMode;
    }
}

/**
 * 深度推演只在Worker运行。主线程700ms到期会终止Worker并使用已验证的快速动作，
 * 因此同步回放再慢也不会冻结牌桌。
 */
async function decideBuiltinAI(playerId, activeEngine) {
    const fallback = decideFastBuiltinAI(playerId, activeEngine);
    if (!deepThinkingEnabled || !String(activeEngine.aiStrategyMode || '').startsWith('v5-rollout')
        || typeof Worker !== 'function' || typeof V5PublicWorkerClient !== 'function') return fallback;
    try {
        const packet = encodePublicDecision(activeEngine, playerId);
        if (!deepThinkingClient || deepThinkingClient.disposed) {
            deepThinkingClient = new V5PublicWorkerClient(() => new Worker('js/v5-rollout-worker.js'));
        }
        const fallbackIds = fallback?.length ? fallback.map(card => card.id) : null;
        const decision = await deepThinkingClient.request(packet, DEEP_THINKING_BUDGET_MS, fallbackIds);
        if (!['result', 'timeout', 'worker-error'].includes(decision.status)) return fallback;
        if (decision.action === null) return null;
        const byId = new Map(activeEngine.hands[playerId].map(card => [card.id, card]));
        const cards = decision.action.map(id => byId.get(id));
        return cards.some(card => !card) ? fallback : cards;
    } catch (_error) {
        return fallback;
    }
}

/**
 * 开始新游戏
 */
function startNewGame() {
    cancelDeepThinking();
    aiDecisionSerial++;
    engine.reset();
    // 参考F盘：仅在领牌时回放公开采样世界，跟牌保留原有队友配合和封堵策略。
    engine.aiStrategyMode = deepThinkingEnabled ? 'v5-rollout-lead' : 'v3';
    savedGameHistoryCount = 0;
    gameHistoryStorageWarning = '';
    gameHistoryStorageReadable = true;
    if (typeof chooseHumanAdaptationWeight === 'function') {
        engine.humanAdaptationWeight = chooseHumanAdaptationWeight(engine.humanOpponentProfile);
    }
    if (typeof chooseHumanChoiceScale === 'function') {
        engine.humanChoiceScale = chooseHumanChoiceScale(engine.humanOpponentProfile);
    }
    const result = engine.startRound();
    
    selectedCards = [];
    resetTableDisplay();
    
    updateUI();
    showMessage(`第${engine.roundNumber}局开始！当前级牌：${result.levelCard}`);
    
    if (engine.currentPlayer !== 0) {
        setTimeout(() => aiPlay(), 1000);
    }
}

/**
 * 开始下一局
 */
function startNextRound() {
    cancelDeepThinking();
    aiDecisionSerial++;
    if (engine.matchOver) {
        showGameOverModal(engine.matchWinner.toUpperCase());
        return;
    }
    
    if (typeof chooseHumanAdaptationWeight === 'function') {
        engine.humanAdaptationWeight = chooseHumanAdaptationWeight(engine.humanOpponentProfile);
    }
    if (typeof chooseHumanChoiceScale === 'function') {
        engine.humanChoiceScale = chooseHumanChoiceScale(engine.humanOpponentProfile);
    }
    const result = engine.startRound();
    selectedCards = [];
    resetTableDisplay();
    
    updateUI();

    // 贡还牌不能只闪现一条消息：先明确展示实际交换结果，确认后再开始出牌。
    if (result.tributeResisted || result.tributeExchanges.length > 0 || result.pendingPlayerReturns.length > 0) {
        showTributeResultModal(result);
        return;
    }

    continueCurrentRound();
}

/** 显示本局发牌后真正发生的贡还牌结果。 */
function showTributeResultModal(roundResult) {
    const modal = document.getElementById('round-end-modal');
    const content = document.getElementById('round-end-content');
    const names = ['你', '玩家1', '玩家2', '玩家3'];
    let html = `<h2>第${engine.roundNumber}局贡还牌</h2><div class="result-info">`;

    const pendingReturn = engine.pendingPlayerReturns[0];
    if (roundResult.tributeResisted) {
        html += '<p><strong>抗贡成功</strong></p><p>贡方合计持有两张大王，本局不进贡、不还牌。</p>';
    } else if (pendingReturn) {
        const tributeCard = `${pendingReturn.tributeCard.suit}${pendingReturn.tributeCard.rank}`;
        const returnCandidates = engine.hands[pendingReturn.to]
            .filter(card => !card.isJoker && card.value <= 10);
        html += `<p><strong>${names[pendingReturn.from]} 向你进贡 ${tributeCard}</strong></p>`
            + '<p>请选择自己的一张不高于10的牌还给进贡方：</p><div class="return-card-options">';
        returnCandidates.forEach(card => {
            const colorClass = card.suit === '♥' || card.suit === '♦' ? 'red' : 'black';
            html += `<button class="return-card-option ${colorClass}" data-card-id="${card.id}"`
                + ' onclick="confirmPlayerReturn(this.dataset.cardId);">'
                + `<span>${card.suit}</span><strong>${card.rank}</strong></button>`;
        });
        html += '</div>';
    } else {
        html += '<p><strong>贡还牌已实际完成，双方手牌已经更新：</strong></p>';
        roundResult.tributeExchanges.forEach(exchange => {
            const tributeCard = `${exchange.tributeCard.suit}${exchange.tributeCard.rank}`;
            const returnCard = `${exchange.returnCard.suit}${exchange.returnCard.rank}`;
            html += `<p>${names[exchange.from]} 向 ${names[exchange.to]} 进贡 <strong>${tributeCard}</strong><br>`
                + `${names[exchange.to]} 向 ${names[exchange.from]} 还牌 <strong>${returnCard}</strong></p>`;
        });
    }

    if (!pendingReturn) {
        html += `<p>本局由 <strong>${names[engine.currentPlayer]}</strong> 先出牌</p>`;
    }
    html += '</div>';
    if (!pendingReturn) {
        html += '<div class="modal-buttons"><button class="btn btn-primary" onclick="continueAfterTribute();">确认，开始出牌</button></div>';
    }
    content.innerHTML = html;
    modal.querySelector('.modal').scrollTop = 0;
    modal.classList.add('show');
}

function confirmPlayerReturn(cardId) {
    const result = engine.completePlayerReturn(cardId);
    if (!result.success) {
        showMessage(result.error);
        return;
    }

    selectedCards = [];
    updateUI();
    showTributeResultModal({
        tributeResisted: false,
        tributeExchanges: [...engine.lastTributeExchanges],
        pendingPlayerReturns: [...engine.pendingPlayerReturns]
    });
}

function continueAfterTribute() {
    closeModal('round-end-modal');
    continueCurrentRound();
}

function continueCurrentRound() {
    const tributeText = engine.lastTributeResisted
        ? '抗贡成功'
        : formatTributeExchanges(engine.lastTributeExchanges);
    showMessage(`第${engine.roundNumber}局开始！当前级牌：${engine.levelCard}${tributeText ? `；${tributeText}` : ''}`);

    if (engine.currentPlayer !== 0) {
        setTimeout(() => aiPlay(), 1000);
    }
}

/**
 * 切换深度回放与快速策略
 */
function toggleDeepThinking() {
    deepThinkingEnabled = !deepThinkingEnabled;
    engine.aiStrategyMode = deepThinkingEnabled ? 'v5-rollout-lead' : 'v3';
    const button = document.getElementById('btn-deep-thinking');
    if (button) {
        button.textContent = `🧠 深度思考：${deepThinkingEnabled ? '开' : '关'}`;
        button.setAttribute('aria-pressed', String(deepThinkingEnabled));
    }
    showMessage(deepThinkingEnabled ? '已开启深度思考，AI会比较可能的后续牌局' : '已切换快速模式，保留小牌清理和队友配合');
}

/** AI出牌。 */
async function aiPlay() {
    if (engine.state !== 'playing') return;
    if (engine.currentPlayer === 0) return;
    
    const playerId = engine.currentPlayer;
    const decisionSerial = ++aiDecisionSerial;
    const turnKey = typeof proAITurnKey === 'function' ? proAITurnKey(playerId, engine) : null;
    const cards = typeof decideWithProAI === 'function'
        ? await decideWithProAI(playerId, engine, () => decideBuiltinAI(playerId, engine),
            () => decisionSerial === aiDecisionSerial)
        : await decideBuiltinAI(playerId, engine);
    if (decisionSerial !== aiDecisionSerial || engine.state !== 'playing' || engine.currentPlayer !== playerId
        || (typeof PRO_AI_CANCELLED === 'symbol' && cards === PRO_AI_CANCELLED)
        || (turnKey !== null && proAITurnKey(playerId, engine) !== turnKey)) return;
    
    if (cards && cards.length > 0) {
        // 出牌
        const result = engine.playCards(playerId, cards);
        if (result.success) {
            const handType = result.handType;
            showPlayedCards(cards, handType, `玩家${playerId}`);
            showMessage(`玩家${playerId}出了${handType.type}`);
            
            if (result.playerFinished) {
                showFinishMessage(playerId);
            }
            
            updateUI();
            
            if (result.type === 'roundEnd') {
                showRoundEndModal(result.result);
                return;
            }
            
            // 继续AI出牌
            if (engine.currentPlayer !== 0) {
                setTimeout(() => aiPlay(), 1000);
            }
        } else {
            // AI搜索结果即使出现边界情况，也不能让整个回合停住。
            const passResult = engine.passCards(playerId);
            if (passResult.success) {
                showMessage(`玩家${playerId}过牌`);
                updateUI();
                if (engine.currentPlayer !== 0) setTimeout(() => aiPlay(), 800);
            }
        }
    } else {
        // 过牌
        const result = engine.passCards(playerId);
        if (result.success) {
            showMessage(`玩家${playerId}过牌`);
            updateUI();
            
            if (result.type === 'roundEnd') {
                showRoundEndModal(result.result);
                return;
            }
            
            if (engine.currentPlayer !== 0) {
                setTimeout(() => aiPlay(), 800);
            }
        }
    }
}

/**
 * 玩家出选中的牌
 */
function playSelectedCards() {
    if (engine.state !== 'playing') return;
    if (engine.currentPlayer !== 0) return;
    
    if (selectedCards.length === 0) {
        showMessage('请选择要出的牌');
        return;
    }
    
    const selectedType = identifyHand(selectedCards, engine.levelCard);
    const legalBeforePlay = selectedType.valid && (!engine.lastPlay || engine.lastPlayer === 0
        || canBeat(selectedType, engine.lastPlayType));
    if (legalBeforePlay) recordHumanStrategy('play', selectedCards);
    const result = engine.playCards(0, selectedCards);
    
    if (!result.success) {
        showMessage(result.error);
        return;
    }
    
    const handType = result.handType;
    showPlayedCards(selectedCards, handType, '你');
    showMessage(`你出了${handType.type}`);
    
    selectedCards = [];
    
    if (result.playerFinished) {
        showFinishMessage(0);
    }
    
    updateUI();
    updateHandTypeHint();
    
    if (result.type === 'roundEnd') {
        showRoundEndModal(result.result);
        return;
    }
    
    if (engine.currentPlayer !== 0) {
        setTimeout(() => aiPlay(), 1000);
    }
}

/**
 * 玩家过牌
 */
function passTurn() {
    if (engine.state !== 'playing') return;
    if (engine.currentPlayer !== 0) return;
    
    if (engine.lastPlay && engine.lastPlayer !== 0) recordHumanStrategy('pass');
    const result = engine.passCards(0);
    
    if (!result.success) {
        showMessage(result.error);
        return;
    }
    
    showMessage('你选择过牌');
    selectedCards = [];
    updateUI();
    updateHandTypeHint();
    
    if (result.type === 'roundEnd') {
        showRoundEndModal(result.result);
        return;
    }
    
    if (engine.currentPlayer !== 0) {
        setTimeout(() => aiPlay(), 1000);
    }
}

/**
 * 投降
 */
function surrenderGame() {
    if (engine.state !== 'playing') return;
    
    if (!confirm('确定要投降吗？')) return;
    
    const result = engine.surrender(0);
    
    if (result.success) {
        showRoundEndModal(result.result);
    }
}

/**
 * 整理手牌
 */
function sortMyCards() {
    if (engine.state !== 'playing') return;
    sortHand(engine.hands[0], engine.levelCard);
    selectedCards = [];
    updateUI();
    updateHandTypeHint();
    showMessage('手牌已整理');
}

/**
 * 清除选中
 */
function clearSelection() {
    selectedCards = [];
    updateUI();
    updateHandTypeHint();
    showMessage('已清除选择');
}

/**
 * 推荐出牌并高亮
 */
function recommendAndHighlight() {
    if (engine.state !== 'playing') return;
    if (engine.currentPlayer !== 0) return;
    
    const hand = engine.hands[0];
    const lastType = (engine.lastPlayer !== -1 && engine.lastPlayer !== 0) ? engine.lastPlayType : null;
    
    const recommended = recommendPlay(hand, lastType, engine.levelCard);
    
    if (!recommended) {
        showMessage('无法压过上家，建议过牌');
        selectedCards = [];
        updateUI();
        return;
    }
    
    // 设置选中为推荐的牌
    selectedCards = [...recommended];
    updateUI();
    updateHandTypeHint();
    
    // 显示提示
    const handType = identifyHand(recommended, engine.levelCard);
    showMessage(`推荐出牌: ${handType.type}`);
}

// ==================== UI更新 ====================

/**
 * 更新整个UI
 */
function updateUI() {
    updateHeader();
    updatePlayers();
    updateButtons();
}

/**
 * 更新头部信息
 */
function updateHeader() {
    document.getElementById('level-card').textContent = engine.levelCard;
    document.getElementById('round').textContent = engine.roundNumber;
    
    const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    document.getElementById('level-a').textContent = ranks[engine.teamLevel.a];
    document.getElementById('level-b').textContent = ranks[engine.teamLevel.b];
}

/**
 * 更新玩家区域
 */
function updatePlayers() {
    // 玩家0（底部，自己）
    renderPlayerCards('player-bottom', engine.hands[0], true, 0);
    
    // 玩家1（左侧）
    renderPlayerCards('player-left', engine.hands[1], false, 1);
    
    // 玩家2（顶部，队友）
    renderPlayerCards('player-top', engine.hands[2], false, 2);
    
    // 玩家3（右侧）
    renderPlayerCards('player-right', engine.hands[3], false, 3);
    
    // 更新活跃玩家高亮（用 data-player 属性精确匹配）
    document.querySelectorAll('.player').forEach((el) => {
        const playerId = parseInt(el.getAttribute('data-player'));
        el.classList.remove('active');
        if (playerId === engine.currentPlayer && engine.state === 'playing') {
            el.classList.add('active');
        }
        
        // 标记已出完牌的玩家
        if (engine.playerFinished[playerId]) {
            el.classList.add('finished');
        } else {
            el.classList.remove('finished');
        }
    });
}

/**
 * 渲染玩家手牌
 */
function renderPlayerCards(containerId, hand, showFace, playerId) {
    const playerEl = document.getElementById(containerId);
    const container = playerEl.querySelector('.cards-row');
    if (!container) return;
    
    container.innerHTML = '';
    container.style.setProperty('--card-count', hand.length);
    
    // 更新手牌数量显示
    const countEl = playerEl.querySelector('.card-count');
    if (countEl) {
        countEl.textContent = `${hand.length}张`;
    }
    
    if (showFace) {
        // 显示正面（玩家自己）
        hand.forEach((card, idx) => {
            const cardEl = createCardElement(card, playerId);
            container.appendChild(cardEl);
        });
    } else {
        // 显示背面（其他玩家）
        hand.forEach((card, idx) => {
            const cardEl = document.createElement('div');
            cardEl.className = 'card card-back';
            container.appendChild(cardEl);
        });
    }
}

/**
 * 创建卡牌元素
 */
function createCardElement(card, playerId) {
    const cardEl = document.createElement('div');
    cardEl.className = 'card';
    
    if (card.isJoker) {
        cardEl.classList.add(card.rank === '大王' ? 'joker-big' : 'joker-small');
        cardEl.innerHTML = `<div class="card-rank">${card.rank}</div>`;
    } else {
        const isRed = card.suit === '♥' || card.suit === '♦';
        cardEl.classList.add(isRed ? 'red' : 'black');
        
        // 标记级牌
        if (card.rank === engine.levelCard) {
            cardEl.classList.add('level-card');
        }
        
        cardEl.innerHTML = `
            <div class="card-suit">${card.suit}</div>
            <div class="card-rank">${card.rank}</div>
        `;
    }
    
    // 检查是否选中
    if (selectedCards.find(c => c.id === card.id)) {
        cardEl.classList.add('selected');
    }
    
    // 点击事件
    if (playerId === 0 && engine.state === 'playing' && engine.currentPlayer === 0) {
        cardEl.onclick = () => toggleCardSelection(card, cardEl);
    }
    
    return cardEl;
}

/**
 * 切换卡牌选中状态
 */
function toggleCardSelection(card, element) {
    if (engine.state !== 'playing') return;
    if (engine.currentPlayer !== 0) return;
    
    const idx = selectedCards.findIndex(c => c.id === card.id);
    
    if (idx === -1) {
        // 选中
        selectedCards.push(card);
        element.classList.add('selected');
    } else {
        // 取消选中
        selectedCards.splice(idx, 1);
        element.classList.remove('selected');
    }
    
    // 显示选中牌型
    updateHandTypeHint();
    updateButtons();
}

/**
 * 更新选中牌型提示
 */
function updateHandTypeHint() {
    const hintEl = document.getElementById('hand-type-hint');
    if (!hintEl) return;
    
    if (selectedCards.length === 0) {
        hintEl.textContent = '';
        return;
    }
    
    const handType = identifyHand(selectedCards, engine.levelCard);
    
    if (handType.valid) {
        hintEl.textContent = `选中: ${handType.type}`;
        hintEl.style.color = '#00ff88';
    } else {
        hintEl.textContent = '选中: 无效牌型';
        hintEl.style.color = '#ff6b6b';
    }
}

/**
 * 更新按钮状态
 */
function updateButtons() {
    const isMyTurn = engine.state === 'playing' && engine.currentPlayer === 0;
    const hasLastPlay = engine.lastPlay && engine.lastPlayer !== 0;
    const selectedType = identifyHand(selectedCards, engine.levelCard);
    
    const startButton = document.getElementById('btn-start');
    const roundInProgress = engine.state === 'playing' || engine.state === 'tribute';
    startButton.disabled = roundInProgress;
    startButton.textContent = roundInProgress
        ? '游戏进行中'
        : engine.history.length > 0 ? '重新开始' : '开始游戏';
    document.getElementById('btn-play').disabled = !isMyTurn || !selectedType.valid;
    document.getElementById('btn-pass').disabled = !isMyTurn || !hasLastPlay;
    document.getElementById('btn-recommend').disabled = !isMyTurn;
    document.getElementById('btn-clear').disabled = !isMyTurn || selectedCards.length === 0;
    document.getElementById('btn-surrender').disabled = engine.state !== 'playing';
}

/**
 * 显示出的牌
 */
function showPlayedCards(cards, handType, playerName) {
    const container = document.getElementById('played-cards');
    container.innerHTML = '';
    
    cards.forEach(card => {
        const cardEl = document.createElement('div');
        cardEl.className = 'card';
        
        if (card.isJoker) {
            cardEl.classList.add(card.rank === '大王' ? 'joker-big' : 'joker-small');
            cardEl.innerHTML = `<div class="card-rank">${card.rank}</div>`;
        } else {
            const isRed = card.suit === '♥' || card.suit === '♦';
            cardEl.classList.add(isRed ? 'red' : 'black');
            
            if (card.rank === engine.levelCard) {
                cardEl.classList.add('level-card');
            }
            
            cardEl.innerHTML = `
                <div class="card-suit">${card.suit}</div>
                <div class="card-rank">${card.rank}</div>
            `;
        }
        
        container.appendChild(cardEl);
    });
    
    // 显示牌型信息
    const infoEl = document.getElementById('play-info');
    if (infoEl) {
        infoEl.innerHTML = `
            <span class="player-name-text">${playerName}</span>
            出了
            <span class="type-name">${handType.type}</span>
        `;
    }
}

function resetTableDisplay() {
    const cardsEl = document.getElementById('played-cards');
    const infoEl = document.getElementById('play-info');
    if (cardsEl) cardsEl.innerHTML = '';
    if (infoEl) infoEl.textContent = '';
    updateHandTypeHint();
}

function formatTributeExchanges(exchanges) {
    if (!Array.isArray(exchanges) || exchanges.length === 0) return '';

    const names = ['你', '玩家1', '玩家2', '玩家3'];
    return exchanges.map(exchange => {
        if (!exchange || !exchange.tributeCard || !exchange.returnCard) return '';
        const tributeCard = `${exchange.tributeCard.suit}${exchange.tributeCard.rank}`;
        const returnCard = `${exchange.returnCard.suit}${exchange.returnCard.rank}`;
        return `${names[exchange.from]}进贡${tributeCard}，${names[exchange.to]}还牌${returnCard}`;
    }).filter(Boolean).join('；');
}

/**
 * 显示消息
 */
function showMessage(msg) {
    const msgEl = document.getElementById('message');
    if (msgEl) {
        msgEl.textContent = msg;
    }
}

/**
 * 显示出完牌消息
 */
function showFinishMessage(playerId) {
    const names = ['你', '玩家1', '玩家2', '玩家3'];
    showMessage(`🎉 ${names[playerId]}出完牌了！`);
}

// ==================== 弹窗显示 ====================

/**
 * 显示回合结束弹窗
 */
function showRoundEndModal(result) {
    saveCurrentGameHistory();
    if (typeof observeHumanMatchResult === 'function'
        && engine.lastProfileRecordedRound !== engine.roundNumber - 1) {
        engine.humanOpponentProfile = observeHumanMatchResult(
            engine.humanOpponentProfile, result, engine.humanAdaptationWeight || 0
        );
        saveHumanOpponentProfile(engine.humanOpponentProfile);
        updateHumanLearningDisplay();
        engine.lastProfileRecordedRound = engine.roundNumber - 1;
    }
    const modal = document.getElementById('round-end-modal');
    const content = document.getElementById('round-end-content');
    
    let html = `
        <h2>第${engine.roundNumber - 1}局结束</h2>
        <div class="result-info">
            <p><strong>${result.description}</strong></p>
            <p>级别变化：${result.levelBefore} → ${result.levelAfter}</p>
    `;
    
    if (result.finishOrder && result.finishOrder.length > 0) {
        const names = ['你', '玩家1', '玩家2', '玩家3'];
        html += '<h3>出牌顺序：</h3><ol>';
        result.finishOrder.forEach(playerId => {
            html += `<li>${names[playerId]}</li>`;
        });
        html += '</ol>';
    }
    
    // 此时仅确定下一局的贡牌关系；具体牌要等下一局重新发牌后才能产生。
    if (result.tributes && result.tributes.length > 0) {
        const names = ['你', '玩家1', '玩家2', '玩家3'];
        html += '<h3>下一局贡牌安排：</h3>';
        result.tributes.forEach(tribute => {
            const fromName = names[tribute.from];
            const toName = names[tribute.to];
            html += `<p>${fromName} 将在下一局发牌后向 ${toName} 进贡，并接受还牌</p>`;
        });
    }
    
    html += `
        <p><strong>队伍A级别：${['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'][engine.teamLevel.a]}</strong></p>
        <p><strong>队伍B级别：${['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'][engine.teamLevel.b]}</strong></p>
    `;
    
    if (result.gameOver) {
        html += `<p style="color: #ffd700; font-size: 20px;">🏆 游戏结束！🏆</p>`;
    }
    
    html += `
        </div>
        <div class="modal-buttons">
            <button class="btn btn-primary" onclick="executeTributeAndStartNext();">
                ${result.gameOver ? '查看最终结果' : '确认并开始下一局'}
            </button>
            <button class="btn btn-secondary" onclick="showHistoryModal();">查看记录</button>
        </div>
    `;
    
    content.innerHTML = html;
    modal.classList.add('show');
}

/**
 * 执行贡牌交换并开始下一局
 */
function executeTributeAndStartNext() {
    // 关闭弹窗
    closeModal('round-end-modal');
    
    // 开始下一局
    startNextRound();
}

/**
 * 显示游戏结束弹窗
 */
function showGameOverModal(winner) {
    const modal = document.getElementById('game-over-modal');
    const content = document.getElementById('game-over-content');
    
    content.innerHTML = `
        <h2>🏆 恭喜！🏆</h2>
        <div class="result-info">
            <p style="font-size: 24px; color: #ffd700;">队伍${winner}获得最终胜利！</p>
            <p>共进行：${engine.history.length}局</p>
        </div>
        <div class="modal-buttons">
            <button class="btn btn-primary" onclick="closeModal('game-over-modal'); startNewGame();">再来一局</button>
            <button class="btn btn-secondary" onclick="closeModal('game-over-modal'); showHistoryModal();">查看记录</button>
        </div>
    `;
    
    modal.classList.add('show');
}

/**
 * 显示历史记录弹窗
 */
function showHistoryModal() {
    const modal = document.getElementById('history-modal');
    const content = document.getElementById('history-content');
    if (!modal || !content) return;
    const records = getGameHistoryForDisplay();
    
    let html = '<h2>游戏记录</h2>';
    
    if (records.length === 0) {
        html += '<p>暂无记录</p>';
    } else {
        html += '<div class="history-list">';
        records.forEach((record, idx) => {
            const display = formatGameHistoryRecord(record, idx);
            html += `
                <div class="history-item">
                    <span class="history-round">${display.round}</span>
                    <span class="history-winner">${display.description}</span>
                    <span class="history-detail">${display.timestamp}</span>
                </div>
            `;
        });
        html += '</div>';
    }
    if (gameHistoryStorageWarning) html += `<p class="history-note">${escapeHistoryText(gameHistoryStorageWarning)}</p>`;
    
    html += `
        <div class="modal-buttons">
            <button class="btn btn-primary" onclick="closeModal('history-modal');">关闭</button>
        </div>
    `;
    
    content.innerHTML = html;
    const modalPanel = modal.querySelector('.modal');
    if (modalPanel) modalPanel.scrollTop = 0;
    modal.classList.add('show');
}

/**
 * 显示帮助弹窗
 */
function showHelpModal() {
    const modal = document.getElementById('help-modal');
    modal.querySelector('.modal').scrollTop = 0;
    modal.classList.add('show');
}

function showProAISettings() {
    const settings = typeof loadProAISettings === 'function' ? loadProAISettings() : null;
    if (!settings) return;
    document.getElementById('pro-ai-enabled').checked = settings.enabled;
    document.getElementById('pro-ai-endpoint').value = settings.endpoint;
    document.getElementById('pro-ai-timeout').value = settings.timeoutMs;
    const status = proAIStatus.detail || `${proAIStatus.mode}；已使用 ${proAIStatus.uses} 次，回退 ${proAIStatus.fallbacks} 次`;
    document.getElementById('pro-ai-status').textContent = status;
    document.getElementById('pro-ai-modal').classList.add('show');
}

function saveProAISettingsFromUI() {
    try {
        saveProAISettings({
            enabled: document.getElementById('pro-ai-enabled').checked,
            endpoint: document.getElementById('pro-ai-endpoint').value,
            timeoutMs: document.getElementById('pro-ai-timeout').value
        });
        closeModal('pro-ai-modal');
        showMessage(proAISettings.enabled ? '专业AI已启用；服务异常时自动回退。' : '已使用内置AI策略。');
    } catch (error) {
        document.getElementById('pro-ai-status').textContent = error.message || '设置无效';
    }
}

/**
 * 关闭弹窗
 */
function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('show');
}

// ==================== 音效控制 ====================

/**
 * 切换音效
 */
function toggleSound() {
    soundEnabled = !soundEnabled;
    const btn = document.getElementById('btn-sound');
    btn.textContent = soundEnabled ? '🔊 音效' : '🔇 静音';
}

/**
 * 播放音效
 */
function playSound(type) {
    if (!soundEnabled) return;
    
    // 这里可以添加实际的音效播放逻辑
    // 使用Web Audio API或Audio元素
}

// ==================== 初始化 ====================

window.onload = initGame;
