import net from 'node:net';
import {SetupError} from './setup-state.mjs';
export async function portAvailable(port){return new Promise(resolve=>{const server=net.createServer();server.once('error',error=>resolve({port,available:false,code:error.code}));server.listen({host:'127.0.0.1',port,exclusive:true},()=>server.close(()=>resolve({port,available:true})));});}
export async function checkGamePorts(settings){const result=await Promise.all([settings.minecraftPort,settings.mcpPort].map(portAvailable));const blocked=result.filter(x=>!x.available);if(blocked.length)throw new SetupError('PORT_BUSY','launch','游戏连接端口暂时不可用',blocked.map(x=>x.port+'：'+x.code).join('，'),'请先保存并关闭另一套游戏控制台后重试；程序不会强行关闭其他软件。');return result;}
