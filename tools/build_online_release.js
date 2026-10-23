'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),dist=path.join(root,'dist'),index=process.argv.indexOf('--output');
const output=path.resolve(root,index>=0?process.argv[index+1]||'':'dist/guandan-online-alpha');
if(!output.startsWith(dist+path.sep)||output===dist)throw Error('联机发布目录必须在dist内');
if(fs.existsSync(output))throw Error('拒绝覆盖已有发布目录或其中的玩家数据，请使用新的 --output 目录');
const files=['online.html','admin.html','index.html','package.json','ONLINE_README.md','test_node.js',
    'css/online.css','css/style.css','js/online.js','js/online-admin.js','js/invite-qr.js','js/vendor/qrcodegen.js',
    'js/cards.js','js/engine.js','js/ai-policy-weights.js','js/ai-policy.js','js/human-profile.js','js/ai.js',
    'js/pro-ai-bridge.js','js/strategy-storage.js','js/v5-decision-transport.js','js/v5-worker-client.js','js/v5-rollout-worker.js','js/game.js',
    'server/index.js','server/rooms.js','server/runtime.js','server/store.js','server/ai-pool.js','server/ai-worker.js',
    'tests/online.test.js','tests/online-client.test.js','tests/online-load.test.js','docs/THIRD_PARTY_ONLINE.md'];
for(const relative of files){const target=path.join(output,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(root,relative),target);}
fs.renameSync(path.join(output,'ONLINE_README.md'),path.join(output,'README.md'));
const pkg=require(path.join(output,'package.json'));pkg.name='guandan-private-online';pkg.version='3.2.0-online-alpha';
pkg.scripts={start:'node server/index.js','start:online':'node server/index.js',test:'node test_node.js',
    'test:online':'node --test tests/online.test.js tests/online-client.test.js','test:online:load':'node --test tests/online-load.test.js'};
fs.writeFileSync(path.join(output,'package.json'),JSON.stringify(pkg,null,2)+'\n');
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const manifest={schema:'guandan-private-online-release-v1',version:pkg.version,createdAt:new Date().toISOString(),
    paymentsEnabled:false,publicDeploymentVerified:false,files:Object.fromEntries(files.map(f=>f==='ONLINE_README.md'?'README.md':f).sort().map(f=>[f,sha(path.join(output,f))]))};
fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log('好友房内测包已构建：'+output);
if(process.argv.includes('--verify')){
    const result=spawnSync(process.execPath,[path.join(__dirname,'verify_online_release.js'),output],{encoding:'utf8',cwd:root});
    process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');if(result.status!==0)process.exit(result.status||1);
}
