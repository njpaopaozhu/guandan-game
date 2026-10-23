'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const directory=path.resolve(process.argv[2]||path.join(__dirname,'../dist/guandan-online-alpha'));
const manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json')));assert.equal(manifest.schema,'guandan-private-online-release-v1');
for(const [file,hash]of Object.entries(manifest.files)){
    assert(!file.split(/[\\/]/).includes('..')&&!path.isAbsolute(file));
    assert(!/\.(pt|npz|pyc)$/.test(file)&&!file.startsWith('data/')&&!file.startsWith('experiments/'));
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(directory,file))).digest('hex'),hash,'发布文件不匹配：'+file);
}
for(const file of ['server/index.js','online.html','README.md','tests/online.test.js','tests/online-client.test.js','js/vendor/qrcodegen.js'])assert(Object.hasOwn(manifest.files,file));
assert.equal(manifest.files['js/vendor/qrcodegen.js'],'2511bc17f40a3c41d4a0578995db956b38997334d3d20113a5d4dc5c49c69480');
for(const args of [['test_node.js'],['--test','tests/online.test.js','tests/online-client.test.js']]){
    const test=spawnSync(process.execPath,args,{encoding:'utf8',cwd:directory});
    process.stdout.write(test.stdout||'');process.stderr.write(test.stderr||'');assert.equal(test.status,0,'发布包自检失败');
}
console.log('好友房包：哈希、依赖闭合、规则与联机测试通过；不代表公网或支付验收。');
