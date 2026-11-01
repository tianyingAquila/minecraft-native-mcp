// Fixed-source developer/CI step. End users receive this output in the release package.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),source=path.join(root,'vendor/mcpfabric');
const revision=JSON.parse(fs.readFileSync(path.join(root,'vendor-lock.json'))).nativeClient.mcpFabricRevision;
if(execFileSync('git',['-C',source,'rev-parse','HEAD'],{encoding:'utf8'}).trim()!==revision)throw Error('Unexpected upstream source revision');
const dest=path.join(root,'bundled/mcpfabric');fs.mkdirSync(dest,{recursive:true});
fs.cpSync(path.join(source,'mcp-server/dist'),path.join(dest,'dist'),{recursive:true,filter:file=>fs.statSync(file).isDirectory()||file.endsWith('.js')});
fs.copyFileSync(path.join(source,'LICENSE'),path.join(dest,'LICENSE'));
fs.writeFileSync(path.join(dest,'package.json'),JSON.stringify({name:'bundled-mcpfabric-runtime',version:'0.8.0',type:'module',license:'MIT',source:'https://github.com/denfry/mcpfabric/tree/'+revision},null,2)+'\n');
console.log('Bundled fixed mcpfabric runtime');
