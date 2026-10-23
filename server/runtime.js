'use strict';
// Reuse the shipped rules without changing offline or sealed experiment sources.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');

function createRuntime(withAI = false) {
    const context = vm.createContext({ console, window: {}, document: { getElementById: () => null },
        secureIndex: max => crypto.randomInt(max) });
    const files = ['cards', 'engine'];
    if (withAI) files.push('ai-policy-weights', 'ai-policy', 'ai', 'v5-decision-transport');
    for (const name of files) vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', name + '.js'), 'utf8'), context);
    const api = vm.runInContext(`(() => {
        // Uniform cryptographic shuffle for actual online deals, not training seeds.
        shuffle = array => {
            for (let i = array.length - 1; i > 0; i--) {
                const j = secureIndex(i + 1); [array[i], array[j]] = [array[j], array[i]];
            }
            return array;
        };
        class OnlineEngine extends GameEngine {
            applyPendingTributes() {
                this.lastTributeResisted = false; this.pendingPlayerReturns = [];
                if (!this.pendingTributes.length) return [];
                const payers = [...new Set(this.pendingTributes.map(row => row.from))];
                if (payers.reduce((n, seat) => n + this.hands[seat].filter(c => c.isJoker && c.rank === JOKER_BIG).length, 0) >= 2) {
                    this.lastTributeResisted = true; this.tributeOpeningPlayer = this.pendingTributes[0].to;
                    this.pendingTributes = []; return [];
                }
                // Unlike the single-player UI, every occupied seat may choose its return.
                for (const relation of this.pendingTributes) {
                    const tributeCard = this.selectTributeCard(relation.from);
                    if (!tributeCard) throw Error('missing tribute card');
                    this.pendingPlayerReturns.push({ ...relation, tributeCard });
                }
                this.pendingTributes = []; return [];
            }
        }
        return {
            create: () => { const e = new OnlineEngine(); e.aiStrategyMode = 'v3'; e.aiPolicyMode = 'learned'; return e; },
            restore: state => Object.assign(new OnlineEngine(), JSON.parse(JSON.stringify(state))),
            validate: (e, player, ids) => {
                if (!Array.isArray(ids) || ids.length > 27 || new Set(ids).size !== ids.length) return null;
                const cards = ids.map(id => e.hands[player].find(card => card.id === id));
                return cards.every(Boolean) ? cards : null;
            },
            fallback: (e, p) => {
                if (e.lastPlay && e.lastPlayer !== p) return [];
                return [...e.hands[p]].sort((a,b) => getCardSingleValue(a,e.levelCard)-getCardSingleValue(b,e.levelCard)).slice(0,1).map(c=>c.id);
            },
            legal: (e,p,ids) => {
                if (!Array.isArray(ids) || ids.length > 27 || new Set(ids).size !== ids.length) return false;
                if (!ids.length) return Boolean(e.lastPlay && e.lastPlayer !== p);
                const cards=ids.map(id=>e.hands[p].find(c=>c.id===id));if(!cards.every(Boolean))return false;
                const type=identifyHand(cards,e.levelCard);return type.valid&&(!e.lastPlay||e.lastPlayer===p||canBeat(type,e.lastPlayType));
            },
            decidePacket: ${withAI ? '(packet) => { const e = decodePublicDecision(packet); const cards = aiDecidePlay(packet.player, e); return cards ? cards.map(c=>c.id) : []; }' : 'null'},
            packet: ${withAI ? '(e,p) => encodePublicDecision(e,p)' : 'null'}
        };
    })()`, context);
    return api;
}
module.exports = { createRuntime, ROOT };
