import fs from 'node:fs';
import path from 'node:path';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {ListToolsRequestSchema,CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {ClientActions} from './client-actions.mjs';
import {ClientBridge} from './client-bridge.mjs';
import {Runtime} from './runtime.mjs';
import {DATA} from './config.mjs';
import {VisionDiagnostics,VISION_TOOL} from './vision.mjs';

// stdout is exclusively MCP JSON-RPC. No DeepSeek request is made by this process.
let runtime,actions;
const launched=process.argv.includes('--launch');
if(launched){
  runtime=new Runtime();await runtime.prepare({requireModel:false});
  runtime.minecraft.resume();await runtime.mcp.resume();actions=runtime.mcp;
}else{
  const file=process.env.FISH_BRIDGE_CONFIG||path.join(DATA,'native-client/config/mcpfabric.config.json');
  const config=JSON.parse(fs.readFileSync(file,'utf8'));
  if(config.host!=='127.0.0.1'||!config.requireAuth)throw Error('Authenticated loopback game bridge required');
  actions=new ClientActions({bridge:new ClientBridge({url:'http://127.0.0.1:'+config.port,token:config.token}),store:{settings:{world:'external'},performance:{},event:()=>{}}});
  await actions.connect();
}
const vision=new VisionDiagnostics({capture:({signal})=>actions.bridge.call('fish.screenshot',{}, {signal})});
const server=new Server({name:'minecraft-native-mcp',version:'0.1.0'},{capabilities:{tools:{}}});
server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[...actions.tools(),VISION_TOOL].map(t=>({name:t.function.name,description:t.function.description,inputSchema:t.function.parameters}))}));
server.setRequestHandler(CallToolRequestSchema,async(request,extra)=>{
  try{
    const {name,arguments:args={}}=request.params;
    if(name==='inspect_game_screen'){
      await vision.request(args,{signal:extra.signal});const shot=vision.peek();
      if(!shot)throw Error('Screenshot expired');
      vision.consumed(shot.id);
      return {content:[{type:'text',text:'Current game framebuffer; use for this diagnosis only.'},{type:'image',data:shot.base64,mimeType:shot.mime}]};
    }
    const result=await actions.execute(name,args,{signal:extra.signal});
    return {content:[{type:'text',text:JSON.stringify(result)}],isError:result.state==='failed'};
  }catch(error){return {isError:true,content:[{type:'text',text:String(error.message)}]};}
});
let closing=false;
async function close(){if(closing)return;closing=true;vision.clear();if(runtime)await runtime.close();else await actions.close();await server.close();}
server.onclose=()=>{void close().finally(()=>process.exit(0));};
process.on('SIGINT',()=>void close().finally(()=>process.exit(0)));
process.on('SIGTERM',()=>void close().finally(()=>process.exit(0)));
await server.connect(new StdioServerTransport());
