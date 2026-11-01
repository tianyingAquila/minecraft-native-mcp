import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {ROOT} from './config.mjs';
import {VERSION_MATRIX,chooseGame,findInstalledGames,readPrepared,versionEntry} from './versions.mjs';
import {SetupError} from './setup-state.mjs';
import {downloadVerified,verifiedFile,runOwned} from './downloads.mjs';
import {readDeepSeekKey} from './deepseek.mjs';
const execute=promisify(execFile);
const readJson=file=>JSON.parse(fs.readFileSync(file,'utf8').trimStart());
const writeJson=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');};
const nodeSupported=()=>{const [major,minor]=process.versions.node.split('.').map(Number);return major>22||major===22&&minor>=16;};
export function platformCheck(platform=process.platform,arch=process.arch){if(platform!=='win32'||arch!=='x64')throw new SetupError('PLATFORM','check','当前系统暂不支持自动准备',`${platform} / ${arch}`,'请使用 Windows 64位版本；不要通过反复重试安装不匹配的运行库。',false);}
export async function locateJava(root=ROOT){
 const toolsFile=path.join(root,'runtime/tools.json');let tools={};try{tools=readJson(toolsFile);}catch{}
 const portableOnly=process.env.FISH_PORTABLE_JAVA_ONLY==='1';
 const candidates=portableOnly?[tools.java].filter(p=>p&&path.resolve(p).startsWith(path.resolve(root,'runtime/tools/java')+path.sep)):[tools.java,process.env.FISH_JAVA,process.env.JAVA_HOME&&path.join(process.env.JAVA_HOME,'bin/java.exe')];
 if(!portableOnly)try{const {stdout}=await execute('where.exe',['java.exe'],{windowsHide:true,timeout:3000});candidates.push(...stdout.trim().split(/\r?\n/));}catch{}
 for(const parent of [...portableOnly?[]:[path.join(process.env.ProgramFiles||'C:/Program Files','Microsoft'),path.join(process.env.ProgramFiles||'C:/Program Files','Eclipse Adoptium')],path.join(root,'runtime/tools/java')]){
  try{for(const name of await fs.promises.readdir(parent))candidates.push(path.join(parent,name,'bin/java.exe'));}catch{}
 }
 for(const file of [...new Set(candidates.filter(Boolean))])try{if(path.resolve(file).startsWith(path.resolve(root,'runtime/tools/java')+path.sep)&&!fs.existsSync(path.join(root,'runtime/tools/java/ready.json')))continue;const {stdout,stderr}=await execute(file,['--version'],{windowsHide:true,timeout:5000});if(/(?:openjdk|java) 21[. ]/.test(stdout+stderr))return {java:file,javaHome:path.dirname(path.dirname(file)),version:(stdout+stderr).split(/\r?\n/)[0]};}catch{}
 return null;
}
function helperManifest(root=ROOT){try{return readJson(path.join(root,'artifacts/helpers/manifest.json'));}catch{return {versions:{}};}}
export async function inspectEnvironment(settings,{root=ROOT,platform=process.platform,arch=process.arch,keyReader=readDeepSeekKey}={}){
 const checks=[];let supported=true;try{platformCheck(platform,arch);checks.push({id:'platform',title:'Windows 64位',state:'ready',detail:'当前系统支持自动准备'});}catch(e){supported=false;checks.push({id:'platform',title:'系统兼容',state:'failed',detail:e.message,hint:e.hint});}
 checks.push({id:'node',title:'插件运行环境',state:nodeSupported()?'ready':'failed',detail:'Node.js '+process.versions.node,hint:nodeSupported()?'':'请更新 DSH；需要 Node22.16 或更新版本。'});
 const java=await locateJava(root);checks.push({id:'java',title:'Java21',state:java?'ready':'installable',detail:java?.version||'准备时将自动下载便携运行环境，无需手动安装'});
 const games=await findInstalledGames(settings.minecraftHome,root),selected=chooseGame(games,settings);
 checks.push({id:'game',title:'Minecraft 游戏本体',state:selected?'ready':'missing',detail:selected?'已找到 Java '+selected.version:'未找到所选版本的原版游戏文件',hint:selected?'':'先在启动器安装1.21系列正式版本，或选择已有游戏文件夹。'});
 let key=false;try{key=Boolean(keyReader());}catch{}
 checks.push({id:'credential',title:'DeepSeek API 配置',state:key?'ready':'missing',detail:key?'已读取 DSH 的官方 API 凭据；准备时核验余额':'尚未读取到官方 API 密钥',hint:key?'':'请在 DSH 配置官方 DeepSeek API 凭据；聊天订阅不等于 API 密钥。'});
 const helpers=helperManifest(root),row=selected&&helpers.versions[selected.version];
 const available=row&&await verifiedFile(path.join(root,'artifacts/helpers',row.client.path),row.client.sha256)&&await verifiedFile(path.join(root,'artifacts/helpers',row.server.path),row.server.sha256);
 checks.push({id:'helpers',title:'游戏辅助组件',state:available?'ready':selected?'missing':'installable',detail:available?'已包含 '+selected.version+' 对应文件':selected?'插件文件不完整，请重新安装发布包':'找到游戏后会自动匹配对应组件'});
 const prepared=readPrepared(root);
 const cached=prepared&&[prepared.clientProfile,prepared.serverProfile,prepared.pauseMod,prepared.serverJar,prepared.configFile].every(p=>typeof p==='string'&&fs.existsSync(p));
 checks.push({id:'prepared',title:'本地游戏环境',state:cached?'ready':'installable',detail:cached?'已缓存 '+prepared.version+'；尚需准备游戏确认连接':'首次准备会补齐运行库和独立服务器'});
 return {checkedAt:Date.now(),supported:supported&&nodeSupported(),checks,games,selectedVersion:selected?.version||null,versions:VERSION_MATRIX.versions.map(v=>({id:v.id,compiled:Boolean(helpers.versions[v.id]?.compiled),smoke:Boolean(v.validation?.smoke)})),preparedVersion:prepared?.version||null,workspace:root};
}
async function unpack(archive,destination,{signal,nativeOnly=false,root=ROOT}={}){
 return runOwned('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts/extract_archive.ps1'),'-Archive',archive,'-Destination',destination,...nativeOnly?['-NativeOnly']:[]],{signal,timeoutMs:180000});
}
async function ensureJava(root,signal,progress){
 let java=await locateJava(root);if(java){progress('java',{message:java.version});return java;}
 progress('java',{message:'正在获取便携 Java21，无需管理员权限'});
 let packages;try{const r=await fetch('https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=x64&image_type=jre&os=windows&vendor=eclipse',{signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)});if(!r.ok)throw Error('HTTP '+r.status);packages=await r.json();}catch(e){throw new SetupError('JAVA_DOWNLOAD','java','无法获取 Java21 运行环境',e.message,'检查网络后重试；也可使用已安装的Java21。');}
 const pkg=packages[0]?.binary?.package;if(!pkg?.checksum||!pkg?.link)throw new SetupError('JAVA_PACKAGE','java','Java 下载源没有返回可用文件','','稍后重试。');
 const archive=path.join(root,'runtime/downloads/java21.zip');await downloadVerified({url:pkg.link,hash:pkg.checksum,algorithm:'sha256',size:pkg.size},archive,{signal,onProgress:p=>progress('java',{message:'正在下载 Java21',progress:p})});
 progress('java',{message:'正在解压便携 Java21'});await unpack(archive,path.join(root,'runtime/tools/java'),{signal,root});writeJson(path.join(root,'runtime/tools/java/ready.json'),{sha256:pkg.checksum});java=await locateJava(root);
 if(!java)throw new SetupError('JAVA_START','java','便携 Java21 没有正常启动','','重新准备以检查下载文件。');return java;
}
function allowed(rules){let yes=!rules;for(const rule of rules||[]){const spec=rule.os||{};let match=!spec.name||spec.name==='windows';if(spec.arch)match&&=new RegExp(spec.arch).test('amd64');if(rule.features){const features={has_quick_plays_support:true,is_quick_play_multiplayer:true};match&&=Object.entries(rule.features).every(([k,v])=>Boolean(features[k])===v);}if(match)yes=rule.action==='allow';}return yes;}
export async function prepareGameEnvironment(settings,{root=ROOT,signal,onProgress=()=>{}}={}){
 platformCheck();if(!nodeSupported())throw new SetupError('NODE_VERSION','check','DSH 的运行环境需要更新','Node.js '+process.versions.node,'请更新 DSH，再重新打开控制台。',false);
 onProgress('check',{message:'正在识别已有游戏文件'});const games=await findInstalledGames(settings.minecraftHome,root),game=chooseGame(games,settings);
 if(!game)throw new SetupError('GAME_MISSING','check','没有找到可用的 Minecraft 本体',settings.minecraftVersion==='auto'?'支持1.21至1.21.11的正式版本':'需要 Java '+settings.minecraftVersion,'在启动器安装并启动一次对应版本，或点击“选择游戏文件夹”；不会自动下载客户端本体。');
 const entry=versionEntry(game.version),helpers=helperManifest(root).versions[game.version];
 if(!helpers)throw new SetupError('HELPERS_MISSING','mods','当前插件缺少此版本的预构建模组',game.version,'请安装完整发布包；开发者可运行模组构建脚本。',false);
 const previous=readPrepared(root);
 if(previous?.version!==game.version)await fs.promises.rm(path.join(root,'runtime/prepared.json'),{force:true});
 const java=await ensureJava(root,signal,onProgress);process.env.FISH_JAVA=java.java;process.env.JAVA_HOME=java.javaHome;
 let tools={};try{tools=readJson(path.join(root,'runtime/tools.json'));}catch{}writeJson(path.join(root,'runtime/tools.json'),{...tools,node:tools.node||process.execPath,...java});
 const versionRoot=path.join(root,'runtime/versions',game.version);await fs.promises.mkdir(versionRoot,{recursive:true});
 const clientJar=path.join(versionRoot,'client.jar');if(path.resolve(clientJar)!==path.resolve(game.jar)&&!await verifiedFile(clientJar,entry.client.sha1,'sha1'))await fs.promises.copyFile(game.jar,clientJar);
 const pull=(spec,target,step,message)=>downloadVerified(spec,target,{signal,onProgress:p=>onProgress(step,{message,progress:p})});
 onProgress('server',{message:'正在准备 '+game.version+' 独立服务器'});const serverJar=path.join(versionRoot,'server.jar');
 const oldServer=path.join(root,'runtime/server-'+game.version+'.jar');if(!fs.existsSync(serverJar)&&await verifiedFile(oldServer,entry.server.sha1,'sha1'))await fs.promises.copyFile(oldServer,serverJar);
 await pull(entry.server,serverJar,'server','正在下载独立服务器');
 const metadataFile=path.join(versionRoot,'version.json');await pull({url:entry.metadata.url,hash:entry.metadata.sha1,algorithm:'sha1'},metadataFile,'libraries','读取官方运行库清单');const meta=readJson(metadataFile);
 const librariesRoot=path.join(root,'runtime/libraries'),classpath=[],nativeJars=[],jobs=[];
 for(const lib of meta.libraries){if(!allowed(lib.rules))continue;const a=lib.downloads?.artifact;if(a){const target=path.join(librariesRoot,a.path);jobs.push([a,target]);classpath.push(target);if(a.path.includes('natives-windows'))nativeJars.push(target);}
  const classifier=lib.natives?.windows?.replace('${arch}','64'),n=lib.downloads?.classifiers?.[classifier];if(n){const target=path.join(librariesRoot,n.path);jobs.push([n,target]);nativeJars.push(target);}}
 const assetsRoot=path.join(root,'runtime/assets'),indexFile=path.join(assetsRoot,'indexes',meta.assets+'.json');await pull(meta.assetIndex,indexFile,'libraries','读取声音与材质清单');const index=readJson(indexFile);
 const sharedAssets=[process.env.FISH_ASSET_ROOT,path.join(game.home,'assets'),path.join(game.home,'../../assets'),path.join(process.env.APPDATA||os.homedir(),'.minecraft/assets')].filter(Boolean);
 for(const a of Object.values(index.objects)){signal?.throwIfAborted();const relative=path.join('objects',a.hash.slice(0,2),a.hash),target=path.join(assetsRoot,relative);if(!fs.existsSync(target)){const cached=sharedAssets.map(base=>path.join(base,relative)).find(p=>fs.existsSync(p));if(cached&&await verifiedFile(cached,a.hash,'sha1')){await fs.promises.mkdir(path.dirname(target),{recursive:true});await fs.promises.copyFile(cached,target);continue;}}
  jobs.push([{url:'https://resources.download.minecraft.net/'+a.hash.slice(0,2)+'/'+a.hash,sha1:a.hash,size:a.size},target]);}
 const queue=[...new Map(jobs.map(job=>[path.resolve(job[1]),job])).values()];
 let done=0,firstFailure;onProgress('libraries',{message:'正在核验 '+queue.length+' 个运行文件'});
 // Bounded parallel workers reuse verified caches; the first error cancels all owned downloads.
 const workers=new AbortController();const combined=signal?AbortSignal.any([signal,workers.signal]):workers.signal;let cursor=0;
 const worker=async()=>{while(cursor<queue.length){const [spec,target]=queue[cursor++];await downloadVerified(spec,target,{signal:combined,onProgress:p=>onProgress('libraries',{message:'补齐运行文件',progress:{...p,filesDone:done,filesTotal:queue.length}})});done++;onProgress('libraries',{message:`运行文件 ${done} / ${queue.length}`,progress:{filesDone:done,filesTotal:queue.length}});}};
 await Promise.allSettled(Array.from({length:4},()=>worker().catch(e=>{firstFailure??=e;workers.abort();throw e;})));if(firstFailure)throw firstFailure;
 const natives=path.join(versionRoot,'natives');for(const jar of [...new Set(nativeJars)])await unpack(jar,natives,{signal,nativeOnly:true,root});
 onProgress('mods',{message:'正在安装 '+game.version+' 对应模组'});
 const legacyDir=path.join(root,'data/native-client');const gameDir=game.version==='1.21.4'&&fs.existsSync(legacyDir)?legacyDir:path.join(root,'data/clients',game.version);const mods=path.join(gameDir,'mods');await fs.promises.mkdir(mods,{recursive:true});
 for(const name of await fs.promises.readdir(mods))if(/^(mcpfabric-|baritone-|fabric-api-|fish-live-client-|fish-client)/.test(name))await fs.promises.rm(path.join(mods,name),{force:true});
 for(const [key,name] of [['mcp','mcpfabric.jar'],['baritone','baritone.jar'],['fabricApi','fabric-api.jar']]){
  if(key==='mcp'&&helpers.mcpCompat){const from=path.join(root,'artifacts/helpers',helpers.mcpCompat.path);if(!await verifiedFile(from,helpers.mcpCompat.sha256))throw new SetupError('HELPER_HASH','mods','兼容模组文件不完整','','请重新安装完整发布包。');await fs.promises.copyFile(from,path.join(mods,name));}
  else await pull(entry[key],path.join(mods,name),'mods','安装 '+name);
 }
 for(const [kind,into] of [['client',path.join(mods,'fish-client.jar')],['server',path.join(versionRoot,'fish-pause-server.jar')]]){const from=path.join(root,'artifacts/helpers',helpers[kind].path);if(!await verifiedFile(from,helpers[kind].sha256))throw new SetupError('HELPER_HASH','mods','预构建模组文件校验失败',kind,'请重新安装完整发布包。');await fs.promises.copyFile(from,into);}
 const profileUrl='https://meta.fabricmc.net/v2/versions/loader/'+game.version+'/'+VERSION_MATRIX.loader+'/profile/json';let profile;
 try{const response=await fetch(profileUrl,{signal:combined});if(!response.ok)throw Error('HTTP '+response.status);profile=await response.json();}catch(e){if(signal?.aborted)throw signal.reason;throw new SetupError('FABRIC_PROFILE','mods','无法读取 Fabric 启动配置',e.message,'检查能否访问 meta.fabricmc.net，然后重试。');}
 const fabricLibraries=[];for(const lib of profile.libraries){const [group,name,version]=lib.name.split(':'),relative=group.replaceAll('.','/')+'/'+name+'/'+version+'/'+name+'-'+version+'.jar',target=path.join(librariesRoot,relative),url=lib.url.replace(/\/$/,'')+'/'+relative;
  let hash;try{const r=await fetch(url+'.sha1',{signal:combined});if(!r.ok)throw Error('HTTP '+r.status);hash=(await r.text()).trim().split(/\s/)[0];if(!/^[0-9a-f]{40}$/i.test(hash))throw Error('无有效校验值');}catch(e){throw new SetupError('FABRIC_LIBRARY','mods','无法核验 Fabric 运行库',name+'：'+e.message,'检查下载网络后重试。');}
  await pull({url,hash,algorithm:'sha1'},target,'mods','准备 Fabric 运行库');fabricLibraries.push(target);}
 onProgress('profiles',{message:'生成独立游戏配置，保留已有存档'});
 const configFile=path.join(gameDir,'config/mcpfabric.config.json');let config={};try{config=readJson(configFile);}catch{}
 config={...config,host:'127.0.0.1',port:settings.mcpPort||25587,requireAuth:true,enableWorldWrite:false,enableCommands:false,enablePlayerControl:true,enableVision:true,enableUiControl:false,enableSupervisedControl:false,token:config.token||randomUUID().replaceAll('-',''),worldIdKey:config.worldIdKey||randomUUID().replaceAll('-','')};writeJson(configFile,config);
 if(!fs.existsSync(path.join(gameDir,'options.txt')))fs.writeFileSync(path.join(gameDir,'options.txt'),'lang:zh_cn\npauseOnLostFocus:false\nrenderDistance:8\nsimulationDistance:6\nmaxFps:60\nenableVsync:true\nfullscreen:false\nsoundCategory_music:0.0\ngamma:1.0\ntutorialStep:none\n');
 const replacements={auth_player_name:'DeepSeekFish',version_name:game.version,game_directory:gameDir,assets_root:assetsRoot,assets_index_name:meta.assets,auth_uuid:'d1098f6469cb31faad1009e110ee5388',auth_access_token:'0',clientid:'0',auth_xuid:'0',user_type:'legacy',version_type:'release',resolution_width:'1280',resolution_height:'720',quickPlayPath:path.join(versionRoot,'quickplay.json'),quickPlayMultiplayer:'127.0.0.1:'+(settings.minecraftPort||25586),natives_directory:natives,launcher_name:'MinecraftNativeMCP',launcher_version:'0.3.0',classpath:[...fabricLibraries,...classpath.filter(p=>!p.replaceAll('\\','/').includes('/org/ow2/asm/')),clientJar].join(path.delimiter),library_directory:librariesRoot};
 const uuid=createHash('md5').update('OfflinePlayer:DeepSeekFish').digest();uuid[6]=(uuid[6]&15)|48;uuid[8]=(uuid[8]&63)|128;replacements.auth_uuid=uuid.toString('hex');
 const expand=s=>s.replace(/\$\{([^}]+)\}/g,(_,key)=>{if(!(key in replacements))throw new SetupError('LAUNCH_ARGUMENT','profiles','官方启动参数暂未适配',key,'请更新插件。',false);return replacements[key];});
 const args=group=>meta.arguments[group].flatMap(item=>typeof item==='string'?[expand(item)]:allowed(item.rules)?(Array.isArray(item.value)?item.value:[item.value]).map(expand):[]);
 const clientArgs=['-Xms256M','-Xmx2G','-Dfabric.gameVersion='+game.version,...args('jvm'),profile.mainClass,...args('game'),'--width','1280','--height','720'];
 const serverArgs=['-Xms256M','-Xmx2G','-Dfile.encoding=UTF-8','-Dfabric.gameVersion='+game.version,'-cp',[...fabricLibraries,serverJar].join(path.delimiter),'net.fabricmc.loader.impl.launch.knot.KnotServer','nogui'];
 const clientProfile=path.join(versionRoot,'client-launch.json'),serverProfile=path.join(versionRoot,'server-launch.json');writeJson(clientProfile,{version:game.version,args:clientArgs,gameDir,configFile});writeJson(serverProfile,{version:game.version,args:serverArgs});
 const prepared={schema:2,version:game.version,clientProfile,serverProfile,serverJar,pauseMod:path.join(versionRoot,'fish-pause-server.jar'),gameDir,configFile,helperHash:helpers.client.sha256,at:Date.now()};writeJson(path.join(root,'runtime/prepared.json'),prepared);return prepared;
}
