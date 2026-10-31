function frontend(){
  if(window.__minecraftStreamMounted)return;
  window.__minecraftStreamMounted=true;
  const b=document.createElement('button');b.id='minecraft-stream-open';b.textContent='直播扩展';b.type='button';
  Object.assign(b.style,{display:'inline-flex',marginLeft:'8px',padding:'5px 10px',font:'inherit',color:'inherit',background:'transparent',border:'1px solid currentColor',borderRadius:'7px',cursor:'pointer',webkitAppRegion:'no-drag'});
  const attach=()=>{const main=document.getElementById('minecraft-native-open');if(main?.isConnected&&b.previousElementSibling!==main)main.after(b);};
  new MutationObserver(attach).observe(document.body,{childList:true,subtree:true});attach();
  b.onclick=async()=>{b.disabled=true;try{const r=await fetch('/minecraft-native/streaming/on',{method:'POST'});const s=await r.json();if(!r.ok)throw Error(s.error||'请先安装基础版并暂停游戏。');}catch(e){alert(e.message);}finally{b.disabled=false;}};
}
const script='('+frontend.toString()+')()';
export default{name:'dsh-minecraft-stream',apply(root){
  const dispose=root.on('webserver/index-inject',table=>{if(!table.some(r=>r.text===script))table.push({kind:'script',placement:'body',text:script});});
  root.effect(()=>dispose);
  root.inject(['webServer'],ctx=>{if(ctx.webServer.tapIndex)ctx.effect(()=>ctx.webServer.tapIndex(html=>html.replace('</body>','<script>'+script+'</script></body>')));});
}};
