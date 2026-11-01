import fs from 'node:fs';
import path from 'node:path';
const base=process.argv[2]||'outputs/ci-helpers',matrix=JSON.parse(fs.readFileSync('versions.json'));
const result={schema:1,versions:{}};
for(const version of matrix.versions){const dir=path.join(base,'helpers-'+version.id),manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'))),row=manifest.versions[version.id];if(!row?.compiled)throw Error('Missing compiled helpers '+version.id);fs.cpSync(path.join(dir,version.id),path.join('artifacts/helpers',version.id),{recursive:true});result.versions[version.id]=row;version.dataPackVersion=row.dataPackVersion;version.validation.compiled=true;}
fs.writeFileSync('artifacts/helpers/manifest.json',JSON.stringify(result,null,2)+'\n');fs.writeFileSync('versions.json',JSON.stringify(matrix,null,2)+'\n');
