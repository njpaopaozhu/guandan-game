/** 真人牌谱的无损存储编码；导出时仍使用完整原始记录。 */
const HUMAN_STRATEGY_STORE_SCHEMA = 'guandan-human-strategy-store-v2';
const HUMAN_STRATEGY_CARD_FIELDS = ['hand', 'cards', 'lastPlay', 'playedCards'];

function isHumanStrategyObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateHumanStrategyEntries(entries) {
    if (!Array.isArray(entries) || !entries.every(isHumanStrategyObject)) {
        throw new Error('真人牌谱必须是记录数组。');
    }
}

function encodeHumanStrategyLog(entries) {
    validateHumanStrategyEntries(entries);
    const cardDictionary = [];
    const passMemoryDictionary = [];
    const cardIndices = new Map();
    const passIndices = new Map();
    function intern(items, dictionary, indices) {
        if (!Array.isArray(items) || !items.every(isHumanStrategyObject)) {
            throw new Error('真人牌谱快照格式无效。');
        }
        return items.map(item => {
            const key = JSON.stringify(item);
            if (!indices.has(key)) {
                indices.set(key, dictionary.length);
                dictionary.push(item);
            }
            return indices.get(key);
        });
    }
    const packedEntries = entries.map(entry => {
        const packed = { ...entry };
        for (const field of HUMAN_STRATEGY_CARD_FIELDS) {
            if (Object.prototype.hasOwnProperty.call(entry, field)) {
                packed[field] = intern(entry[field], cardDictionary, cardIndices);
            }
        }
        if (Object.prototype.hasOwnProperty.call(entry, 'passMemory')) {
            packed.passMemory = intern(entry.passMemory, passMemoryDictionary, passIndices);
        }
        return packed;
    });
    return JSON.stringify({
        schema: HUMAN_STRATEGY_STORE_SCHEMA,
        cardDictionary,
        passMemoryDictionary,
        entries: packedEntries
    });
}

function decodeHumanStrategyLog(rawString) {
    const stored = JSON.parse(rawString);
    // 旧版直接保存记录数组，读取时无需迁移或丢弃历史记录。
    if (Array.isArray(stored)) {
        validateHumanStrategyEntries(stored);
        return stored;
    }
    if (!isHumanStrategyObject(stored) || stored.schema !== HUMAN_STRATEGY_STORE_SCHEMA
        || !Array.isArray(stored.cardDictionary)
        || !stored.cardDictionary.every(isHumanStrategyObject)
        || !Array.isArray(stored.passMemoryDictionary)
        || !stored.passMemoryDictionary.every(isHumanStrategyObject)) {
        throw new Error('真人牌谱存储格式无效。');
    }
    validateHumanStrategyEntries(stored.entries);
    function expand(indices, dictionary) {
        if (!Array.isArray(indices)) throw new Error('真人牌谱引用格式无效。');
        return indices.map(index => {
            if (!Number.isInteger(index) || index < 0 || index >= dictionary.length) {
                throw new Error('真人牌谱字典引用无效。');
            }
            // 每个快照保持独立，后续修改单条记录不会连带修改其他记录。
            return JSON.parse(JSON.stringify(dictionary[index]));
        });
    }
    return stored.entries.map(entry => {
        const restored = { ...entry };
        for (const field of HUMAN_STRATEGY_CARD_FIELDS) {
            if (Object.prototype.hasOwnProperty.call(entry, field)) {
                restored[field] = expand(entry[field], stored.cardDictionary);
            }
        }
        if (Object.prototype.hasOwnProperty.call(entry, 'passMemory')) {
            restored.passMemory = expand(entry.passMemory, stored.passMemoryDictionary);
        }
        return restored;
    });
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { encodeHumanStrategyLog, decodeHumanStrategyLog };
}
