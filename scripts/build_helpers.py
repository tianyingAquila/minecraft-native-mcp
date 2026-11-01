"""Developer/CI build, never run on an end user's installation."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import zipfile
import re
from artifact_fetch import fetch_bytes

ROOT=Path(__file__).resolve().parents[1]
MATRIX=json.loads((ROOT/'versions.json').read_text(encoding='utf-8'))

def artifact(spec,target):
    target.parent.mkdir(parents=True,exist_ok=True)
    if target.exists() and hashlib.new(spec['algorithm'],target.read_bytes()).hexdigest()==spec['hash']:return
    body=fetch_bytes(spec['url'],180)
    if hashlib.new(spec['algorithm'],body).hexdigest()!=spec['hash']:raise RuntimeError('Artifact checksum mismatch: '+target.name)
    target.write_bytes(body)

def sources(version):
    minor=int(version.rsplit('.',1)[-1]) if version!='1.21' else 0
    for module in ['client-addon','server-addon']:
        dest=ROOT/module/'build'/version/'generated/java'
        if dest.exists():shutil.rmtree(dest)
        shutil.copytree(ROOT/module/'src/main/java',dest)
        for file in dest.rglob('*.java'):
            text=file.read_text(encoding='utf-8')
            # Explicit version branches stay in one shared source; no runtime reflection.
            if minor<2:
                text=text.replace('level.getMinY()','level.getMinBuildHeight()').replace('level.getMaxY()','level.getMaxBuildHeight()')
                text=text.replace('@Inject(method="hurtServer",','@Inject(method="hurt",').replace('ServerLevel level,DamageSource source','DamageSource source')
                text=text.replace('import net.minecraft.client.renderer.RenderType;','').replace('graphics.blit(RenderType::guiTextured, WHALE, 0, 0, 610f, 0f, 610, 610, -610, 610, 610, 610);','graphics.blit(WHALE, 0, 0, 610, 610, 610f, 0f, -610, 610, 610, 610);')
            if minor>=5:
                text=text.replace('p.getInventory().selected=slot;','p.getInventory().setSelectedSlot(slot);')
                text=text.replace('done.accept(Screenshot.takeScreenshot(ClientMc.mc().getMainRenderTarget()));','Screenshot.takeScreenshot(ClientMc.mc().getMainRenderTarget(),done);')
            if minor>=6:
                text=text.replace('import net.minecraft.client.renderer.RenderType;','import net.minecraft.client.renderer.RenderPipelines;').replace('RenderType::guiTextured','RenderPipelines.GUI_TEXTURED')
                text=text.replace('.pushPose()','.pushMatrix()').replace('.popPose()','.popMatrix()')
                text=re.sub(r'graphics\.pose\(\)\.scale\(([^;\n]*), 1\)',r'graphics.pose().scale(\1)',text)
                text=re.sub(r'graphics\.pose\(\)\.translate\(([^;\n]*), 0\)',r'graphics.pose().translate(\1)',text)
            if minor>=9:text=text.replace('p.getGameProfile().getName()','p.getGameProfile().name()').replace('mc.getWindow().getWindow()','mc.getWindow().handle()')
            if minor>=11:
                text=text.replace('ResourceLocation','Identifier').replace('level.dimension().location()','level.dimension().identifier()')
            text=text.replace('p.server.tickRateManager()','p.level().getServer().tickRateManager()')
            file.write_text(text,encoding='utf-8')

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--versions',nargs='*');args=parser.parse_args()
    selected=args.versions or [x['id'] for x in MATRIX['versions']]
    manifest_file=ROOT/'artifacts/helpers/manifest.json'
    existing=json.loads(manifest_file.read_text(encoding='utf-8')) if manifest_file.exists() else {'schema':1,'versions':{}}
    for version in selected:
        entry=next(x for x in MATRIX['versions'] if x['id']==version)
        deps=ROOT/'outputs/build-deps'/version
        print('BUILD',version,flush=True)
        for key,name in [('mcp','mcpfabric.jar'),('baritone','baritone.jar'),('fabricApi','fabric-api.jar')]:artifact(entry[key],deps/name)
        if version=='1.21':
            # Upstream 1.21.1 code is reused only after real 1.21 validation; retain every other entry.
            original=deps/'mcpfabric.jar';patched=deps/'mcpfabric-compatible.jar'
            with zipfile.ZipFile(original) as src,zipfile.ZipFile(patched,'w',zipfile.ZIP_DEFLATED) as out:
                for info in src.infolist():
                    body=src.read(info.filename)
                    if info.filename=='fabric.mod.json':
                        mod=json.loads(body);mod['depends']['minecraft']='>=1.21 <1.21.2';body=json.dumps(mod).encode()
                    stamp=zipfile.ZipInfo(info.filename,date_time=(2026,1,1,0,0,0));stamp.compress_type=zipfile.ZIP_DEFLATED;out.writestr(stamp,body)
            shutil.copy2(patched,original)
        sources(version)
        gradle=ROOT/'vendor/mcpfabric/gradlew.bat'
        command=[str(gradle),'-p',str(ROOT/'client-addon'),f'-PfishMinecraft={version}','build',':server-addon:build','--no-daemon','--console=plain']
        proxy=os.environ.get('HTTPS_PROXY')
        if proxy:
            from urllib.parse import urlparse
            parsed=urlparse(proxy)
            if parsed.hostname=='127.0.0.1':command.extend([f'-Dhttps.proxyHost=127.0.0.1',f'-Dhttps.proxyPort={parsed.port}',f'-Dhttp.proxyHost=127.0.0.1',f'-Dhttp.proxyPort={parsed.port}'])
        subprocess.run(command,cwd=ROOT,check=True)
        output=ROOT/'artifacts/helpers'/version;output.mkdir(parents=True,exist_ok=True)
        row={}
        for module,kind in [('client-addon','client'),('server-addon','server')]:
            jar=ROOT/module/'build'/version/'libs'/f'fish-{kind}-{version}-0.3.0.jar'
            target=output/f'fish-{kind}.jar';shutil.copy2(jar,target);row[kind]={'path':f'{version}/fish-{kind}.jar','sha256':hashlib.sha256(target.read_bytes()).hexdigest()}
        if version=='1.21':
            target=output/'mcpfabric.jar';shutil.copy2(deps/'mcpfabric.jar',target);row['mcpCompat']={'path':f'{version}/mcpfabric.jar','sha256':hashlib.sha256(target.read_bytes()).hexdigest()}
        row['compiled']=True;existing['versions'][version]=row
        cached_client=Path.home()/'.gradle/caches/fabric-loom'/version/'minecraft-client.jar'
        with zipfile.ZipFile(cached_client) as zip:
            internal=json.loads(zip.read('version.json'));pack=internal['pack_version']
            entry['dataPackVersion']={'major':pack.get('data',pack.get('data_major'))}
            if 'data_minor' in pack:entry['dataPackVersion']['minor']=pack['data_minor']
        entry['validation']['compiled']=True
        row['dataPackVersion']=entry['dataPackVersion']
        (ROOT/'versions.json').write_text(json.dumps(MATRIX,indent=2)+'\n',encoding='utf-8')
        manifest_file.write_text(json.dumps(existing,indent=2)+'\n',encoding='utf-8')
        print('COMPILED',version,flush=True)

if __name__=='__main__':main()
