#!/usr/bin/env node
/**
 * 构建最小、可验证的本地发布包。
 * 只复制浏览器运行时、核心自检和发布说明；绝不复制训练数据或实验产物。
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const distRoot = path.join(root, 'dist');
const outputFlag = process.argv.indexOf('--output');
const output = outputFlag >= 0
    ? path.resolve(root, process.argv[outputFlag + 1] || '')
    : path.join(distRoot, 'guandan-3.2.0');
const verifyAfterBuild = process.argv.includes('--verify');
const files = [
    'index.html',
    'package.json',
    'RELEASE_README.md',
    'test_node.js',
    'css/style.css',
    'js/cards.js',
    'js/engine.js',
    'js/ai-policy-weights.js',
    'js/ai-policy.js',
    'js/human-profile.js',
    'js/ai.js',
    'js/pro-ai-bridge.js',
    'js/strategy-storage.js',
    'js/v5-decision-transport.js',
    'js/v5-worker-client.js',
    'js/v5-rollout-worker.js',
    'js/game.js'
];

function fail(message) {
    console.error(`发布构建失败：${message}`);
    process.exit(1);
}
function sha256(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function copy(relative) {
    const source = path.join(root, relative);
    const target = path.join(output, relative);
    if (!fs.statSync(source, { throwIfNoEntry: false })?.isFile()) fail(`缺少必需文件 ${relative}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
}

if (!output.startsWith(`${distRoot}${path.sep}`)) {
    fail('输出目录必须位于 dist/ 内，拒绝覆盖项目其他位置');
}
if (outputFlag >= 0 && !process.argv[outputFlag + 1]) fail('--output 缺少目录参数');
fs.rmSync(output, { recursive: true, force: true });
for (const relative of files) copy(relative);
fs.renameSync(path.join(output, 'RELEASE_README.md'), path.join(output, 'README.md'));

const manifestFiles = files
    .map(relative => relative === 'RELEASE_README.md' ? 'README.md' : relative)
    .sort();
const manifest = {
    schema: 'guandan-release-manifest-v1',
    name: 'guandan-local',
    version: require(path.join(root, 'package.json')).version,
    generatedAt: new Date().toISOString(),
    files: Object.fromEntries(manifestFiles.map(relative => [relative, sha256(path.join(output, relative))]))
};
fs.writeFileSync(path.join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`发布包已构建：${output}`);
console.log(`运行时文件：${manifestFiles.length} 个`);

if (verifyAfterBuild) {
    const checked = spawnSync(process.execPath, [path.join(root, 'tools', 'verify_release.js'), output], {
        cwd: root,
        encoding: 'utf8'
    });
    process.stdout.write(checked.stdout || '');
    process.stderr.write(checked.stderr || '');
    process.exit(checked.status === 0 ? 0 : 1);
}
