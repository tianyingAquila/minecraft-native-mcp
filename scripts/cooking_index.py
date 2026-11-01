"""Build a small vanilla cooking index from the verified official client; developer/CI only."""
import hashlib
import json
from pathlib import Path
import zipfile


def write_cooking_index(client, version, output):
    with zipfile.ZipFile(client) as archive:
        names = set(archive.namelist())
        def tag_items(identifier, visiting=frozenset()):
            if identifier in visiting:
                raise ValueError('Cyclic item tag: '+identifier)
            namespace, name = identifier.split(':', 1)
            candidates = [f'data/{namespace}/tags/{kind}/{name}.json' for kind in ['item', 'items']]
            source = next((p for p in candidates if p in names), None)
            if not source:
                return []
            result = []
            for value in json.loads(archive.read(source)).get('values', []):
                value = value.get('id') if isinstance(value, dict) else value
                if value.startswith('#'):
                    result.extend(tag_items(value[1:], visiting | {identifier}))
                else:
                    result.append(value)
            return result

        def ingredient_items(value):
            if isinstance(value, list):
                return sorted(set(item for v in value for item in ingredient_items(v)))
            if isinstance(value, dict):
                return tag_items(value['tag']) if 'tag' in value else [value['item']]
            return tag_items(value[1:]) if value.startswith('#') else [value]

        recipes = []
        for name in sorted(names):
            if not name.startswith(('data/minecraft/recipe/', 'data/minecraft/recipes/')) or not name.endswith('.json'):
                continue
            recipe = json.loads(archive.read(name))
            if recipe.get('type') not in ['minecraft:smelting', 'minecraft:blasting', 'minecraft:smoking']:
                continue
            result = recipe['result']
            if isinstance(result, str):
                result = {'id': result}
            recipes.append({'type': recipe['type'], 'inputs': sorted(set(ingredient_items(recipe['ingredient']))),
                            'result': {'id': result['id'], 'count': result.get('count', 1)},
                            'cookingTicks': recipe.get('cookingtime', 200)})
    if not recipes or any(not r['inputs'] for r in recipes):
        raise ValueError('Incomplete cooking recipes for '+version)
    output.mkdir(parents=True, exist_ok=True)
    target = output/'cooking.json'
    target.write_text(json.dumps({'version': version, 'source': 'official-client-default-recipes', 'recipes': recipes},
                                 separators=(',', ':'))+'\n', encoding='utf-8')
    return {'path': f'{version}/cooking.json', 'sha256': hashlib.sha256(target.read_bytes()).hexdigest()}


if __name__ == '__main__':
    root = Path(__file__).resolve().parents[1]
    matrix = json.loads((root/'versions.json').read_text(encoding='utf-8'))
    manifest_file = root/'artifacts/helpers/manifest.json'
    manifest = json.loads(manifest_file.read_text(encoding='utf-8'))
    for version in matrix['versions']:
        client = Path.home()/'.gradle/caches/fabric-loom'/version['id']/'minecraft-client.jar'
        if hashlib.sha1(client.read_bytes()).hexdigest() != version['client']['sha1']:
            raise ValueError('Client checksum mismatch: '+version['id'])
        manifest['versions'][version['id']]['cooking'] = write_cooking_index(client, version['id'], root/'artifacts/helpers'/version['id'])
    manifest_file.write_text(json.dumps(manifest, indent=2)+'\n', encoding='utf-8')
    print('Generated cooking recipes for all supported versions')
