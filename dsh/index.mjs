import {Launcher} from './manager.mjs';
const PREFIX='/minecraft-native';
function frontend(){
  if(window.__minecraftNativeLauncherMounted)return;
  window.__minecraftNativeLauncherMounted=true;
  const button=document.createElement('button');button.id='minecraft-native-open';button.textContent='Minecraft';button.type='button';button.title='打开 Minecraft 自主游玩控制台';
  Object.assign(button.style,{display:'inline-flex',alignItems:'center',marginLeft:'8px',padding:'5px 10px',font:'inherit',color:'inherit',background:'transparent',border:'1px solid currentColor',borderRadius:'7px',cursor:'pointer',webkitAppRegion:'no-drag'});
  function place(){
    const mode=[...document.querySelectorAll('button,[role="button"]')].find(el=>el!==button&&/^(标准|规划|计划|普通|架构|代码|默认|问答|审查|研究).*模式$/.test(el.textContent.trim()));
    if(mode&&button.previousElementSibling!==mode)mode.after(button);
  }
  const observer=new MutationObserver(place);observer.observe(document.body,{childList:true,subtree:true});place();
  const panel=document.createElement('section');panel.hidden=true;Object.assign(panel.style,{position:'fixed',top:'60px',right:'20px',zIndex:'10001',padding:'24px',background:'white',color:'#193328',border:'1px solid #aaa',borderRadius:'12px',maxWidth:'600px'});
  panel.innerHTML='<h3>Minecraft 启动器</h3><p>安装后自动复用 DSH 的插件依赖。自行安装任一受支持的 Minecraft Java1.21系列正式版，然后打开控制台；环境检查、版本选择和准备进度都在那里显示。</p><button data-act="prepare">修复控制台依赖</button> <button data-act="open">打开控制台</button> <button data-act="stop">保存并停止</button> <button data-act="close">关闭</button><pre style="white-space:pre-wrap"></pre>';
  document.body.append(panel);const status=panel.querySelector('pre');let polling=false;
  async function refresh(){try{const s=await(await fetch('/minecraft-native/status')).json();status.textContent=(s.preparing?'正在准备，进度见 logs/setup.log':s.running?'控制台已运行':s.ready?'准备完成':'尚未准备')+'\n'+s.workspace+'\n'+(s.error||'');panel.querySelector('[data-act=stop]').disabled=!s.owned;}catch(e){status.textContent=e.message;}if(!panel.hidden)setTimeout(refresh,2000);else polling=false;}
  function show(){panel.hidden=false;if(!polling){polling=true;void refresh();}}
  async function send(name){const r=await fetch('/minecraft-native/'+name,{method:'POST'});const s=await r.json();if(!r.ok)throw Error(s.error);return s;}
  button.onclick=()=>{send('open').then(s=>{if(s.pendingOpen||s.preparing)show();}).catch(e=>{show();status.textContent=e.message;});};
  for(const b of panel.querySelectorAll('button'))b.onclick=()=>{const act=b.dataset.act;if(act==='close'){panel.hidden=true;return;}send(act).then(()=>{if(act==='open')panel.hidden=true;}).catch(e=>{status.textContent=e.message;});};
}
export const frontendScript='('+frontend.toString()+')()';
const inject=frontendScript;
const page=`<!doctype html><meta charset="utf-8"><title>Minecraft 控制台启动器</title><style>body{font:16px system-ui;max-width:760px;margin:60px auto;padding:24px;background:#f3f6f3;color:#193328}button,a{margin:8px;padding:12px}pre{white-space:pre-wrap}</style><h1>Minecraft Native MCP</h1><p>基础依赖自动检查补齐。请自行安装并启动一次 Minecraft Java1.21系列正式版，在 DSH 配置官方 DeepSeek API 凭据，保持联网。打开控制台后点“准备游戏”，自动配置 Fabric、辅助模组及独立世界，连接成功后才允许开始冒险。默认没有直播挂件。</p><button id="prepare">重试基础依赖</button><button id="open">打开自主游玩控制台</button><button id="stop">保存并停止插件启动的控制台</button><pre id="status"></pre><script>
let busy=false;
async function action(name){if(busy)return;busy=true;try{const r=await fetch('${PREFIX}/'+name,{method:'POST'});const s=await r.json();if(!r.ok)throw Error(s.error);await update()}catch(e){document.getElementById('status').textContent=e.message}finally{busy=false}}
async function update(){const r=await fetch('${PREFIX}/status');const s=await r.json();document.getElementById('status').textContent=(s.running?'控制台已运行':s.preparing?'正在准备依赖，请等待；日志在工作目录 logs/setup.log':s.ready?'准备完成':'尚未准备')+'\\n工作目录：'+s.workspace+'\\n'+(s.error||'');document.getElementById('stop').disabled=!s.owned;document.getElementById('prepare').disabled=s.preparing;}
for(const id of ['prepare','open','stop'])document.getElementById(id).onclick=()=>action(id);update();setInterval(()=>{if(!busy)update().catch(()=>{})},2000);
</script>`;
export default {
  name:'minecraft-native-mcp',
  apply(root,config={}){
    const manager=new Launcher({workspace:config.projectDirectory,managed:!config.projectDirectory}),disposers=[];
    // Register before desktop boot collects injection rows. No external script loading.
    disposers.push(root.on('webserver/index-inject',table=>{if(!table.some(r=>r.text===inject))table.push({kind:'script',placement:'body',text:inject});}));
    root.inject(['webServer'],ctx=>{
      manager.resolveKey=async()=>{try{return await ctx.get?.('credentials')?.resolve('DEEPSEEK_API_KEY');}catch{return undefined;}};
      for(const suffix of ['/','/status','/prepare','/open','/stop','/streaming/on','/streaming/off'])disposers.push(ctx.webServer.register({kind:'exact',path:PREFIX+suffix,handler:async(req,res)=>{
        try{
          const connection=ctx.get?.('connection');const rejection=connection?.requestRejection?.(req);if(rejection){res.writeHead(typeof rejection==='number'?rejection:403);res.end();return;}
          if(suffix==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(page);return;}
          if(suffix!=='/status'&&req.method!=='POST'){res.writeHead(405);res.end();return;}
          if(suffix==='/prepare')void manager.prepare().catch(()=>{});if(suffix==='/open')await manager.open();if(suffix==='/stop')await manager.stop();
          if(suffix==='/streaming/on')await manager.streaming(true);if(suffix==='/streaming/off')await manager.streaming(false);
          res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(await manager.status()));
        }catch(e){res.writeHead(400,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error:e.message}));}
      }}));
      if(ctx.webServer.tapIndex)disposers.push(ctx.webServer.tapIndex(html=>html.replace('</body>','<script>'+inject+'</script></body>')));
    });
    if(config.autoPrepare!==false)void manager.initialize().catch(e=>{manager.error=e.message;});
    root.effect(()=>()=>{for(const dispose of disposers)if(typeof dispose==='function')dispose();return manager.dispose();});
  },
};
