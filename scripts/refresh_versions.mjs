// Developer-only: pin official artifacts. Runtime installation reads versions.json offline.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const json=async url=>{const r=await fetch(url,{signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error(`${new URL(url).host}: HTTP ${r.status}`);return r.json();};
const gh=route=>JSON.parse(execFileSync('gh',['api',route],{encoding:'utf8',maxBuffer:8e6}));
const manifest=await json('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
const mcp=gh('repos/denfry/mcpfabric/releases/tags/v0.8.0');
const releases=gh('repos/cabaletta/baritone/releases?per_page=100');
const versions={schema:1,loader:'0.20.1',mcpVersion:'0.8.0',mcpRevision:'75c9cb2eb4ff7865b4a9afe8930269ba67280c66',versions:[]};
for(const release of manifest.versions.filter(x=>/^1\.21(?:\.\d+)?$/.test(x.id)).reverse()){
  const v=release.id;
  const meta=await json(release.url);
  const api=await json('https://api.modrinth.com/v2/project/P7dR8mSH/version?loaders='+encodeURIComponent('["fabric"]')+'&game_versions='+encodeURIComponent(JSON.stringify([v])));
  const apiFile=api[0].files.find(f=>f.primary)||api[0].files[0];
  const baritone=releases.find(r=>(r.body?.match(/\b1\.21(?:\.\d+)?\b/g)||[]).includes(v)&&r.assets.some(a=>a.name===`baritone-api-fabric-${r.tag_name.slice(1)}.jar`));
  if(!baritone)throw Error('No Baritone for '+v);
  const baritoneFile=baritone.assets.find(a=>a.name===`baritone-api-fabric-${baritone.tag_name.slice(1)}.jar`);
  const mcpVersion=v==='1.21'?'1.21.1':v;
  const mcpFile=mcp.assets.find(a=>a.name===`mcpfabric-0.8.0+${mcpVersion}.jar`);
  for(const asset of [mcpFile,baritoneFile])if(!asset?.digest?.startsWith('sha256:')){
    if(!asset)throw Error('Missing artifact '+v);
    const response=await fetch(asset.browser_download_url,{signal:AbortSignal.timeout(120000)});if(!response.ok)throw Error('Artifact download '+response.status);
    asset.digest='sha256:'+createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex');
  }
  const artifact=(x)=>({url:x.browser_download_url,filename:x.name,algorithm:'sha256',hash:x.digest.slice(7)});
  versions.versions.push({id:v,java:21,dataPackVersion:meta.pack_version?.data??null,metadata:{url:release.url,sha1:release.sha1},client:meta.downloads.client,server:meta.downloads.server,
    fabricApi:{url:apiFile.url,filename:apiFile.filename,algorithm:'sha512',hash:apiFile.hashes.sha512},mcp:artifact(mcpFile),baritone:artifact(baritoneFile),validation:{compiled:false,smoke:false}});
  fs.mkdirSync(path.join(root,'outputs/version-metadata'),{recursive:true});fs.writeFileSync(path.join(root,'outputs/version-metadata',v+'.json'),JSON.stringify(meta));
  console.log(v,apiFile.filename,baritone.tag_name);
}
fs.writeFileSync(path.join(root,'versions.json'),JSON.stringify(versions,null,2)+'\n');
