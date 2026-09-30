"""Generate guarded MySQL operations from credential-free live snapshots.
Usage: python3 generate_migration.py audit.json detail.json
Review generated SQL before execution. No credentials are read or emitted.
"""
import json
import pathlib
import sys

root = pathlib.Path(__file__).parent
snapshot = json.loads(pathlib.Path(sys.argv[1]).read_text())
detail = json.loads(pathlib.Path(sys.argv[2]).read_text())
prices = json.loads((root / 'prices.json').read_text())
options = {r['key']:json.loads(r['value']) for r in snapshot if r['kind']=='option'}
channels = {r['id']:r for r in snapshot if r['kind']=='channel'}
metadata = {r['name']:r for r in detail if r['kind']=='metadata'}
location = next(r['value'] for r in detail if r['kind']=='gcp_location')
def sql(s):
    return "CONVERT(0x"+str(s).encode().hex()+" USING utf8mb4)"
def js(o):
    return "CAST("+sql(json.dumps(o,ensure_ascii=False))+" AS JSON)"
def path(model):
    return '$.'+json.dumps(model)
apply=['-- MySQL production configuration; execute without --force.', 'CREATE TEMPORARY TABLE rollout_assert (ok INT NOT NULL CHECK(ok=1));','START TRANSACTION;', 'SELECT id FROM channels WHERE id IN (2,3) FOR UPDATE;',"SELECT `key` FROM options WHERE `key` IN ('ModelRatio','CompletionRatio','CacheRatio','CreateCacheRatio','GroupModelRatio','billing_setting.billing_expr','billing_setting.billing_mode') FOR UPDATE;"]
rollback=list(apply)
changes={}
for r in prices:
    m=r['model'];i=r['input'];o=r['output'];cr=r['cache_read'];cw=r.get('cache_write',0)
    values={'ModelRatio':i/2,'CompletionRatio':o/i,'CacheRatio':cr/i}
    if r['threshold']:
        values['CreateCacheRatio']=cw/i
        values['billing_setting.billing_mode']='tiered_expr'
        values['billing_setting.billing_expr']=f'len <= 272000 ? tier("standard", p * {i:g} + cr * {cr:g} + cc * {cw:g} + c * {o:g}) : tier("long_context", p * {i*2:g} + cr * {cr*2:g} + cc * {cw*2:g} + c * {o*1.5:g})'
    for key,v in values.items():changes[(key,path(m))]=(options[key].get(m),v)
    if r['new']:
        reference='gpt-6-astra' if r['channel']==3 else 'gemini-3.7-flash'
        for group,models in options['GroupModelRatio'].items():
            if reference in models:changes[('GroupModelRatio',path(group)+'.'+json.dumps(m))]=(models.get(m),models[reference])
for (key,p),(old,new) in changes.items():
    for lines,before,after in [(apply,old,new),(rollback,new,old)]:
        cond=f'JSON_EXTRACT(value,{sql(p)}) IS NULL' if before is None else f'JSON_EXTRACT(value,{sql(p)})={js(before)}'
        lines.append(f'INSERT INTO rollout_assert SELECT COUNT(*) FROM options WHERE `key`={sql(key)} AND {cond};')
        value=f'JSON_REMOVE(value,{sql(p)})' if after is None else f'JSON_SET(value,{sql(p)},{js(after)})'
        lines.append(f'UPDATE options SET value={value} WHERE `key`={sql(key)};')
for cid,ch in channels.items():
    added=[r['model'] for r in prices if r['new'] and r['channel']==cid]
    if not added:continue
    before=ch['models'];after=before+','+','.join(added)
    for lines,b,a in [(apply,before,after),(rollback,after,before)]:
        lines.append(f'INSERT INTO rollout_assert SELECT COUNT(*) FROM channels WHERE id={cid} AND status=1 AND models={sql(b)};')
        lines.append(f'UPDATE channels SET models={sql(a)} WHERE id={cid};')
    for m in added:
        ref='gpt-6-astra' if cid==3 else 'gemini-3.7-flash'
        apply.append(f'INSERT INTO rollout_assert SELECT (COUNT(*)=0) FROM abilities WHERE model={sql(m)};')
        apply.append(f'INSERT INTO abilities (`group`,model,channel_id,enabled,priority,weight,tag) SELECT `group`,{sql(m)},channel_id,enabled,priority,weight,tag FROM abilities WHERE channel_id={cid} AND model={sql(ref)};')
        apply.append(f'INSERT INTO rollout_assert SELECT (COUNT(*)=4) FROM abilities WHERE channel_id={cid} AND model={sql(m)} AND enabled=1;')
        rollback.append(f'DELETE FROM abilities WHERE channel_id={cid} AND model={sql(m)};')
apply.append('UPDATE channels SET other=JSON_SET(other,\'$."gemini-3.8-flash"\',\'global\') WHERE id=2;')
rollback.append('UPDATE channels SET other=JSON_REMOVE(other,\'$."gemini-3.8-flash"\') WHERE id=2;')
for r in prices:
    m=r['model']
    if r['new']:
        endpoints={'openai':{'path':'/v1/chat/completions','method':'POST'}}
        if r['channel']==3:endpoints['openai-response']={'path':'/v1/responses','method':'POST'}
        description='原生模型；支持流式与工具调用。' if r['channel']==3 else 'Google Gemini 3.8 Flash；多模态输入、文本输出，非图片生成模型。'
        apply.append(f'INSERT INTO rollout_assert SELECT (COUNT(*)=0) FROM models WHERE model_name={sql(m)} AND deleted_at IS NULL;')
        apply.append(f'INSERT INTO models (model_name,description,icon,tags,vendor_id,endpoints,official_input_price,official_output_price,status,sync_official,created_time,updated_time,name_rule) VALUES ({sql(m)},{sql(description)},{sql("OpenAI" if r["channel"]==3 else "Gemini")},{sql("文本,工具调用")},{3 if r["channel"]==3 else 2},{sql(json.dumps(endpoints))},{r["input"]},{r["output"]},1,0,UNIX_TIMESTAMP(),UNIX_TIMESTAMP(),0);')
        rollback.append(f'DELETE FROM models WHERE model_name={sql(m)} AND deleted_at IS NULL;')
    elif m in metadata:
        old=metadata[m]
        for lines,b,a in [(apply,old, r),(rollback,r,old)]:
            lines.append(f'INSERT INTO rollout_assert SELECT COUNT(*) FROM models WHERE model_name={sql(m)} AND deleted_at IS NULL AND official_input_price={b["input"]} AND official_output_price={b["output"]};')
            lines.append(f'UPDATE models SET official_input_price={a["input"]},official_output_price={a["output"]},updated_time=UNIX_TIMESTAMP() WHERE model_name={sql(m)} AND deleted_at IS NULL;')
for n,lines in [('apply.sql',apply),('rollback.sql',rollback)]:
    lines.extend(['COMMIT;',f"SELECT '{n} committed';"])
    (root/n).write_text('\n'.join(lines)+'\n')
print('Generated guarded apply/rollback:',len(changes),'option paths')
