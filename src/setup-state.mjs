export const SETUP_STEPS=[
 ['check','检查已有游戏与账户'],['java','确认 Java 运行环境'],['server','确认游戏服务器'],
 ['libraries','确认游戏运行库'],['mods','确认对应版本模组'],['profiles','确认游戏启动配置'],
 ['launch','启动 Minecraft'],['bridge','连接游戏工具'],['freeze','保存并暂停，等待开始'],
];
export class SetupError extends Error{
 constructor(code,step,title,detail='',hint='',retryable=true){super(title);Object.assign(this,{code,step,title,detail,hint,retryable});}
 toJSON(){return {code:this.code,step:this.step,title:this.title,detail:this.detail,hint:this.hint,retryable:this.retryable};}
}
export function describeSetupError(error,step='check'){
 if(error instanceof SetupError)return error.toJSON();
 const text=String(error?.message||'准备没有完成');
 const make=(code,title,hint)=>new SetupError(code,step,title,text,hint).toJSON();
 if(error?.name==='AbortError')return make('CANCELLED','准备已取消','已完成的下载会保留；需要时可以继续准备。');
 if(/CREDENTIAL|凭据|API key/i.test(error?.code+' '+text))return make('CREDENTIAL','尚未配置可用的 DeepSeek API 密钥','请打开 DSH 的模型/凭据设置，配置官方 DeepSeek API 后重试。');
 if(/balance|余额|充值/i.test(error?.code+' '+text))return make('BALANCE','DeepSeek 账户暂时无法开始','检查官方 API 账户余额和网络后重试；低于 ¥1 时不会发起模型请求。');
 if(/EADDRINUSE|端口.*占用|Address already in use/i.test(text))return make('PORT_BUSY','游戏端口已被其他程序占用','先保存并关闭另一套 Minecraft 控制台，再重试；不需要重启电脑。');
 if(/BRIDGE_AUTH|认证/.test(error?.code+' '+text))return make('BRIDGE_AUTH','游戏连接的认证配置不匹配','保存并停止游戏后重新准备，让程序重新加载当前配置。');
 if(/timed? ?out|超时|未在期限|BRIDGE_OFFLINE/i.test(error?.code+' '+text))return make('TIMEOUT','这一步没有在预期时间内完成','查看下方本步骤详情；首次游戏加载可能较慢，可重试。');
 if(/ENOENT|缺少|尚未准备/i.test(text))return make('MISSING_FILE','需要的运行文件尚未准备完整','点击重新准备，程序会复用完整文件并补齐缺失部分。');
 return make('SETUP_FAILED','当前步骤未完成','查看本步骤的详细原因，处理后点击重试；仍失败时可复制诊断信息。');
}
export class SetupState{
 constructor(){this.reset();}
 reset(){this.startedAt=Date.now();this.updatedAt=this.startedAt;this.active=null;this.running=false;this.error=null;this.progress=null;this.steps=SETUP_STEPS.map(([id,title])=>({id,title,state:'pending'}));}
 begin(){this.reset();this.running=true;}
 update(id,detail={}){
  const row=this.steps.find(x=>x.id===id);if(!row)return;
  if(this.active&&this.active!==id){const previous=this.steps.find(x=>x.id===this.active);if(previous?.state==='running')previous.state='done';}
  this.active=id;this.running=true;this.updatedAt=Date.now();this.progress=detail.progress||null;Object.assign(row,{state:'running',detail:detail.message||'',updatedAt:this.updatedAt});
 }
 finish(){for(const row of this.steps)if(row.state==='running')row.state='done';this.running=false;this.active=null;this.progress=null;this.updatedAt=Date.now();}
 fail(error){this.error=describeSetupError(error,this.active||'check');this.error.step=this.active||this.error.step;const row=this.steps.find(x=>x.id===this.active);if(row)row.state=this.error.code==='CANCELLED'?'cancelled':'failed';this.running=false;this.updatedAt=Date.now();}
 snapshot(){return {startedAt:this.startedAt,updatedAt:this.updatedAt,running:this.running,active:this.active,progress:this.progress,error:this.error,steps:this.steps};}
}
