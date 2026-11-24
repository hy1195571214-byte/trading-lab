#!/usr/bin/env python3
"""Download public data snapshots, then normalize with explicit timing/provenance.
No paid service or model calls. Re-running overwrites this research snapshot; archive it
before refreshing if it is already referenced by an experiment.
"""
import csv, datetime as dt, hashlib, json, math, os, statistics, time
from pathlib import Path
from urllib.parse import urlencode
import requests
from zoneinfo import ZoneInfo

ROOT=Path(__file__).resolve().parents[1]/'data/research_3y'
SYMS=['AAPL','MSFT','AMZN','NVDA','AMGN','COST','GOOGL','META','QCOM','TSLA']
START='2022-01-01'; END='2025-12-31'
HEAD={'User-Agent':'TradingLab/1.0 educational-research data collector','Accept-Encoding':'gzip, deflate','Host':'data.sec.gov'}
S=requests.Session()

def save_json(path,obj):
 path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(obj,ensure_ascii=False,separators=(',',':'))+'\n')
def get(url,headers=None):
 for i in range(4):
  try:
   r=S.get(url,headers=headers,timeout=80);r.raise_for_status();return r
  except requests.RequestException:
   if i==3:raise
   time.sleep(2**i)
def download():
 tickerurl='https://www.sec.gov/files/company_tickers.json'
 response=get(tickerurl,{'User-Agent':'TradingLab/1.0 educational-research data collector'})
 (ROOT/'raw/sec/company_tickers.json').write_bytes(response.content)
 tickers={x['ticker']:x for x in response.json().values()}
 for symbol in SYMS:
  print('Downloading',symbol,flush=True)
  url=f'https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?'+urlencode({'period1':1640995200,'period2':1767225600,'interval':'1d','events':'div,splits','includeAdjustedClose':'true'})
  p=ROOT/f'raw/yahoo/{symbol}.json'
  if not p.exists():p.write_bytes(get(url,{'User-Agent':'Mozilla/5.0'}).content)
  cik=f"{int(tickers[symbol]['cik_str']):010d}"
  for kind,url in [('companyfacts',f'https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json'),('submissions',f'https://data.sec.gov/submissions/CIK{cik}.json')]:
   p=ROOT/f'raw/sec/{symbol}_{kind}.json'
   if not p.exists():p.write_bytes(get(url,HEAD).content);time.sleep(.18)
  sub=json.loads((ROOT/f'raw/sec/{symbol}_submissions.json').read_text())
  for shard in sub['filings']['files']:
   if shard.get('filingTo','')<'2022-01-01' or shard.get('filingFrom','')>'2025-12-31':continue
   name=shard['name'];p=ROOT/'raw/sec'/name
   if not p.exists():p.write_bytes(get(f'https://data.sec.gov/submissions/{name}',HEAD).content);time.sleep(.18)

def sec_bound(stamp):
 if not stamp:return None
 parsed=dt.datetime.fromisoformat(stamp.replace('Z','+00:00'))
 return (parsed+dt.timedelta(hours=1)).isoformat().replace('+00:00','Z')
def date_utc(ts):return dt.datetime.fromtimestamp(ts,dt.timezone.utc).astimezone(ZoneInfo('America/New_York')).date().isoformat()
def writer(path,fields):
 f=path.open('w',newline='');w=csv.DictWriter(f,fields);w.writeheader();return f,w

def normalize():
 out=ROOT/'normalized';out.mkdir(exist_ok=True,parents=True)
 f,bars=writer(out/'daily_ohlcv.csv',['date','symbol','open','high','low','close','volume','adjusted_close'])
 fi,ind=writer(out/'indicators.csv',['date','symbol','close','sma20','sma50','sma200','return_1d','volatility_20d_annualized'])
 fa,act=writer(out/'corporate_actions.csv',['date','symbol','type','amount','numerator','denominator'])
 ff,facts=writer(out/'fundamentals.csv',['symbol','taxonomy','concept','label','unit','value','period_start','period_end','fiscal_year','fiscal_period','form','filed','accession','acceptance_at','available_at','source_url'])
 ev=(ROOT/'evidence.jsonl').open('w'); counts={}
 def evidence(x):ev.write(json.dumps(x,ensure_ascii=False,separators=(',',':'))+'\n')
 for sym in SYMS:
  obj=json.loads((ROOT/f'raw/yahoo/{sym}.json').read_text());res=obj['chart']['result'][0];quote=res['indicators']['quote'][0];adjust=res['indicators'].get('adjclose',[{}])[0].get('adjclose',[]);closes=[];returns=[]; n=0
  for i,t in enumerate(res['timestamp']):
   day=date_utc(t)
   if not START<=day<=END:continue
   row={'date':day,'symbol':sym}
   for k in ['open','high','low','close','volume']:row[k]=quote[k][i]
   row['adjusted_close']=adjust[i] if i<len(adjust) else None
   if any(row[k] is None for k in ['open','high','low','close','volume']):raise ValueError(f'Incomplete OHLCV: {sym} {day}')
   if row['low']>min(row['open'],row['close'])+1e-5 or row['high']<max(row['open'],row['close'])-1e-5 or row['volume']<0:raise ValueError(f'Invalid bar {sym} {day}')
   bars.writerow(row);close=row['close'];ret=close/closes[-1]-1 if closes else None
   closes.append(close);returns.append(ret)
   def sma(n):return sum(closes[-n:])/n if len(closes)>=n else ''
   vol=statistics.stdev(returns[-20:])*math.sqrt(252) if len(returns)>=21 else ''
   ind.writerow({'date':day,'symbol':sym,'close':close,'sma20':sma(20),'sma50':sma(50),'sma200':sma(200),'return_1d':ret if ret is not None else '', 'volatility_20d_annualized':vol});n+=1
  for typ,values in res.get('events',{}).items():
   for x in values.values():
    day=date_utc(x['date'])
    if START<=day<=END:act.writerow({'date':day,'symbol':sym,'type':typ,'amount':x.get('amount',''),'numerator':x.get('numerator',''),'denominator':x.get('denominator','')})
  sub=json.loads((ROOT/f'raw/sec/{sym}_submissions.json').read_text());cik=int(sub['cik']);recent=sub['filings']['recent']; chunks=[recent]
  for sh in sub['filings']['files']:
   p=ROOT/'raw/sec'/sh['name']
   if p.exists():chunks.append(json.loads(p.read_text()))
  allfilings={}
  for chunk in chunks:
   for i,acc in enumerate(chunk.get('accessionNumber',[])):
    filing={k:(v[i] if isinstance(v,list) and i<len(v) else None) for k,v in chunk.items()};allfilings[acc]=filing
  filing_count=0
  for acc,x in allfilings.items():
   if x.get('form') not in ('10-K','10-Q','8-K','10-K/A','10-Q/A','8-K/A') or not START<=str(x.get('filingDate'))<=END:continue
   stamp=x.get('acceptanceDateTime'); url=f'https://www.sec.gov/Archives/edgar/data/{cik}/{acc.replace("-", "")}/{x.get("primaryDocument")}'
   evidence({'id':f'sec-filing:{sym}:{acc}','kind':'filing','symbols':[sym],'title':f"{sym} {x['form']} SEC filing",'source':'SEC EDGAR','url':url,'event_at':x.get('reportDate') or None,'published_at':None,'available_at':sec_bound(stamp),'content':{'form':x['form'],'items':x.get('items'),'filing_date':x.get('filingDate'),'accession':acc},'provenance':{'type':'sec_submissions','acceptance_timestamp_source':'SEC acceptanceDateTime','acceptance_at':stamp,'availability_rule':'acceptance plus one hour; operational delay, not proof of exact public dissemination','time_precision':'second','period_end_is_not_publication':True}});filing_count+=1
  doc=json.loads((ROOT/f'raw/sec/{sym}_companyfacts.json').read_text()); metric_count=0;missing=0
  for tax,concepts in doc.get('facts',{}).items():
   for concept,item in concepts.items():
    for unit,records in item.get('units',{}).items():
     for q in records:
      if not START<=q.get('filed','')<=END or q.get('form') not in ('10-K','10-Q','10-K/A','10-Q/A'):continue
      acc=q.get('accn'); x=allfilings.get(acc);stamp=x.get('acceptanceDateTime') if x else None
      url=f'https://www.sec.gov/Archives/edgar/data/{cik}/{acc.replace("-", "")}/' if acc else None
      row={'symbol':sym,'taxonomy':tax,'concept':concept,'label':item.get('label'),'unit':unit,'value':q.get('val'),'period_start':q.get('start',''),'period_end':q.get('end'),'fiscal_year':q.get('fy'),'fiscal_period':q.get('fp'),'form':q.get('form'),'filed':q.get('filed'),'accession':acc,'acceptance_at':stamp,'available_at':sec_bound(stamp),'source_url':url};facts.writerow(row);metric_count+=1
      if not stamp:missing+=1
  counts[sym]={'bars':n,'filings':filing_count,'fundamental_facts':metric_count,'facts_without_acceptance':missing}
 f.close();fi.close();fa.close();ff.close();ev.close();save_json(ROOT/'collection_counts.json',counts)
 print(json.dumps(counts,indent=2))

def filehash(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
 return h.hexdigest()

def manifest():
 records=[]
 for p in sorted(ROOT.rglob('*')):
  if p.is_file() and p.name!='manifest.json':
   stat=p.stat();records.append({'path':str(p.relative_to(ROOT)),'bytes':stat.st_size,'modified_at_utc':dt.datetime.fromtimestamp(stat.st_mtime,dt.timezone.utc).isoformat(),'sha256':filehash(p)})
 scripts={p.name:filehash(p) for p in sorted((ROOT.parents[1]/'scripts').glob('collect_research_data_3y*.py'))}
 save_json(ROOT/'manifest.json',{'created_at_utc':dt.datetime.now(dt.timezone.utc).isoformat(),'scope':'2022 warmup + 2023-2025; snapshot only','scripts_sha256':scripts,'files':records})
if __name__=='__main__':
 import argparse
 ap=argparse.ArgumentParser();ap.add_argument('--normalize-only',action='store_true');args=ap.parse_args()
 ROOT.mkdir(parents=True,exist_ok=True)
 if not args.normalize_only:download()
 normalize();manifest()
