#!/usr/bin/env python3
"""Fail-closed checks on the local research snapshot; writes a coverage summary."""
import collections,csv,datetime as dt,hashlib,json,math
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]/'data/research_3y'
SYMS=['AAPL','MSFT','AMZN','NVDA','AMGN','COST','GOOGL','META','QCOM','TSLA']
expected={'2022':251,'2023':250,'2024':252,'2025':250}; report={s:{'bars':{},'actions':{},'news':{},'filings':{},'fundamentals':{}} for s in SYMS}; errors=[]; days={s:set() for s in SYMS}
with (ROOT/'normalized/daily_ohlcv.csv').open(newline='') as f:
 for r in csv.DictReader(f):
  s=r['symbol'];d=r['date'];y=d[:4]
  if s not in report:raise ValueError('unexpected symbol')
  if d in days[s]:errors.append(f'duplicate bar {s} {d}')
  days[s].add(d);report[s]['bars'][y]=report[s]['bars'].get(y,0)+1
  try:
   o,h,l,c,v=map(float,[r['open'],r['high'],r['low'],r['close'],r['volume']]);assert all(map(math.isfinite,[o,h,l,c,v]));assert 0<l<=min(o,c)<=max(o,c)<=h and v>=0
   if not r['adjusted_close'] or not math.isfinite(float(r['adjusted_close'])):errors.append(f'adjclose missing {s} {d}')
  except (ValueError,AssertionError):errors.append(f'invalid bar {s} {d}')
for s in SYMS:
 for y,n in expected.items():
  if report[s]['bars'].get(y)!=n:errors.append(f'{s} {y} expected {n} sessions got {report[s]["bars"].get(y)}')
 if days[s]!=days[SYMS[0]]:errors.append(f'{s} inconsistent session dates')
with (ROOT/'normalized/corporate_actions.csv').open(newline='') as f:
 for r in csv.DictReader(f):
  s=r['symbol'];key=r['date'][:4]+':'+r['type'];report[s]['actions'][key]=report[s]['actions'].get(key,0)+1
with (ROOT/'normalized/fundamentals.csv').open(newline='') as f:
 for r in csv.DictReader(f):
  s=r['symbol'];y=r['filed'][:4];report[s]['fundamentals'][y]=report[s]['fundamentals'].get(y,0)+1
  if not r['acceptance_at'] or not r['available_at']:errors.append(f'missing acceptance {s} {r["accession"]}')
  elif dt.datetime.fromisoformat(r['available_at'].replace('Z','+00:00')) != dt.datetime.fromisoformat(r['acceptance_at'].replace('Z','+00:00'))+dt.timedelta(hours=1):errors.append(f'incorrect SEC delay {s} {r["accession"]}')
ids=set();kinds=collections.Counter();total=0
with (ROOT/'evidence.jsonl').open() as f:
 for line in f:
  r=json.loads(line);total+=1;k=r['kind'];kinds[k]+=1;s=r['symbols'][0]
  if r['id'] in ids:errors.append('duplicate evidence id '+r['id'])
  ids.add(r['id'])
  if s not in SYMS:errors.append('unexpected symbol '+s);continue
  if not r.get('available_at'):errors.append('missing availability '+r['id']);continue
  try:dt.datetime.fromisoformat(r['available_at'].replace('Z','+00:00'))
  except ValueError:errors.append('invalid availability '+r['id'])
  if k=='news':
   d=dt.date.fromisoformat(r['provenance']['reported_publication_date']); y=str(d.year)
   report[s]['news'][y]=report[s]['news'].get(y,0)+1
   expected_bound=dt.datetime.combine(d+dt.timedelta(days=2),dt.time(),tzinfo=dt.timezone.utc)
   if dt.datetime.fromisoformat(r['available_at'].replace('Z','+00:00'))!=expected_bound or r['published_at'] is not None:errors.append('incorrect date-only policy '+r['id'])
  elif k=='filing':
   y=r['content']['filing_date'][:4];report[s]['filings'][y]=report[s]['filings'].get(y,0)+1
for s in SYMS:
 for y in ('2023','2024','2025'):
  if not report[s]['news'].get(y) or not report[s]['filings'].get(y) or not report[s]['fundamentals'].get(y):errors.append(f'missing year coverage {s} {y}')
result={'errors':errors,'evidence_counts':dict(kinds),'coverage':report};(ROOT/'validation.json').write_text(json.dumps(result,indent=2)+'\n')
print('evidence',dict(kinds),'errors',len(errors));print('\n'.join(errors[:20]))
if errors:raise SystemExit(1)
