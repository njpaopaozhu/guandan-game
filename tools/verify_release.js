#!/usr/bin/env node
/** 校验发布清单、必需文件并在发布包内运行核心回归测试。 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const releaseDir = path.resolve(process.argv[2] || path.join(root, 'dist', 'guandan-3.2.0'));
const manifestPath = path.join(releaseDir, 'manifest.json');
function fail(message) { console.error(`发布核验失败：${message}`); process.exit(1); }
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

if (!fs.statSync(manifestPath, { throwIfNoEntry: false })?.isFile()) fail(`找不到清单 ${manifestPath}`);
let manifest;
try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (error) { fail(`清单JSON无效：${error.message}`); }
if (manifest.schema !== 'guandan-release-manifest-v1' || !manifest.files || typeof manifest.files !== 'object') {
    fail('清单结构不受支持');
}
for (const [relative, expected] of Object.entries(manifest.files)) {
    const full = path.resolve(releaseDir, relative);
    if (!full.startsWith(`${releaseDir}${path.sep}`)) fail(`清单含越界路径 ${relative}`);
    if (!fs.statSync(full, { throwIfNoEntry: false })?.isFile()) fail(`缺少文件 ${relative}`);
    const actual = sha256(full);
    if (actual !== expected) fail(`哈希不匹配 ${relative}`);
}
for (const required of ['index.html', 'README.md', 'test_node.js', 'js/v5-rollout-worker.js']) {
    if (!Object.hasOwn(manifest.files, required)) fail(`清单未覆盖必需文件 ${required}`);
}
for (const testFile of ['test_node.js', 'tools/test_release_worker_deadline.js']) {
    const test = spawnSync(process.execPath, [testFile], { cwd: releaseDir, encoding: 'utf8' });
    process.stdout.write(test.stdout || '');
    process.stderr.write(test.stderr || '');
    if (test.status !== 0) fail(`发布包测试 ${testFile} 退出码 ${test.status}`);
}
console.log(`发布核验通过：${Object.keys(manifest.files).length} 个文件，核心规则与Worker截止测试通过`);
