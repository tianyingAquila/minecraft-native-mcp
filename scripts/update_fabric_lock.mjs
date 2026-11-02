// Maintainer command: refresh official metadata when the pinned loader/version matrix changes.
import fs from 'node:fs';
import {fetchFabricMetadata,validateFabricMetadata} from '../src/fabric-metadata.mjs';
const matrix=JSON.parse(fs.readFileSync('versions.json','utf8'));
const versions={};
let cursor=0;
await Promise.all(Array.from({length:3},async()=>{
 while(cursor<matrix.versions.length){const {id}=matrix.versions[cursor++];versions[id]=await fetchFabricMetadata(id,matrix.loader,{onProgress:p=>console.log(id+' '+p.message)});validateFabricMetadata(versions[id],id,matrix.loader);console.log(id+' verified');}
}));
fs.writeFileSync('fabric-lock.json',JSON.stringify({schema:1,loader:matrix.loader,source:'https://meta.fabricmc.net',versions:Object.fromEntries(matrix.versions.map(v=>[v.id,versions[v.id]]))},null,2)+'\n');
