"""Generate guarded MySQL release SQL from a credential-free channel/option audit.
Usage: python3 generate_migration.py /private/path/audit.json
The SQL targets the existing production MySQL deployment, not application migrations.
"""
import json
from pathlib import Path
import sys

root = Path(__file__).parent
rows = json.loads(Path(sys.argv[1]).read_text())
prices = json.loads((root / 'prices.json').read_text())
model = prices['model']
reference = 'gemini-3.1-flash-image'
options = {r['key']: json.loads(r['value']) for r in rows if r['kind'] == 'option'}
channel = next(r for r in rows if r['kind'] == 'channel' and r['id'] == 2)
abilities = [r for r in rows if r['kind'] == 'ability']
assert channel['type'] == 41 and channel['status'] == 1
assert model not in channel['models'].split(',')
assert model not in json.loads(channel['other'])
assert len(abilities) == 4 and all(r['enabled'] == 1 for r in abilities)
assert {r['group'] for r in abilities} == set(prices['groups'])
assert all(options['GroupModelRatio'][g][reference] == ratio for g, ratio in prices['groups'].items())
assert model not in options['ModelPrice']
assert not any(r['kind'] == 'model' and r['model_name'] == model for r in rows)


def sql(value):
    return 'CONVERT(0x' + str(value).encode().hex() + ' USING utf8mb4)'


def js(value):
    return 'CAST(' + sql(json.dumps(value, ensure_ascii=False)) + ' AS JSON)'


def path(*parts):
    return '$.' + '.'.join(json.dumps(p) for p in parts)


header = [
    '-- Production MySQL only. Run batch WITHOUT --force; disconnect on any error.',
    'SET NAMES utf8mb4;',
    'CREATE TEMPORARY TABLE rollout_assert (ok INT NOT NULL CHECK(ok=1));',
    'START TRANSACTION;',
    'SELECT id FROM channels WHERE id=2 FOR UPDATE;',
    f'SELECT id FROM models WHERE model_name={sql(model)} FOR UPDATE;',
    f'SELECT channel_id FROM abilities WHERE model IN ({sql(model)},{sql(reference)}) FOR UPDATE;',
    "SELECT `key` FROM options WHERE `key` IN ('ModelRatio','CompletionRatio','CacheRatio','GroupModelRatio','ModelPrice','billing_setting.billing_mode','billing_setting.billing_expr','gemini.supported_imagine_models') FOR UPDATE;",
]
apply = list(header)
rollback = list(header)
changes = {
    ('ModelRatio', path(model)): prices['input'] / 2,
    ('CompletionRatio', path(model)): prices['text_and_thinking_output'] / prices['input'],
    ('CacheRatio', path(model)): prices['cached_input'] / prices['input'],
    ('billing_setting.billing_mode', path(model)): 'tiered_expr',
    ('billing_setting.billing_expr', path(model)): prices['expression'],
}
for group, ratio in prices['groups'].items():
    changes[('GroupModelRatio', path(group, model))] = ratio
for (key, p), value in changes.items():
    original = options[key].get(model) if key != 'GroupModelRatio' else options[key][json.loads(p.split('.')[1])].get(model)
    assert original is None, (key, p)
    apply += [f'INSERT INTO rollout_assert SELECT COUNT(*) FROM options WHERE `key`={sql(key)} AND JSON_EXTRACT(value,{sql(p)}) IS NULL;',
              f'UPDATE options SET value=JSON_SET(value,{sql(p)},{js(value)}) WHERE `key`={sql(key)};']
    rollback += [f'INSERT INTO rollout_assert SELECT COUNT(*) FROM options WHERE `key`={sql(key)} AND JSON_EXTRACT(value,{sql(p)})={js(value)};',
                 f'UPDATE options SET value=JSON_REMOVE(value,{sql(p)}) WHERE `key`={sql(key)};']
# Keep flat per-request pricing absent. An explicit imagine override must be
# reviewed before rollout; the new code's default list covers absent overrides.
for lines in (apply, rollback):
    lines.append(f"INSERT INTO rollout_assert SELECT COUNT(*) FROM options WHERE `key`='ModelPrice' AND JSON_EXTRACT(value,{sql(path(model))}) IS NULL;")
assert 'gemini.supported_imagine_models' not in options, 'Review explicit imagine-model override before generating'
apply.append("INSERT INTO rollout_assert SELECT (COUNT(*)=0) FROM options WHERE `key`='gemini.supported_imagine_models';")
for group, ratio in prices['groups'].items():
    apply.append(f"INSERT INTO rollout_assert SELECT COUNT(*) FROM options WHERE `key`='GroupModelRatio' AND JSON_EXTRACT(value,{sql(path(group,reference))})={js(ratio)};")

before = channel['models']
after = before + ',' + model
for lines, previous, following, old_region, new_region in ((apply, before, after, None, 'global'), (rollback, after, before, 'global', None)):
    check = f'JSON_EXTRACT(other,{sql(path(model))}) IS NULL' if old_region is None else f'JSON_EXTRACT(other,{sql(path(model))})={js(old_region)}'
    lines.append(f'INSERT INTO rollout_assert SELECT COUNT(*) FROM channels WHERE id=2 AND status=1 AND type=41 AND models={sql(previous)} AND {check};')
    region = f'JSON_SET(other,{sql(path(model))},{js(new_region)})' if new_region else f'JSON_REMOVE(other,{sql(path(model))})'
    lines.append(f'UPDATE channels SET models={sql(following)},other={region} WHERE id=2;')

apply.append(f'INSERT INTO rollout_assert SELECT (COUNT(*)=0) FROM abilities WHERE model={sql(model)};')
for ability in abilities:
    group = ability['group']
    condition = f'channel_id=2 AND `group`={sql(group)} AND model={sql(reference)} AND enabled=1 AND priority={ability["priority"]} AND weight={ability["weight"]}'
    apply.append(f'INSERT INTO rollout_assert SELECT COUNT(*) FROM abilities WHERE {condition};')
apply.append(f'INSERT INTO abilities (`group`,model,channel_id,enabled,priority,weight,tag) SELECT `group`,{sql(model)},channel_id,enabled,priority,weight,tag FROM abilities WHERE channel_id=2 AND model={sql(reference)};')
apply.append(f'INSERT INTO rollout_assert SELECT (COUNT(*)=4) FROM abilities WHERE channel_id=2 AND model={sql(model)} AND enabled=1;')
rollback.append(f'INSERT INTO rollout_assert SELECT (COUNT(*)=4) FROM abilities WHERE channel_id=2 AND model={sql(model)} AND enabled=1 AND priority=0 AND weight=0 AND tag IS NULL;')
rollback.append(f'INSERT INTO rollout_assert SELECT (COUNT(*)=4) FROM abilities WHERE channel_id=2 AND model={sql(model)};')
for group in prices['groups']:
    rollback.append(f'INSERT INTO rollout_assert SELECT COUNT(*) FROM abilities WHERE channel_id=2 AND model={sql(model)} AND `group`={sql(group)};')
rollback.append(f'DELETE FROM abilities WHERE channel_id=2 AND model={sql(model)};')

description = f"Google Nano Banana 2.1；图片生成与编辑，1K/2K/4K，单次一张。按实际 Token 计费：输入 ${prices['input']:.2f}、缓存 ${prices['cached_input']:.2f}、文本/思考输出 ${prices['text_and_thinking_output']:.2f}、图片输出 ${prices['image_output']:.2f} / 百万 Token，另乘分组折扣。支持 Chat 和 Gemini 原生接口。"
apply.append(f'INSERT INTO rollout_assert SELECT (COUNT(*)=0) FROM models WHERE model_name={sql(model)} AND deleted_at IS NULL;')
apply.append(f"INSERT INTO models (model_name,description,icon,tags,vendor_id,endpoints,official_input_price,official_output_price,status,sync_official,created_time,updated_time,name_rule) VALUES ({sql(model)},{sql(description)},'Gemini.Color',{sql('图片生成,图片编辑,按Token计费')},2,{sql(json.dumps(['gemini','openai']))},{prices['input']},{prices['text_and_thinking_output']},1,0,UNIX_TIMESTAMP(),UNIX_TIMESTAMP(),0);")
rollback.append(f'INSERT INTO rollout_assert SELECT COUNT(*) FROM models WHERE model_name={sql(model)} AND deleted_at IS NULL AND official_input_price={prices["input"]} AND official_output_price={prices["text_and_thinking_output"]} AND description={sql(description)} AND icon={sql("Gemini.Color")} AND tags={sql("图片生成,图片编辑,按Token计费")} AND vendor_id=2 AND endpoints={sql(json.dumps(["gemini","openai"]))} AND status=1 AND sync_official=0 AND name_rule=0 AND updated_time=created_time;')
rollback.append(f'DELETE FROM models WHERE model_name={sql(model)} AND deleted_at IS NULL;')
for name, lines in [('apply.sql', apply), ('rollback.sql', rollback)]:
    lines += ['COMMIT;', f"SELECT '{name} committed';"]
    (root / name).write_text('\n'.join(lines) + '\n')
print('Generated guarded apply / rollback for', model)
