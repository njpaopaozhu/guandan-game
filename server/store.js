'use strict';
const fs = require('node:fs');
const path = require('node:path');

class Store {
    constructor(directory) {
        this.directory = path.resolve(directory); fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
        this.file = path.join(this.directory, 'online-state.json');
        this.backup = path.join(this.directory, 'online-state.previous.json');
        this.data = { schema: 'guandan-online-state-v1', sessions: [], rooms: [], bans: [], metrics: {}, events: [] };
        this.primaryValid = true;
        if (fs.existsSync(this.file)) {
            try { this.data = this.read(this.file); }
            catch (error) {
                // Never silently reset player state after a corrupt primary file.
                if (!fs.existsSync(this.backup)) throw error;
                this.data = this.read(this.backup);
                this.primaryValid = false;
                fs.copyFileSync(this.file, path.join(this.directory, 'corrupt-' + Date.now() + '.json'));
                console.warn('已保留损坏快照，并从上一份完整快照恢复');
            }
        }
    }
    read(file) {
        const value = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (value.schema !== 'guandan-online-state-v1' || !Array.isArray(value.sessions) || !Array.isArray(value.rooms)
            || !Array.isArray(value.events) || !Array.isArray(value.bans) || !value.metrics) throw Error('联机存档格式无效');
        return value;
    }
    save() {
        const temporary = path.join(this.directory, 'online-state.next.json');
        const descriptor = fs.openSync(temporary, 'w', 0o600);
        try { fs.writeFileSync(descriptor, JSON.stringify(this.data)); fs.fsyncSync(descriptor); }
        finally { fs.closeSync(descriptor); }
        if (this.primaryValid && fs.existsSync(this.file)) fs.copyFileSync(this.file, this.backup);
        fs.renameSync(temporary, this.file);
        this.primaryValid = true;
    }
}
module.exports = { Store };
