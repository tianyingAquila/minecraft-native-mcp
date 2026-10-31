import {Launcher} from './manager.mjs';
const PREFIX='/minecraft-native';
function frontend(){
  if(document.getElementById('minecraft-native-open'))return;
  const button=document.createElement('button');button.id='minecraft-native-open';button.textContent='Minecraft 控制台';Object.assign(button.style,{position:'fixed',top:'12px',right:'120px',zIndex:'10000',padding:'8px 12px',background:'#253b32',color:'white',borderRadius:'8px'});document.body.append(button);
  const panel=document.createElement('section');panel.hidden=true;Object.assign(panel.style,{position:'fixed',top:'60px',right:'20px',zIndex:'10001',padding:'24px',background:'white',color:'#193328',border:'1px solid #aaa',borderRadius:'12px',maxWidth:'600px'});
  panel.innerHTML='<h3>Minecraft 准备与启动</h3><p>首次需 Git、Python、Node.js、JDK21 和联网。准备会下载游戏及依赖，工作目录独立保留存档。</p><button data-act="prepare">准备依赖</button> <button data-act="open">打开控制台</button> <button data-act="stop">保存并停止</button> <button data-act="close">关闭</button><pre style="white-space:pre-wrap"></pre>';
  document.body.append(panel);const status=panel.querySelector('pre');let polling=false;
  async function refresh(){try{const s=await(await fetch('/minecraft-native/status')).json();status.textContent=(s.preparing?'正在准备，进度见 logs/setup.log':s.running?'控制台已运行':s.ready?'准备完成':'尚未准备')+'\n'+s.workspace+'\n'+(s.error||'');panel.querySelector('[data-act=stop]').disabled=!s.owned;}catch(e){status.textContent=e.message;}if(!panel.hidden)setTimeout(refresh,2000);else polling=false;}
  function show(){panel.hidden=false;if(!polling){polling=true;void refresh();}}
  async function send(name){const r=await fetch('/minecraft-native/'+name,{method:'POST'});const s=await r.json();if(!r.ok)throw Error(s.error);return s;}
  button.onclick=()=>{send('open').catch(e=>{show();status.textContent=e.message;});};
  for(const b of panel.querySelectorAll('button'))b.onclick=()=>{const act=b.dataset.act;if(act==='close'){panel.hidden=true;return;}send(act).then(()=>{if(act==='open')panel.hidden=true;}).catch(e=>{status.textContent=e.message;});};
}
const inject='('+frontend.toString()+')()';
const page=`<!doctype html><meta charset="utf-8"><title>Minecraft 控制台启动器</title><style>body{font:16px system-ui;max-width:760px;margin:60px auto;padding:24px;background:#f3f6f3;color:#193328}button,a{margin:8px;padding:12px}pre{white-space:pre-wrap}</style><h1>Minecraft Native MCP</h1><p>首次使用需要 Git、Node.js、Python、JDK21 和联网。准备依赖会下载 Minecraft、Fabric 和工具并构建插件；游戏存档保存在插件工作目录。准备完成后，一键打开直播控制台。</p><button id="prepare">准备依赖</button><button id="open">打开直播控制台</button><button id="stop">保存并停止插件启动的控制台</button><pre id="status"></pre><script>
let busy=false;
async function action(name){if(busy)return;busy=true;try{const r=await fetch('${PREFIX}/'+name,{method:'POST'});const s=await r.json();if(!r.ok)throw Error(s.error);await update()}catch(e){document.getElementById('status').textContent=e.message}finally{busy=false}}
async function update(){const r=await fetch('${PREFIX}/status');const s=await r.json();document.getElementById('status').textContent=(s.running?'控制台已运行':s.preparing?'正在准备依赖，请等待；日志在工作目录 logs/setup.log':s.ready?'准备完成':'尚未准备')+'\\n工作目录：'+s.workspace+'\\n'+(s.error||'');document.getElementById('stop').disabled=!s.owned;document.getElementById('prepare').disabled=s.preparing;}
for(const id of ['prepare','open','stop'])document.getElementById(id).onclick=()=>action(id);update();setInterval(()=>{if(!busy)update().catch(()=>{})},2000);
</script>`;
export default {
  name:'minecraft-native-mcp',
  apply(root,config={}){
    const manager=new Launcher({workspace:config.projectDirectory}),disposers=[];
    // Register before desktop boot collects injection rows. No external script loading.
    disposers.push(root.on('webserver/index-inject',table=>{if(!table.some(r=>r.text===inject))table.push({kind:'script',placement:'body',text:inject});}));
    root.inject(['webServer'],ctx=>{
      for(const suffix of ['/','/status','/prepare','/open','/stop'])disposers.push(ctx.webServer.register({kind:'exact',path:PREFIX+suffix,handler:async(req,res)=>{
        try{
          const connection=ctx.get?.('connection');const rejection=connection?.requestRejection?.(req);if(rejection){res.writeHead(typeof rejection==='number'?rejection:403);res.end();return;}
          if(suffix==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(page);return;}
          if(suffix!=='/status'&&req.method!=='POST'){res.writeHead(405);res.end();return;}
          if(suffix==='/prepare')manager.prepare();if(suffix==='/open')await manager.open();if(suffix==='/stop')await manager.stop();
          res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(await manager.status()));
        }catch(e){res.writeHead(400,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error:e.message}));}
      }}));
      if(ctx.webServer.tapIndex)disposers.push(ctx.webServer.tapIndex(html=>html.replace('</body>','<script>'+inject+'</script></body>')));
    });
    root.effect(()=>()=>{for(const dispose of disposers)if(typeof dispose==='function')dispose();return manager.dispose();});
  },
};
