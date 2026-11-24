#!/usr/bin/env python3
"""Filter a pinned public HF parquet snapshot to metadata and append usable evidence.
Requires pyarrow. Source's LLM sentiment and reasoning fields are not imported.
Run after collect_research_data_3y.py; reruns remove previously derived news/facts.
"""
import csv,datetime as dt,hashlib,json,re,sys
from collections import Counter
from pathlib import Path
import pyarrow.parquet as pq
import pyarrow as pa
ROOT=Path(__file__).resolve().parents[1]/'data/research_3y'
SRC=ROOT/'raw/news_source.parquet'
ALIASES={'AAPL':['apple','iphone','ipad','macbook'],'MSFT':['microsoft','windows','azure','xbox'],'AMZN':['amazon','aws'],'NVDA':['nvidia'],'AMGN':['amgen'],'COST':['costco'],'GOOGL':['google','alphabet','youtube'],'META':['meta','facebook','instagram','whatsapp'],'QCOM':['qualcomm','snapdragon'],'TSLA':['tesla']}
FIELDS=['hash','ticker','company','query','rss_url','title','from_date','to_date','pub_date']
CONCEPTS={'Assets','Liabilities','StockholdersEquity','Revenues','RevenueFromContractWithCustomerExcludingAssessedTax','SalesRevenueNet','NetIncomeLoss','OperatingIncomeLoss','GrossProfit','EarningsPerShareBasic','EarningsPerShareDiluted','NetCashProvidedByUsedInOperatingActivities','PaymentsToAcquirePropertyPlantAndEquipment','CashAndCashEquivalentsAtCarryingValue','LongTermDebtCurrent','LongTermDebtNoncurrent','CommonStockSharesOutstanding','WeightedAverageNumberOfDilutedSharesOutstanding','OperatingExpenses','CostOfRevenue','ResearchAndDevelopmentExpense','DividendsCommonStockCash'}
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
full_source=SRC.exists()
selected_source=ROOT/'raw/news_selected_metadata.parquet'
if not full_source and not selected_source.exists():raise SystemExit('Download the pinned parquet snapshot to raw/news_source.parquet first; see docs/DATA_RESEARCH_3Y.md')
if full_source:
 source_hash=sha(SRC); captured=dt.datetime.now(dt.timezone.utc).isoformat()
else:
 receipt=json.loads((ROOT/'news_source_receipt.json').read_text());source_hash=receipt['full_source_sha256'];captured=receipt['retrieved_at_utc']
t=pq.read_table(SRC if full_source else selected_source,columns=FIELDS); rows=t.to_pylist(); raw=[]; good=[]; counts=Counter(); seen=set()
patterns={s:re.compile(r'(?i)(?<![A-Za-z0-9])(?:'+'|'.join(map(re.escape,terms))+r')(?![A-Za-z0-9])') for s,terms in ALIASES.items()}
for x in rows:
 sym=x.get('ticker');day=x.get('pub_date') or ''
 if sym not in ALIASES:continue
 try:d=dt.date.fromisoformat(day)
 except (ValueError,TypeError):counts[(sym,'invalid_date','raw')]+=1;continue
 if not dt.date(2023,1,1)<=d<=dt.date(2025,12,31):continue
 raw.append(x);year=str(d.year);counts[(sym,year,'raw')]+=1
 title=x.get('title') or '';url=x.get('rss_url') or ''
 if not title.strip() or not url.startswith('https://'):counts[(sym,year,'invalid_metadata')]+=1;continue
 if not patterns[sym].search(title):counts[(sym,year,'keyword_excluded')]+=1;continue
 key=(sym,day,title.strip().casefold())
 if key in seen:counts[(sym,year,'duplicate_excluded')]+=1;continue
 seen.add(key);good.append(x);counts[(sym,year,'selected')]+=1
if full_source:pq.write_table(pa.Table.from_pylist(raw,schema=t.schema),selected_source,compression='zstd')
if full_source:(ROOT/'news_source_receipt.json').write_text(json.dumps({'dataset':'AlfonsoLozana/news','revision':'6440e2333bfa0ec38b5ef46315e25dfb91a941da','retrieved_at_utc':captured,'full_source_sha256':source_hash,'full_source_bytes':SRC.stat().st_size,'full_source_url':'https://huggingface.co/datasets/AlfonsoLozana/news/resolve/6440e2333bfa0ec38b5ef46315e25dfb91a941da/data/train-00000-of-00001.parquet','stored_snapshot':'raw/news_selected_metadata.parquet','retained_columns':FIELDS,'excluded_columns':['long_s','short_s','confidence','relevance','reasoning'],'license_claim':'dataset card states MIT; does not establish rights to publisher articles'},ensure_ascii=False,indent=2)+'\n')
with (ROOT/'news_coverage.csv').open('w',newline='') as f:
 w=csv.writer(f);w.writerow(['symbol','year','raw','selected','keyword_excluded','duplicate_excluded','invalid_metadata'])
 for s in ALIASES:
  for y in ('2023','2024','2025'):w.writerow([s,y,*[counts[s,y,k] for k in ('raw','selected','keyword_excluded','duplicate_excluded','invalid_metadata')]])
# Keep filing records produced by the source normalizer, replacing previous appended evidence.
p=ROOT/'evidence.jsonl'; existing=[]
with p.open() as f:
 for line in f:
  q=json.loads(line)
  if q.get('kind')=='filing':existing.append(line)
with p.open('w') as out:
 out.writelines(existing)
 for x in good:
  d=dt.date.fromisoformat(x['pub_date']); boundary=dt.datetime.combine(d+dt.timedelta(days=2),dt.time(),tzinfo=dt.timezone.utc).isoformat().replace('+00:00','Z');sym=x['ticker']
  ident=hashlib.sha256((sym+'\0'+x['pub_date']+'\0'+x['title']).encode()).hexdigest()
  q={'id':'news:'+ident,'kind':'news','symbols':[sym],'title':x['title'],'source':'Google News RSS via AlfonsoLozana/news','url':x['rss_url'],'event_at':None,'published_at':None,'available_at':boundary,'content':{'headline':x['title']},'provenance':{'dataset_revision':'6440e2333bfa0ec38b5ef46315e25dfb91a941da','dataset_record_hash':x['hash'],'reported_publication_date':x['pub_date'],'publication_precision':'date_only','publication_timezone':'unknown','availability_rule':'00:00 UTC two calendar dates after reported date; conservative derived bound under UTC offsets within +/-14 hours','availability_is_actual_publication_time':False,'assumptions':'reported date is accurate; title and date revision history not independently verified','retrieved_at_utc':captured,'relevance':'title keyword matched; topical relevance remains unverified','url_type':'Google News redirect, not independently verified publisher URL'}}
  out.write(json.dumps(q,ensure_ascii=False,separators=(',',':'))+'\n')
 with (ROOT/'normalized/fundamentals.csv').open(newline='') as f:
  n=0
  for r in csv.DictReader(f):
   if r['concept'] not in CONCEPTS or not r['available_at']:continue
   ident=hashlib.sha256(json.dumps(r,sort_keys=True).encode()).hexdigest()
   q={'id':'fundamental:'+ident,'kind':'fundamental','symbols':[r['symbol']],'title':r['label'] or r['concept'],'source':'SEC XBRL companyfacts','url':r['source_url'],'event_at':r['period_end'] or None,'published_at':None,'available_at':r['available_at'],'content':{'concept':r['concept'],'taxonomy':r['taxonomy'],'unit':r['unit'],'value':float(r['value']),'period_start':r['period_start'] or None,'period_end':r['period_end'],'fiscal_year':r['fiscal_year'],'fiscal_period':r['fiscal_period'],'form':r['form'],'accession':r['accession']},'provenance':{'type':'sec_companyfacts','timing':'matched accession to SEC submissions acceptanceDateTime; available one hour later as an operational delay, not proof of exact public dissemination','acceptance_at':r['acceptance_at'],'observations_include_later_amendments':'each observation is gated by its own acceptance; periods may be cumulative','not_a_ttm_metric':True}}
   out.write(json.dumps(q,ensure_ascii=False,separators=(',',':'))+'\n');n+=1
print('news selected',len(good),'fundamental evidence',n,'filings',len(existing));print('raw rows',len(raw))
