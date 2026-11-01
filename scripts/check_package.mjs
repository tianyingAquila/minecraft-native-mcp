import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import zlib from 'node:zlib';
const matrix=JSON.parse(fs.readFileSync('versions.json')),manifest=JSON.parse(fs.readFileSync('artifacts/helpers/manifest.json'));
if(matrix.versions.length!==12)throw Error('Incomplete 1.21 version matrix');
for(const version of matrix.versions){const row=manifest.versions[version.id];if(!row?.compiled||!version.dataPackVersion?.major)throw Error('Unbuilt version '+version.id);for(const entry of Object.values(row).filter(x=>x&&typeof x==='object'&&x.path)){const file=path.join('artifacts/helpers',entry.path);if(createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==entry.sha256)throw Error('Wrong helper checksum '+entry.path);}}
for(const file of ['bundled/mcpfabric/LICENSE','bundled/mcpfabric/dist/agent/runtime.js','bundled/mcpfabric/dist/agent/tools.js','src/game-setup.mjs'])if(!fs.existsSync(file))throw Error('Missing runtime file '+file);
for(const archive of process.argv.slice(2)){
 const tar=zlib.gunzipSync(fs.readFileSync(archive));let count=0;
 for(let p=0;p+512<tar.length;){const block=tar.subarray(p,p+512);if(block.every(b=>b===0))break;const text=(a,b)=>block.subarray(a,b).toString().replace(/\0.*$/s,'');const name=text(0,100),prefix=text(345,500),file=(prefix?prefix+'/':'')+name,size=parseInt(text(124,136).trim()||'0',8);if(/(?:^|\/)(?:data|runtime|logs|outputs|node_modules|vendor)(?:\/|$)|\.credentials|\.env(?:\.|$)|(?:^|\/)(?:client|server)\.jar$/.test(file))throw Error('Private or game file in release: '+file);p+=512+Math.ceil(size/512)*512;count++;}
 console.log(path.basename(archive)+': '+count+' public entries');
}
console.log('All 12 version artifacts and runtime files verified');
