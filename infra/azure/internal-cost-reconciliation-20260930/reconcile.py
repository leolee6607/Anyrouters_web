import json,re,base64,collections,csv,pathlib,argparse
from decimal import Decimal as D, ROUND_HALF_UP
parser=argparse.ArgumentParser(description='Reconcile the five historical GPT model families; read-only inputs.')
parser.add_argument('--site',required=True,type=pathlib.Path)
parser.add_argument('--bill',required=True,type=pathlib.Path)
parser.add_argument('--out',required=True,type=pathlib.Path)
args=parser.parse_args();p=args.out;p.mkdir(parents=True,exist_ok=True)
rows=json.loads(args.site.read_text()); bill=json.loads(args.bill.read_text(),parse_float=D)['properties']['rows']
name={'5.6 sol':'gpt-5.6-sol','5.6 luna':'gpt-5.6-luna','5.6 terra':'gpt-5.6-terra','6-astra':'gpt-6-astra','5.5':'gpt-5.5'}
meter=collections.defaultdict(lambda: {'tokens':0,'usd':D(0)})
for cost,q,date,m,rid,currency in bill:
 low=m.lower();model=next((v for k,v in name.items() if low.startswith(k+' ')),None)
 if model is None:continue
 tier='long_context' if 'longco' in low else 'standard'
 cat='cc' if 'cd wr' in low else 'cr' if 'cd inp' in low else 'c' if 'opt' in low else 'p' if 'inp' in low else None
 assert cat,m
 t=D(str(q))*1000000;assert t==t.to_integral(),(m,t)
 r=meter[model,tier,cat];r['tokens']+=int(t);r['usd']+=D(str(cost))
for k,r in meter.items():r['price']=r['usd']*1000000/r['tokens']
st=collections.defaultdict(lambda:collections.defaultdict(D));quant=collections.Counter();mismatches=[];tiererrors=[];groups=collections.defaultdict(collections.Counter)
for r in rows:
 model={'codex-auto-review':'gpt-5.6-luna'}.get(r['model'],r['model']);f=r['fields']
 if model not in name.values():continue
 expression=base64.b64decode(f['expr_b64']).decode();assert expression.startswith('len <= 272000 ? '),expression;tiers={k:v for k,v in re.findall(r'tier\("([^\"]+)",\s*([^)]*)\)',expression)}
 tier='standard' if r['input']<=272000 else 'long_context'
 if tier!=f['matched_tier']:tiererrors.append(r['id'])
 terms={}
 for term in tiers[tier].split('+'):
  match=re.fullmatch(r'\s*(p|cr|cc|c)\s*\*\s*([0-9.]+)\s*',term);assert match,term
  terms[match[1]]=D(match[2])
 cr=f['cache_tokens'] or 0;cc=f['cache_creation_tokens'] or 0
 amounts={'p':r['input']-cr-(cc if 'cc' in terms else 0),'cr':cr,'cc':cc,'c':r['output']}
 assert amounts['p']>=0,r['id']
 price_total=sum(D(amounts[k])*rate for k,rate in terms.items())/1000000
 discount=D(str(f['group_ratio']));expected=int((price_total*500000*discount).quantize(D(1),rounding=ROUND_HALF_UP))
 if r['quota']!=expected:mismatches.append({'id':r['id'],'model':model,'actual':r['quota'],'expected':expected,'difference':r['quota']-expected})
 a=st[model];a['n']+=1;a['old_gross']+=price_total;a['debit']+=D(r['quota'])/500000;a['rounding']+=D(r['quota'])/500000-price_total*discount;groups[model][str(discount)]+=1
 for cat,t in amounts.items():
  if cat not in terms:continue
  k=(model,tier,cat);quant[k]+=t
  if t:a['same_usage_at_bill_prices']+=D(t)*meter[k]['price']/1000000
bridges=[];cats=[]
for model,a in st.items():
 a['bill']=sum(r['usd'] for k,r in meter.items() if k[0]==model)
 a['discount_effect']=a['old_gross']-a['debit'];a['old_price_difference']=a['old_gross']-a['same_usage_at_bill_prices'];a['usage_residual']=a['bill']-a['same_usage_at_bill_prices'];a['direct_difference']=a['bill']-a['debit']
 assert a['direct_difference']==a['discount_effect']-a['old_price_difference']+a['usage_residual']
 b=dict(model=model,**{k:float(v) for k,v in a.items()},discounts=dict(groups[model]));bridges.append(b);print(json.dumps(b))
for k,r in sorted(meter.items()):
 x={'model':k[0],'tier':k[1],'category':k[2],'site_tokens':quant[k],'bill_tokens':r['tokens'],'extra_tokens':r['tokens']-quant[k],'price':float(r['price']),'extra_usd':float(D(r['tokens']-quant[k])*r['price']/1000000)};cats.append(x)
print('quota mismatches',len(mismatches), 'sumdiff',sum(x['difference'] for x in mismatches),'tiererrors',tiererrors)
print(mismatches[:10])
for x in cats:
 if x['model'] in ['gpt-5.6-sol','gpt-6-astra']:print(x)
(p/'cost-bridge.json').write_text(json.dumps(bridges,indent=2));(p/'quota-recalculation.json').write_text(json.dumps({'checked':sum(int(a['n']) for a in st.values()),'exact':sum(int(a['n']) for a in st.values())-len(mismatches),'mismatches':mismatches,'tier_errors':tiererrors},indent=2))
with (p/'meter-category-comparison.csv').open('w') as f:w=csv.DictWriter(f,fieldnames=cats[0]);w.writeheader();w.writerows(cats)
