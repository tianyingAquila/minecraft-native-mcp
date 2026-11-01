import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {SetupError} from './setup-state.mjs';
import {stopChildTree} from './minecraft.mjs';
export async function fileHash(file,algorithm='sha256'){const h=createHash(algorithm);for await(const chunk of fs.createReadStream(file))h.update(chunk);return h.digest('hex');}
export async function verifiedFile(file,hash,algorithm='sha256'){try{return (await fileHash(file,algorithm))===hash;}catch{return false;}}
export async function downloadVerified(spec,target,{signal,onProgress=()=>{},fetchImpl=fetch}={}){
 const algorithm=spec.algorithm||'sha1',expected=spec.hash||spec.sha1;
 if(!['sha1','sha256','sha512'].includes(algorithm)||!new RegExp('^[a-f0-9]{'+({sha1:40,sha256:64,sha512:128})[algorithm]+'}$','i').test(expected||''))throw new SetupError('DOWNLOAD_MANIFEST','libraries','插件中的文件校验信息无效',path.basename(target),'请重新安装完整发布包。',false);
 signal?.throwIfAborted();if(await verifiedFile(target,expected,algorithm))return {cached:true};
 await fs.promises.mkdir(path.dirname(target),{recursive:true});const partial=target+'.download';
 const source=new URL(spec.url);if(source.protocol!=='https:')throw new SetupError('DOWNLOAD_SOURCE','libraries','下载地址无效',source.host,'请更新到正式发布包。',false);
 let lastError;
 for(let attempt=0;attempt<3;attempt++){
  signal?.throwIfAborted();const timeout=AbortSignal.timeout(180000);const combined=signal?AbortSignal.any([signal,timeout]):timeout;
  try{
   const response=await fetchImpl(source,{signal:combined});
   if(!response.ok)throw new SetupError('DOWNLOAD_HTTP','libraries',`下载服务器返回 HTTP ${response.status}`,source.host,'检查网络后重试；程序会保留已下载完整的文件。');
   const total=Number(response.headers.get('content-length'))||spec.size||0;let received=0,last=0;const out=await fs.promises.open(partial,'w');
   try{for await(const bytes of response.body){signal?.throwIfAborted();await out.write(bytes);received+=bytes.length;if(Date.now()-last>250){last=Date.now();onProgress({file:path.basename(target),received,total,host:source.host,attempt:attempt+1});}}}finally{await out.close();}
   if(!await verifiedFile(partial,expected,algorithm))throw new SetupError('DOWNLOAD_HASH','libraries','下载文件校验没有通过',path.basename(target),'文件可能未下载完整；重试会重新获取该文件。');
   await fs.promises.rename(partial,target);onProgress({file:path.basename(target),received,total:total||received,host:source.host,complete:true});return {cached:false};
  }catch(error){lastError=error;await fs.promises.rm(partial,{force:true}).catch(()=>{});if(signal?.aborted)throw signal.reason;onProgress({file:path.basename(target),host:source.host,retrying:attempt<2,attempt:attempt+1});if(attempt<2)await delay(500*(attempt+1),undefined,{signal});}
 }
 if(lastError instanceof SetupError)throw lastError;
 throw new SetupError('DOWNLOAD_NETWORK','libraries','无法完成运行文件下载',source.host+'：'+String(lastError?.cause?.code||lastError?.code||lastError?.message||'连接失败'),'请检查网络能否访问该下载源，然后重试。');
}
export async function runOwned(exe,args,{cwd,env=process.env,signal,timeoutMs=120000}={}){
 signal?.throwIfAborted();
 if(process.platform==='win32'&&/powershell(?:\.exe)?$/i.test(exe))env={...env,PSModulePath:path.join(env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/Modules')};
 const child=spawn(exe,args,{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';
 const collect=b=>{output=(output+b.toString()).slice(-6000);};child.stdout.on('data',collect);child.stderr.on('data',collect);
 let timedOut=false;
 const abort=()=>void stopChildTree(child);signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(()=>{timedOut=true;abort();},timeoutMs);
 try{await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>signal?.aborted?reject(signal.reason):timedOut?reject(new SetupError('PROCESS_TIMEOUT','profiles','运行文件处理超时',output,'可以重新准备，已完成的下载会保留。')):code===0?resolve():reject(new Error(output||'运行文件处理失败')));});signal?.throwIfAborted();return output;}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);if(signal?.aborted)await stopChildTree(child);}
}
