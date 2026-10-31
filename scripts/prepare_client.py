"""Prepare an official vanilla spectator client. No account credentials are stored."""
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import re
import urllib.request
import uuid
import zipfile

ROOT = Path(__file__).resolve().parents[1]
CLIENT = ROOT / 'runtime' / 'client'
ASSETS = Path(os.environ['APPDATA']) / '.minecraft' / 'assets'

def request_json(url):
    with urllib.request.urlopen(url, timeout=45) as response:
        return json.load(response)

def download(job):
    url, target, expected = job
    target = Path(target)
    if target.exists() and (not expected or hashlib.sha1(target.read_bytes()).hexdigest() == expected):
        return False
    target.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=90) as response:
                payload = response.read()
            if expected and hashlib.sha1(payload).hexdigest() != expected:
                raise RuntimeError('Checksum mismatch: ' + target.name)
            temporary = target.with_suffix(target.suffix + '.fish-download')
            temporary.write_bytes(payload)
            temporary.replace(target)
            return True
        except Exception:
            if attempt == 2:
                raise

def allowed(rules):
    result = not rules
    for rule in rules or []:
        spec = rule.get('os', {})
        match = spec.get('name', 'windows') == 'windows'
        if spec.get('arch'):
            match = match and bool(re.fullmatch(spec['arch'], 'amd64'))
        if rule.get('features'):
            features = {'has_quick_plays_support': True, 'is_quick_play_multiplayer': True}
            match = match and all(features.get(k, False) == v for k, v in rule['features'].items())
        if match:
            result = rule['action'] == 'allow'
    return result

def main():
    CLIENT.mkdir(parents=True, exist_ok=True)
    manifest = request_json('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json')
    version = request_json(next(x['url'] for x in manifest['versions'] if x['id'] == '1.21.4'))
    (CLIENT / 'version.json').write_text(json.dumps(version), encoding='utf-8')
    index = request_json(version['assetIndex']['url'])
    index_path = ASSETS / 'indexes' / (version['assets'] + '.json')
    index_path.parent.mkdir(parents=True, exist_ok=True)
    if not index_path.exists():
        index_path.write_text(json.dumps(index), encoding='utf-8')
    jobs = []
    classpath = []
    native_jars = []
    for library in version['libraries']:
        if not allowed(library.get('rules')):
            continue
        artifact = library.get('downloads', {}).get('artifact')
        if artifact:
            target = CLIENT / 'libraries' / artifact['path']
            jobs.append((artifact['url'], target, artifact['sha1']))
            classpath.append(str(target))
            if 'natives-windows' in artifact['path']:
                native_jars.append(target)
        classifier = library.get('natives', {}).get('windows', '').replace('${arch}', '64')
        native = library.get('downloads', {}).get('classifiers', {}).get(classifier)
        if native:
            target = CLIENT / 'libraries' / native['path']
            jobs.append((native['url'], target, native['sha1']))
            native_jars.append(target)
    client_jar = CLIENT / 'client.jar'
    artifact = version['downloads']['client']
    jobs.append((artifact['url'], client_jar, artifact['sha1']))
    classpath.append(str(client_jar))
    missing_bytes = 0
    for item in index['objects'].values():
        digest = item['hash']
        target = ASSETS / 'objects' / digest[:2] / digest
        if not target.exists():
            jobs.append(('https://resources.download.minecraft.net/' + digest[:2] + '/' + digest, target, digest))
            missing_bytes += item['size']
    print(json.dumps({'downloads': len(jobs), 'missingAssetMB': round(missing_bytes / 1024**2, 1)}), flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(download, jobs))
    natives = CLIENT / 'natives'
    natives.mkdir(exist_ok=True)
    for jar in native_jars:
        with zipfile.ZipFile(jar) as archive:
            for name in archive.namelist():
                if name.endswith('.dll'):
                    (natives / Path(name).name).write_bytes(archive.read(name))
    player_uuid = uuid.UUID(bytes=hashlib.md5(b'OfflinePlayer:FishCamera').digest(), version=3).hex
    replacements = {
        'auth_player_name': 'FishCamera', 'version_name': '1.21.4',
        'game_directory': str(ROOT / 'data' / 'observer'), 'assets_root': str(ASSETS),
        'assets_index_name': version['assets'], 'auth_uuid': player_uuid,
        'auth_access_token': '0', 'clientid': '0', 'auth_xuid': '0',
        'user_type': 'legacy', 'version_type': 'release', 'resolution_width': '1280',
        'resolution_height': '720', 'quickPlayPath': str(CLIENT / 'quickplay.json'),
        'quickPlayMultiplayer': '127.0.0.1:25586', 'natives_directory': str(natives),
        'launcher_name': 'DeepSeekFishLocalObserver', 'launcher_version': '0.1.0',
        'classpath': ';'.join(classpath), 'library_directory': str(CLIENT / 'libraries'),
    }
    def expand(value):
        return re.sub(r'\$\{([^}]+)\}', lambda match: replacements[match[1]], value)
    def arguments(group):
        result = []
        for item in version['arguments'][group]:
            if isinstance(item, str):
                result.append(expand(item))
            elif allowed(item.get('rules')):
                value = item['value']
                result.extend(expand(v) for v in (value if isinstance(value, list) else [value]))
        return result
    args = ['-Xms512M', '-Xmx2G', *arguments('jvm'), version['mainClass'], *arguments('game')]
    (CLIENT / 'launch.json').write_text(json.dumps({'args': args}, ensure_ascii=False), encoding='utf-8')
    observer = ROOT / 'data' / 'observer'
    observer.mkdir(parents=True, exist_ok=True)
    (observer / 'options.txt').write_text('lang:zh_cn\npauseOnLostFocus:false\nrenderDistance:8\nsimulationDistance:6\nmaxFps:60\nenableVsync:true\nfullscreen:false\nsoundCategory_music:0.0\n', encoding='utf-8')
    print(json.dumps({'prepared': True, 'downloaded': sum(results), 'clientVersion': '1.21.4'}), flush=True)

if __name__ == '__main__':
    main()
