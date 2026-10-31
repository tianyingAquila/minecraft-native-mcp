"""Install an isolated, pinned Fabric player client using already verified vanilla assets."""
import hashlib
import json
import os
from pathlib import Path
import re
import urllib.request
import uuid
from prepare_client import download, request_json

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / 'runtime'
CLIENT = RUNTIME / 'native-client'
GAME = ROOT / 'data' / 'native-client'
LOADER = '0.20.1'
MCP_URL = 'https://github.com/denfry/mcpfabric/releases/download/v0.8.0/mcpfabric-0.8.0%2B1.21.4.jar'
BARITONE_URL = 'https://github.com/cabaletta/baritone/releases/download/v1.13.1/baritone-api-fabric-1.13.1.jar'
MODS = [
    (MCP_URL, 'mcpfabric-0.8.0+1.21.4.jar', 'sha256', 'c93fb180c79d99b395a6ad41c9688717d5ca9fe28749541ea71d5b15bb5ac3b7'),
    (BARITONE_URL, 'baritone-api-fabric-1.13.1.jar', 'sha256', 'bfb79c3cdb8fe1f7697999b1f9c7f08ea29775f3b69d48ad90c387690ee67b05'),
    ('https://cdn.modrinth.com/data/P7dR8mSH/versions/p96k10UR/fabric-api-0.119.4%2B1.21.4.jar', 'fabric-api-0.119.4+1.21.4.jar', 'sha1', '1c7871b6af04edc8b8f0dbad12606d67f6118a11'),
]

def fetch_verified(url, target, algorithm, expected):
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and hashlib.new(algorithm, target.read_bytes()).hexdigest() == expected:
        return
    with urllib.request.urlopen(url, timeout=90) as r:
        payload = r.read()
    if hashlib.new(algorithm, payload).hexdigest() != expected:
        raise RuntimeError('Checksum mismatch: ' + target.name)
    temporary = target.with_suffix(target.suffix + '.fish-download')
    temporary.write_bytes(payload)
    temporary.replace(target)

def main():
    CLIENT.mkdir(parents=True, exist_ok=True)
    GAME.mkdir(parents=True, exist_ok=True)
    original = json.loads((RUNTIME / 'client' / 'launch.json').read_text(encoding='utf-8'))
    profile = request_json(f'https://meta.fabricmc.net/v2/versions/loader/1.21.4/{LOADER}/profile/json')
    libraries = []
    for lib in profile['libraries']:
        group, artifact, version = lib['name'].split(':')
        rel = f'{group.replace(".", "/")}/{artifact}/{version}/{artifact}-{version}.jar'
        target = CLIENT / 'libraries' / rel
        url = lib['url'].rstrip('/') + '/' + rel
        with urllib.request.urlopen(url + '.sha1', timeout=45) as r:
            digest = r.read().decode().strip().split()[0]
        download((url, target, digest))
        libraries.append(str(target))
    for url, filename, algorithm, digest in MODS:
        fetch_verified(url, GAME / 'mods' / filename, algorithm, digest)
    args = list(original['args'])
    cp_index = args.index('-cp') + 1
    # Fabric supplies a newer ASM family; retaining Mojang's old ASM creates duplicate classes.
    vanilla_libraries = [p for p in args[cp_index].split(';') if '/org/ow2/asm/' not in p.replace('\\', '/')]
    args[cp_index] = ';'.join(libraries + vanilla_libraries)
    args[args.index('net.minecraft.client.main.Main')] = profile['mainClass']
    changes = {'--username': 'DeepSeekFish', '--uuid': uuid.UUID(bytes=hashlib.md5(b'OfflinePlayer:DeepSeekFish').digest(), version=3).hex, '--gameDir': str(GAME), '--version': '1.21.4-fabric-fish'}
    for key, value in changes.items():
        args[args.index(key)+1] = value
    args += ['--width', '1280', '--height', '720']
    args.insert(2, '-Dfabric.gameVersion=1.21.4')
    (CLIENT / 'launch.json').write_text(json.dumps({'args': args}, ensure_ascii=False), encoding='utf-8')
    (CLIENT / 'fabric-profile.json').write_text(json.dumps(profile), encoding='utf-8')
    server_profile=request_json(f'https://meta.fabricmc.net/v2/versions/loader/1.21.4/{LOADER}/server/json')
    server_dir=RUNTIME / 'native-server'
    server_dir.mkdir(exist_ok=True)
    server_args=['-Xms512M','-Xmx2G','-Dfile.encoding=UTF-8','-Dfabric.gameVersion=1.21.4','-cp',';'.join(libraries+[str(RUNTIME / 'server-1.21.4.jar')]),server_profile['mainClass'],'nogui']
    (server_dir / 'launch.json').write_text(json.dumps({'args':server_args}),encoding='utf-8')
    config_dir = GAME / 'config'
    config_dir.mkdir(exist_ok=True)
    config_file = config_dir / 'mcpfabric.config.json'
    config = json.loads(config_file.read_text()) if config_file.exists() else {}
    config.update({'host':'127.0.0.1','port':25587,'requireAuth':True,'enableWorldWrite':False,'enableCommands':False,'enablePlayerControl':True,'enableVision':True,'enableUiControl':False,'enableSupervisedControl':False})
    config.setdefault('token', uuid.uuid4().hex)
    config.setdefault('worldIdKey', uuid.uuid4().hex)
    config_file.write_text(json.dumps(config), encoding='utf-8')
    options = GAME / 'options.txt'
    if not options.exists():
        options.write_text('lang:zh_cn\npauseOnLostFocus:false\nrenderDistance:8\nsimulationDistance:6\nmaxFps:60\nenableVsync:true\nfullscreen:false\nsoundCategory_music:0.0\ngamma:1.0\ntutorialStep:none\njoinedFirstServer:true\n', encoding='utf-8')
    print(json.dumps({'prepared':True,'minecraft':'1.21.4','loader':LOADER,'mods':[x[1] for x in MODS]}))

if __name__ == '__main__':
    main()
