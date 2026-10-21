/**
 * 真人对手画像：只学习公开行动，不读取或保存其他玩家的隐藏手牌。
 * 画像使用可解释的增量计数，避免少量牌谱直接覆盖稳定 AI。
 */
const HUMAN_OPPONENT_PROFILE_KEY = 'guandanHumanOpponentProfileV2';
const HUMAN_OPPONENT_PROFILE_SCHEMA = 'guandan-human-opponent-profile-v2';
const HUMAN_PASS_TYPES = ['单张', '对子', '三张', '三带二', '顺子', '双顺', '飞机', '炸弹', '同花顺', '四王'];
const INITIAL_HUMAN_PASS_MODEL = {
    "intercept": 0.16770249604814275,
    "weights": [
        0.1640265543969482,
        -0.3112254569008506,
        0.7436761751412124,
        -0.37510332632103177,
        0.1340052205962067,
        0.007016133251668688,
        0.06317030637190517,
        0.041156084659716596,
        0.09901546155062715,
        0,
        0.028561874762312506,
        0.16620479952554354,
        0,
        -0.5470752904726435,
        0.008179755066386747,
        -0.0008121821750083002,
        0.038806482935149246,
        0.022830230538128195,
        0.05265670442804711,
        0,
        0.03692230508271999,
        0.07726653769637001,
        0,
        0.595622958914814,
        0.09575363420388802,
        -0.0007950641182247918,
        0.009470923073717726,
        0.0017629538104030813,
        0.004489088455986349,
        0,
        0.028561874762312506,
        0.00880980603831474,
        0
    ]
};
const HUMAN_CHOICE_FEATURE_SIZE = 20;
const HUMAN_CHOICE_MODEL_VERSION = 'human-choice-pairwise-v1-seed2438';
const INITIAL_HUMAN_CHOICE_MODEL = {
    "weights": [
        -0.33924181916100876,
        0.06560079050168895,
        0.12564511820778101,
        -1.3875256024175862,
        -3.569990478611212,
        -1.302146682450081,
        -2.0258932358451256,
        -0.2066490404264005,
        0.071087759675373,
        0.11310682976954053,
        0.3782671849416216,
        0.44760106928273347,
        -0.15463613618603186,
        -0.08891616506094492,
        -0.10966484776619072,
        -0.08101221658674768,
        -0.18498984819803874,
        0.03527679047738165,
        -0.2419258309037826,
        0
    ]
};

// 旧版1094条画像作为源码历史基底；下方会覆盖为去重后的2438条新画像。
const INITIAL_HUMAN_OPPONENT_PROFILE = {
    "schema": "guandan-human-opponent-profile-v2",
    "observations": 1094,
    "plays": 589,
    "passes": 505,
    "leadByType": {
        "对子": 41,
        "顺子": 18,
        "三带二": 52,
        "单张": 60,
        "飞机": 6,
        "双顺": 8,
        "三张": 8,
        "炸弹": 14,
        "同花顺": 3
    },
    "followByType": {
        "对子": {
            "opportunities": 95,
            "pass": 60,
            "play": 35
        },
        "单张": {
            "opportunities": 556,
            "pass": 283,
            "play": 273
        },
        "三带二": {
            "opportunities": 77,
            "pass": 46,
            "play": 31
        },
        "同花顺": {
            "opportunities": 17,
            "pass": 16,
            "play": 1
        },
        "炸弹": {
            "opportunities": 96,
            "pass": 69,
            "play": 27
        },
        "三张": {
            "opportunities": 19,
            "pass": 12,
            "play": 7
        },
        "双顺": {
            "opportunities": 16,
            "pass": 13,
            "play": 3
        },
        "顺子": {
            "opportunities": 8,
            "pass": 6,
            "play": 2
        }
    },
    "followByTypeBand": {
        "对子:mid": {
            "opportunities": 37,
            "pass": 21,
            "play": 16
        },
        "对子:high": {
            "opportunities": 25,
            "pass": 18,
            "play": 7
        },
        "单张:control": {
            "opportunities": 182,
            "pass": 139,
            "play": 43
        },
        "单张:low": {
            "opportunities": 137,
            "pass": 35,
            "play": 102
        },
        "单张:high": {
            "opportunities": 107,
            "pass": 57,
            "play": 50
        },
        "三带二:high": {
            "opportunities": 22,
            "pass": 16,
            "play": 6
        },
        "单张:mid": {
            "opportunities": 130,
            "pass": 52,
            "play": 78
        },
        "三带二:mid": {
            "opportunities": 25,
            "pass": 15,
            "play": 10
        },
        "同花顺:mid": {
            "opportunities": 8,
            "pass": 8,
            "play": 0
        },
        "对子:control": {
            "opportunities": 19,
            "pass": 17,
            "play": 2
        },
        "炸弹:control": {
            "opportunities": 96,
            "pass": 69,
            "play": 27
        },
        "三张:high": {
            "opportunities": 5,
            "pass": 2,
            "play": 3
        },
        "对子:low": {
            "opportunities": 14,
            "pass": 4,
            "play": 10
        },
        "三张:mid": {
            "opportunities": 6,
            "pass": 4,
            "play": 2
        },
        "三带二:low": {
            "opportunities": 24,
            "pass": 11,
            "play": 13
        },
        "同花顺:low": {
            "opportunities": 5,
            "pass": 4,
            "play": 1
        },
        "双顺:low": {
            "opportunities": 6,
            "pass": 5,
            "play": 1
        },
        "顺子:low": {
            "opportunities": 2,
            "pass": 2,
            "play": 0
        },
        "顺子:mid": {
            "opportunities": 4,
            "pass": 2,
            "play": 2
        },
        "同花顺:high": {
            "opportunities": 4,
            "pass": 4,
            "play": 0
        },
        "三带二:control": {
            "opportunities": 6,
            "pass": 4,
            "play": 2
        },
        "三张:low": {
            "opportunities": 8,
            "pass": 6,
            "play": 2
        },
        "双顺:mid": {
            "opportunities": 6,
            "pass": 4,
            "play": 2
        },
        "双顺:high": {
            "opportunities": 4,
            "pass": 4,
            "play": 0
        },
        "顺子:high": {
            "opportunities": 2,
            "pass": 2,
            "play": 0
        }
    },
    "wildHeld": 435,
    "wildUsed": 28,
    "followObservations": 884,
    "passModel": {
        "intercept": 0.16770249604814275,
        "weights": [
            0.1640265543969482,
            -0.3112254569008506,
            0.7436761751412124,
            -0.37510332632103177,
            0.1340052205962067,
            0.007016133251668688,
            0.06317030637190517,
            0.041156084659716596,
            0.09901546155062715,
            0,
            0.028561874762312506,
            0.16620479952554354,
            0,
            -0.5470752904726435,
            0.008179755066386747,
            -0.0008121821750083002,
            0.038806482935149246,
            0.022830230538128195,
            0.05265670442804711,
            0,
            0.03692230508271999,
            0.07726653769637001,
            0,
            0.595622958914814,
            0.09575363420388802,
            -0.0007950641182247918,
            0.009470923073717726,
            0.0017629538104030813,
            0.004489088455986349,
            0,
            0.028561874762312506,
            0.00880980603831474,
            0
        ]
    },
    "choiceObservations": 508,
    "choiceComparisons": 2867,
    "choiceModel": {
        "weights": [
            -0.33924181916100876,
            0.06560079050168895,
            0.12564511820778101,
            -1.3875256024175862,
            -3.569990478611212,
            -1.302146682450081,
            -2.0258932358451256,
            -0.2066490404264005,
            0.071087759675373,
            0.11310682976954053,
            0.3782671849416216,
            0.44760106928273347,
            -0.15463613618603186,
            -0.08891616506094492,
            -0.10966484776619072,
            -0.08101221658674768,
            -0.18498984819803874,
            0.03527679047738165,
            -0.2419258309037826,
            0
        ]
    },
    "choiceModelVersion": "human-choice-pairwise-v1-seed1094",
    "choiceValidation": {
        "decisions": 508,
        "modelCorrect": 248,
        "baselineCorrect": 261
    },
    "experiments": {
        "adaptive": {
            "games": 0,
            "wins": 0
        },
        "baseline": {
            "games": 0,
            "wins": 0
        }
    },
    "trainedThrough": "2026-09-20T13:51:49.584Z",
    "choiceTrainedThrough": "2026-09-20T13:51:49.584Z"
};

// Merge the overlapping exports before seeding; never count duplicate decisions twice.
// The choice reranker remains gated by its pre-update validation (483/1096 vs 551/1096).
const HUMAN_OPPONENT_SEED_20260926 = 
{
    "schema": "guandan-human-opponent-profile-v2",
    "observations": 2438,
    "plays": 1310,
    "passes": 1128,
    "leadByType": {
        "对子": 90,
        "顺子": 41,
        "三带二": 105,
        "单张": 127,
        "飞机": 13,
        "双顺": 22,
        "三张": 21,
        "炸弹": 25,
        "同花顺": 6,
        "火箭": 1
    },
    "followByType": {
        "对子": {
            "opportunities": 197,
            "pass": 119,
            "play": 78
        },
        "单张": {
            "opportunities": 1270,
            "pass": 640,
            "play": 630
        },
        "三带二": {
            "opportunities": 168,
            "pass": 101,
            "play": 67
        },
        "同花顺": {
            "opportunities": 47,
            "pass": 44,
            "play": 3
        },
        "炸弹": {
            "opportunities": 210,
            "pass": 158,
            "play": 52
        },
        "三张": {
            "opportunities": 35,
            "pass": 22,
            "play": 13
        },
        "双顺": {
            "opportunities": 35,
            "pass": 26,
            "play": 9
        },
        "顺子": {
            "opportunities": 19,
            "pass": 14,
            "play": 5
        },
        "飞机": {
            "opportunities": 5,
            "pass": 3,
            "play": 2
        },
        "火箭": {
            "opportunities": 1,
            "pass": 1,
            "play": 0
        }
    },
    "followByTypeBand": {
        "对子:mid": {
            "opportunities": 69,
            "pass": 38,
            "play": 31
        },
        "对子:high": {
            "opportunities": 52,
            "pass": 39,
            "play": 13
        },
        "单张:control": {
            "opportunities": 418,
            "pass": 311,
            "play": 107
        },
        "单张:low": {
            "opportunities": 294,
            "pass": 57,
            "play": 237
        },
        "单张:high": {
            "opportunities": 252,
            "pass": 154,
            "play": 98
        },
        "三带二:high": {
            "opportunities": 38,
            "pass": 29,
            "play": 9
        },
        "单张:mid": {
            "opportunities": 306,
            "pass": 118,
            "play": 188
        },
        "三带二:mid": {
            "opportunities": 57,
            "pass": 30,
            "play": 27
        },
        "同花顺:mid": {
            "opportunities": 23,
            "pass": 22,
            "play": 1
        },
        "对子:control": {
            "opportunities": 37,
            "pass": 31,
            "play": 6
        },
        "炸弹:control": {
            "opportunities": 210,
            "pass": 158,
            "play": 52
        },
        "三张:high": {
            "opportunities": 7,
            "pass": 3,
            "play": 4
        },
        "对子:low": {
            "opportunities": 39,
            "pass": 11,
            "play": 28
        },
        "三张:mid": {
            "opportunities": 10,
            "pass": 7,
            "play": 3
        },
        "三带二:low": {
            "opportunities": 61,
            "pass": 33,
            "play": 28
        },
        "同花顺:low": {
            "opportunities": 17,
            "pass": 15,
            "play": 2
        },
        "双顺:low": {
            "opportunities": 15,
            "pass": 12,
            "play": 3
        },
        "顺子:low": {
            "opportunities": 4,
            "pass": 3,
            "play": 1
        },
        "顺子:mid": {
            "opportunities": 10,
            "pass": 8,
            "play": 2
        },
        "同花顺:high": {
            "opportunities": 7,
            "pass": 7,
            "play": 0
        },
        "三带二:control": {
            "opportunities": 12,
            "pass": 9,
            "play": 3
        },
        "三张:low": {
            "opportunities": 16,
            "pass": 10,
            "play": 6
        },
        "双顺:mid": {
            "opportunities": 7,
            "pass": 4,
            "play": 3
        },
        "双顺:high": {
            "opportunities": 13,
            "pass": 10,
            "play": 3
        },
        "顺子:high": {
            "opportunities": 5,
            "pass": 3,
            "play": 2
        },
        "飞机:low": {
            "opportunities": 1,
            "pass": 1,
            "play": 0
        },
        "火箭:control": {
            "opportunities": 1,
            "pass": 1,
            "play": 0
        },
        "飞机:high": {
            "opportunities": 1,
            "pass": 1,
            "play": 0
        },
        "飞机:mid": {
            "opportunities": 3,
            "pass": 1,
            "play": 2
        },
        "三张:control": {
            "opportunities": 2,
            "pass": 2,
            "play": 0
        }
    },
    "wildHeld": 939,
    "wildUsed": 60,
    "followObservations": 1987,
    "passModel": {
        "intercept": 0.2673825660542409,
        "weights": [
            0.2601876814518211,
            -0.5226131177870167,
            0.8581784607751132,
            -0.37989115631225806,
            0.06294142404120553,
            0.0071150052008060495,
            0.05882789421403063,
            0.06510274580691895,
            0.11647608314759436,
            0.00452008288114995,
            0.03874618891875559,
            0.2825096661523506,
            0,
            -0.7766268959454907,
            -0.057350089074009736,
            -0.005308601639087738,
            0.029586010040521627,
            0.04243525082959367,
            0.0661148945581152,
            0.0011246902226752355,
            0.03275635047456053,
            0.1445130598793913,
            0,
            0.6671877507824073,
            0.10636484376908258,
            0.0031091510804408568,
            0.016388323826289564,
            0.0028775476956403845,
            0.0049145587618125005,
            0.00025665345555722066,
            0.03874618891875559,
            0.014493695083857044,
            0
        ]
    },
    "choiceObservations": 1096,
    "choiceComparisons": 6283,
    "choiceModel": {
        "weights": [
            -0.23066816096360748,
            -0.14004094679991538,
            0.08543265220874373,
            -1.9017355600559942,
            -4.255309281436243,
            -1.555256808041643,
            -2.56644749609386,
            -0.21095140496822765,
            0.36689932517883556,
            0.0003435838582006783,
            0.2455772783609546,
            0.24045063458964858,
            -0.1701262274627929,
            -0.12855862540094817,
            0.05429376063616218,
            0.04691840660458426,
            -0.10866534609031643,
            -0.06688525650008072,
            -0.1440661484681466,
            0
        ]
    },
    "choiceModelVersion": "human-choice-pairwise-v1-seed2438",
    "choiceValidation": {
        "decisions": 1096,
        "modelCorrect": 483,
        "baselineCorrect": 551
    },
    "experiments": {
        "adaptive": {
            "games": 0,
            "wins": 0
        },
        "baseline": {
            "games": 0,
            "wins": 0
        }
    },
    "trainedThrough": "2026-09-26T06:33:21.255Z",
    "choiceTrainedThrough": "2026-09-26T06:33:21.255Z"
}
;
Object.assign(INITIAL_HUMAN_OPPONENT_PROFILE, HUMAN_OPPONENT_SEED_20260926);
Object.assign(INITIAL_HUMAN_CHOICE_MODEL, HUMAN_OPPONENT_SEED_20260926.choiceModel);

function cloneHumanOpponentProfile(profile = INITIAL_HUMAN_OPPONENT_PROFILE) {
    return JSON.parse(JSON.stringify(profile));
}

function emptyHumanOpponentProfile() {
    return {
        schema: HUMAN_OPPONENT_PROFILE_SCHEMA,
        observations: 0, plays: 0, passes: 0,
        leadByType: {}, followByType: {}, followByTypeBand: {}, wildHeld: 0, wildUsed: 0,
        followObservations: 0,
        passModel: { intercept: 0, weights: Array(33).fill(0) },
        choiceObservations: 0,
        choiceComparisons: 0,
        choiceModel: { weights: Array(HUMAN_CHOICE_FEATURE_SIZE).fill(0) },
        choiceModelVersion: 'human-choice-pairwise-v1-online',
        choiceValidation: { decisions: 0, modelCorrect: 0, baselineCorrect: 0 },
        experiments: { adaptive: { games: 0, wins: 0 }, baseline: { games: 0, wins: 0 } }
    };
}

function restoreProfileCards(rawCards) {
    if (!Array.isArray(rawCards)) return [];
    return rawCards.map(card => ({
        ...card,
        value: card.isJoker
            ? (card.rank === JOKER_BIG ? 101 : 100)
            : RANK_VALUE[card.rank]
    }));
}

function observeHumanStrategy(profile, entry) {
    const next = profile && profile.schema === HUMAN_OPPONENT_PROFILE_SCHEMA
        ? cloneHumanOpponentProfile(profile) : emptyHumanOpponentProfile();
    if (!next.followByTypeBand) next.followByTypeBand = {};
    if (!entry || !['play', 'pass'].includes(entry.action)) return next;
    if (entry.recordedAt) next.trainedThrough = entry.recordedAt;
    next.observations++;
    if (entry.action === 'pass') next.passes++;
    else next.plays++;

    const hand = restoreProfileCards(entry.hand);
    const cards = restoreProfileCards(entry.cards);
    const isWild = card => !card.isJoker && card.suit === '♥' && card.rank === entry.levelCard;
    next.wildHeld += hand.filter(isWild).length;
    next.wildUsed += cards.filter(isWild).length;

    if (entry.phase === 'lead' && entry.action === 'play') {
        const type = identifyHand(cards, entry.levelCard);
        if (type.valid) next.leadByType[type.type] = (next.leadByType[type.type] || 0) + 1;
    } else if (entry.phase === 'follow' && entry.lastPlayType && entry.lastPlayType.type) {
        const type = entry.lastPlayType.type;
        const bucket = next.followByType[type] || { opportunities: 0, pass: 0, play: 0 };
        bucket.opportunities++;
        bucket[entry.action]++;
        next.followByType[type] = bucket;
        const bandKey = `${type}:${humanPlayValueBand(entry.lastPlayType.value)}`;
        const band = next.followByTypeBand[bandKey] || { opportunities: 0, pass: 0, play: 0 };
        band.opportunities++;
        band[entry.action]++;
        next.followByTypeBand[bandKey] = band;
        updateHumanPassModel(next, type, entry.lastPlayType.value,
            Array.isArray(entry.cardCounts) ? entry.cardCounts[0] : hand.length,
            entry.action === 'pass' ? 1 : 0);
    }
    trainHumanChoiceModel(next, entry);
    return next;
}

function buildHumanOpponentProfile(entries) {
    return (Array.isArray(entries) ? entries : []).reduce(
        (profile, entry) => observeHumanStrategy(profile, entry),
        emptyHumanOpponentProfile()
    );
}

function loadHumanOpponentProfile(entries = []) {
    try {
        if (typeof localStorage !== 'undefined') {
            let stored = JSON.parse(localStorage.getItem(HUMAN_OPPONENT_PROFILE_KEY) || 'null');
            if (stored && stored.schema === HUMAN_OPPONENT_PROFILE_SCHEMA) {
                const embeddedIsNewer = (!stored.trainedThrough
                    || stored.trainedThrough <= INITIAL_HUMAN_OPPONENT_PROFILE.trainedThrough)
                    && ((stored.observations || 0) <= INITIAL_HUMAN_OPPONENT_PROFILE.observations)
                    && (stored.choiceModelVersion !== HUMAN_CHOICE_MODEL_VERSION
                        || (stored.observations || 0) < INITIAL_HUMAN_OPPONENT_PROFILE.observations);
                if (embeddedIsNewer) {
                    const upgraded = cloneHumanOpponentProfile();
                    // A/B 实战结果不属于牌谱训练数据，升级画像时继续保留。
                    if (stored.experiments) upgraded.experiments = stored.experiments;
                    stored = upgraded;
                }
                const lackedChoiceValidation = !stored.choiceValidation;
                ensureHumanChoiceModel(stored, true);
                let changed = embeddedIsNewer || lackedChoiceValidation;
                const ordered = entries.filter(entry => entry && entry.recordedAt)
                    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
                for (const entry of ordered) {
                    if (!stored.trainedThrough || entry.recordedAt > stored.trainedThrough) {
                        stored = observeHumanStrategy(stored, entry);
                        changed = true;
                    } else if (!stored.choiceTrainedThrough
                        || entry.recordedAt > stored.choiceTrainedThrough) {
                        trainHumanChoiceModel(stored, entry);
                        changed = true;
                    }
                }
                if (changed) {
                    saveHumanOpponentProfile(stored);
                }
                return stored;
            }
        }
    } catch (_error) {
        // 包括浏览器直接禁止访问 localStorage 属性的情况。
    }
    const seeded = cloneHumanOpponentProfile();
    const newerEntries = entries.filter(entry => (
        entry && entry.recordedAt && entry.recordedAt > seeded.trainedThrough
    )).sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
    return newerEntries.reduce(
        (profile, entry) => entry.recordedAt > profile.trainedThrough
            ? observeHumanStrategy(profile, entry) : profile, seeded
    );
}

function ensureHumanChoiceModel(profile, seedExistingProfile = false) {
    if (!profile.choiceModel || !Array.isArray(profile.choiceModel.weights)
        || profile.choiceModel.weights.length !== HUMAN_CHOICE_FEATURE_SIZE
        || !profile.choiceModelVersion) {
        if (seedExistingProfile
            && (profile.observations || 0) >= INITIAL_HUMAN_OPPONENT_PROFILE.observations) {
            profile.choiceModel = cloneHumanOpponentProfile(INITIAL_HUMAN_CHOICE_MODEL);
            profile.choiceObservations = INITIAL_HUMAN_OPPONENT_PROFILE.choiceObservations;
            profile.choiceComparisons = INITIAL_HUMAN_OPPONENT_PROFILE.choiceComparisons;
            profile.choiceModelVersion = HUMAN_CHOICE_MODEL_VERSION;
            profile.choiceTrainedThrough = INITIAL_HUMAN_OPPONENT_PROFILE.choiceTrainedThrough;
            profile.choiceValidation = cloneHumanOpponentProfile(
                INITIAL_HUMAN_OPPONENT_PROFILE.choiceValidation
            );
        } else {
            profile.choiceModel = { weights: Array(HUMAN_CHOICE_FEATURE_SIZE).fill(0) };
            profile.choiceObservations = 0;
            profile.choiceComparisons = 0;
            profile.choiceModelVersion = 'human-choice-pairwise-v1-online';
            profile.choiceValidation = { decisions: 0, modelCorrect: 0, baselineCorrect: 0 };
        }
    }
    if (!profile.choiceValidation) {
        profile.choiceValidation = profile.choiceModelVersion === HUMAN_CHOICE_MODEL_VERSION
            && (profile.choiceObservations || 0)
                >= INITIAL_HUMAN_OPPONENT_PROFILE.choiceObservations
            ? cloneHumanOpponentProfile(INITIAL_HUMAN_OPPONENT_PROFILE.choiceValidation)
            : { decisions: 0, modelCorrect: 0, baselineCorrect: 0 };
    }
}

/**
 * 将一次出牌压缩成可在线学习的结构特征。只使用出牌者自己的手牌结构，
 * 保存到长期画像的只有权重，不保留具体牌面。
 */
function humanChoiceFeatures(hand, play, levelCard, phase) {
    if (typeof createTurnEstimator !== 'function'
        || typeof calculateStructureDamage !== 'function'
        || typeof calculateLowSingletonLiability !== 'function') return null;
    const type = identifyHand(play, levelCard);
    if (!type.valid) return null;
    const remaining = typeof removePlayedCards === 'function'
        ? removePlayedCards(hand, play)
        : hand.filter(card => !new Set(play.map(item => item.id)).has(card.id));
    const planner = createTurnEstimator(levelCard);
    const power = type.type === '炸弹' || type.type === '同花顺' || type.type === '四王';
    const wildUsed = play.filter(card => !card.isJoker
        && card.suit === '♥' && card.rank === levelCard).length;
    const normalizedLength = Math.min(play.length, 10) / 10;
    const normalizedValue = Math.min(Number(type.value) || 0, 201) / 201;
    return [
        normalizedLength,
        normalizedValue,
        Math.min(remaining.length, 27) / 27,
        Math.min(planner(remaining), 12) / 12,
        Math.min(calculateStructureDamage(hand, play, levelCard), 200) / 200,
        Math.min(calculateLowSingletonLiability(remaining, levelCard), 180) / 180,
        Math.min(wildUsed, 2) / 2,
        power ? 1 : 0,
        phase === 'lead' ? normalizedLength : 0,
        phase === 'lead' ? normalizedValue : 0,
        ...HUMAN_PASS_TYPES.map(candidate => candidate === type.type ? 1 : 0)
    ];
}

function humanChoiceCandidates(entry, hand, chosen) {
    if (typeof findLeadCandidates !== 'function' || typeof dedupeCardPlays !== 'function') {
        return [chosen];
    }
    let candidates = [];
    if (entry.phase === 'lead') {
        candidates = findLeadCandidates(hand, entry.levelCard);
    } else if (entry.lastPlayType && typeof findAllBeatingPlays === 'function') {
        candidates = findAllBeatingPlays(hand, entry.lastPlayType, entry.levelCard);
        if (typeof findWildcardPatternPlays === 'function') {
            candidates.push(...findWildcardPatternPlays(hand, entry.levelCard, entry.lastPlayType));
        }
    }
    return dedupeCardPlays([...candidates, chosen]).filter(play => {
        const type = identifyHand(play, entry.levelCard);
        return type.valid && (entry.phase !== 'follow' || !entry.lastPlayType
            || canBeat(type, entry.lastPlayType));
    });
}

/**
 * 在线成对排序：真人实际选择为正样本，同局面的其他合法候选为负样本。
 * 一次行动最多更新8组，避免候选很多时某一手牌过度影响长期画像。
 */
function trainHumanChoiceModel(profile, entry) {
    ensureHumanChoiceModel(profile);
    if (entry && entry.recordedAt) profile.choiceTrainedThrough = entry.recordedAt;
    if (!entry || entry.action !== 'play') return;
    const hand = restoreProfileCards(entry.hand);
    const chosen = restoreProfileCards(entry.cards);
    const chosenFeatures = humanChoiceFeatures(hand, chosen, entry.levelCard, entry.phase);
    if (!chosenFeatures) return;
    const chosenIds = [...chosen].map(card => card.id).sort().join('|');
    const candidateItems = humanChoiceCandidates(entry, hand, chosen)
        .map(play => ({
            play,
            features: humanChoiceFeatures(hand, play, entry.levelCard, entry.phase)
        }))
        .filter(item => item.features);
    const alternatives = candidateItems
        .filter(item => item.play.map(card => card.id).sort().join('|') !== chosenIds)
        .filter(item => item.features.some((value, index) => (
            Math.abs(value - chosenFeatures[index]) > 1e-9
        )))
        .slice(0, 8);
    if (alternatives.length === 0) return;

    const weights = profile.choiceModel.weights;
    const modelScore = features => features.reduce(
        (sum, value, index) => sum + value * weights[index], 0
    );
    const structureKey = play => {
        const type = identifyHand(play, entry.levelCard);
        return `${type.type}:${type.value}:${type.length}`;
    };
    const modelPick = [...candidateItems].sort((a, b) => (
        modelScore(b.features) - modelScore(a.features)
    ))[0].play;
    const planner = createTurnEstimator(entry.levelCard);
    const baselinePick = [...candidateItems].sort((a, b) => (
        scoreStrategicPlay(hand, a.play, entry.levelCard, planner, null)
        - scoreStrategicPlay(hand, b.play, entry.levelCard, planner, null)
    ))[0].play;
    profile.choiceValidation.decisions++;
    if (structureKey(modelPick) === structureKey(chosen)) profile.choiceValidation.modelCorrect++;
    if (structureKey(baselinePick) === structureKey(chosen)) profile.choiceValidation.baselineCorrect++;

    const rate = 0.12 / Math.sqrt(1 + (profile.choiceComparisons || 0) / 80);
    for (const { features: alternative } of alternatives) {
        const difference = chosenFeatures.map((value, index) => value - alternative[index]);
        const logit = difference.reduce((sum, value, index) => sum + value * weights[index], 0);
        const probability = 1 / (1 + Math.exp(-Math.max(-12, Math.min(12, logit))));
        for (let index = 0; index < weights.length; index++) {
            weights[index] += rate * ((1 - probability) * difference[index]
                - 0.0005 * weights[index]);
        }
        profile.choiceComparisons = (profile.choiceComparisons || 0) + 1;
    }
    profile.choiceObservations = (profile.choiceObservations || 0) + 1;
}

/**
 * 只用“更新前预测”的滚动验证开启选牌影响，避免模型边学边测造成虚假提升。
 * 至少40次验证且明显优于稳定规则才启用，并把最大影响限制在0.15。
 */
function chooseHumanChoiceScale(profile) {
    const validation = profile && profile.choiceValidation;
    if (!validation || validation.decisions < 40) return 0;
    const modelRate = validation.modelCorrect / validation.decisions;
    const baselineRate = validation.baselineCorrect / validation.decisions;
    if (modelRate >= baselineRate + 0.12) return 0.15;
    if (modelRate >= baselineRate + 0.05) return 0.08;
    return 0;
}

/** 返回[-1, 1]的真人选牌偏好及其样本置信度。 */
function estimateHumanChoiceSignal(profile, hand, play, levelCard, phase) {
    const features = humanChoiceFeatures(hand, play, levelCard, phase);
    const weights = profile && profile.choiceModel && profile.choiceModel.weights;
    if (!features || !Array.isArray(weights) || weights.length !== features.length) {
        return { preference: 0, confidence: 0, samples: 0 };
    }
    const raw = features.reduce((sum, value, index) => sum + value * weights[index], 0);
    const samples = profile.choiceObservations || 0;
    return {
        preference: Math.tanh(raw / 2),
        confidence: Math.min(1, samples / 60),
        samples
    };
}

function saveHumanOpponentProfile(profile) {
    try {
        if (typeof localStorage === 'undefined') return;
        localStorage.setItem(HUMAN_OPPONENT_PROFILE_KEY, JSON.stringify(profile));
    } catch (_error) {
        // 存储不可用时，本局内存画像仍可继续学习。
    }
}

function humanPlayValueBand(value) {
    const numeric = Number(value) || 0;
    if (numeric >= 100) return 'control';
    if (numeric >= 13) return 'high';
    if (numeric >= 9) return 'mid';
    return 'low';
}

function humanPassFeatures(handType, value, handCount) {
    const normalizedCount = Math.max(0, Math.min(27, Number(handCount) || 0)) / 27;
    const normalizedValue = Math.max(0, Math.min(201, Number(value) || 0)) / 201;
    const oneHot = HUMAN_PASS_TYPES.map(type => type === handType ? 1 : 0);
    return [1, normalizedCount, normalizedValue, ...oneHot,
        ...oneHot.map(flag => flag * normalizedCount),
        ...oneHot.map(flag => flag * normalizedValue)];
}

function predictHumanPassProbability(profile, handType, value, handCount) {
    const model = profile && profile.passModel;
    const features = humanPassFeatures(handType, value, handCount);
    if (!model || !Array.isArray(model.weights) || model.weights.length !== features.length) return 0.5;
    let logit = Number(model.intercept) || 0;
    for (let index = 0; index < features.length; index++) logit += model.weights[index] * features[index];
    return 1 / (1 + Math.exp(-Math.max(-12, Math.min(12, logit))));
}

/** 单步在线逻辑回归：每次真人跟牌或过牌后立即更新，无需离线重训。 */
function updateHumanPassModel(profile, handType, value, handCount, target) {
    const features = humanPassFeatures(handType, value, handCount);
    const prediction = predictHumanPassProbability(profile, handType, value, handCount);
    const learningRate = 0.08 / Math.sqrt(1 + (profile.followObservations || 0) / 40);
    const error = target - prediction;
    profile.passModel.intercept += learningRate * error;
    for (let index = 0; index < features.length; index++) {
        profile.passModel.weights[index] += learningRate
            * (error * features[index] - 0.001 * profile.passModel.weights[index]);
    }
    profile.followObservations = (profile.followObservations || 0) + 1;
}

/** 返回牌型+强度对应的平滑过牌概率；样本越少，对 AI 的影响越弱。 */
function estimateHumanPassSignal(profile, handType, value = 0, handCount = 27) {
    const bandKey = `${handType}:${humanPlayValueBand(value)}`;
    const bandBucket = profile && profile.followByTypeBand && profile.followByTypeBand[bandKey];
    const typeBucket = profile && profile.followByType && profile.followByType[handType];
    const bucket = bandBucket && bandBucket.opportunities >= 4 ? bandBucket : typeBucket;
    const samples = bucket ? bucket.opportunities : 0;
    const passes = bucket ? bucket.pass : 0;
    const modelReady = profile && profile.passModel && (profile.followObservations || 0) >= 20;
    return {
        samples,
        passRate: modelReady
            ? predictHumanPassProbability(profile, handType, value, handCount)
            : (passes + 2) / (samples + 4),
        confidence: Math.min(1, (profile && profile.followObservations || samples) / 60)
    };
}

/** 在真人实战中比较画像策略和稳定策略，并持续保留少量探索。 */
function chooseHumanAdaptationWeight(profile) {
    const experiments = profile && profile.experiments;
    if (!experiments) return 400;
    const adaptive = experiments.adaptive || { games: 0, wins: 0 };
    const baseline = experiments.baseline || { games: 0, wins: 0 };
    const total = adaptive.games + baseline.games;
    if (Math.min(adaptive.games, baseline.games) < 4) return total % 2 === 0 ? 400 : 0;
    const adaptiveRate = (adaptive.wins + 1) / (adaptive.games + 2);
    const baselineRate = (baseline.wins + 1) / (baseline.games + 2);
    const preferAdaptive = adaptiveRate >= baselineRate;
    if (total % 5 === 4) return preferAdaptive ? 0 : 400;
    return preferAdaptive ? 400 : 0;
}

function observeHumanMatchResult(profile, result, adaptationWeight) {
    const next = cloneHumanOpponentProfile(profile);
    if (!next.experiments) {
        next.experiments = { adaptive: { games: 0, wins: 0 }, baseline: { games: 0, wins: 0 } };
    }
    const arm = adaptationWeight > 0 ? 'adaptive' : 'baseline';
    next.experiments[arm].games++;
    if (result && result.winnerTeam === 'b') next.experiments[arm].wins++;
    return next;
}
