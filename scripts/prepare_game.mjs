import {prepareGameEnvironment} from '../src/game-setup.mjs';
import {readSettings,saveSettings} from '../src/config.mjs';
const args=process.argv.slice(2),settings=readSettings();
for(const [flag,key] of [['--version','minecraftVersion'],['--minecraft-home','minecraftHome']]){const i=args.indexOf(flag);if(i>=0)settings[key]=args[i+1];}
const signal=new AbortController();process.once('SIGINT',()=>signal.abort());
try{const prepared=await prepareGameEnvironment(settings,{signal:signal.signal,onProgress:(step,detail)=>console.log(JSON.stringify({step,...detail}))});settings.resolvedVersion=prepared.version;saveSettings(settings);console.log(JSON.stringify({prepared:true,version:prepared.version}));}
catch(e){console.error(JSON.stringify({error:e.title||e.message,code:e.code,detail:e.detail,hint:e.hint}));process.exitCode=1;}
