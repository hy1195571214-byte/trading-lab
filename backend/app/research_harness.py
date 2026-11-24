"""Research workflow primitives. Evidence is data, never an instruction source."""
from __future__ import annotations
import hashlib, json, math, statistics
from datetime import datetime, timezone

MAX_RECORDS=50000
MAX_CONTEXT_RECORDS=20
MAX_CONTENT_CHARS=1500
KINDS={'news','event','fundamental','indicator','filing'}

def timestamp(value, field):
    if not isinstance(value,str) or 'T' not in value:
        raise ValueError(f'{field} requires an ISO timestamp with timezone')
    try: dt=datetime.fromisoformat(value.replace('Z','+00:00'))
    except ValueError as exc: raise ValueError(f'{field} is not a valid timestamp') from exc
    if dt.tzinfo is None or dt.utcoffset() is None: raise ValueError(f'{field} requires a timezone')
    return dt.astimezone(timezone.utc)

def parse_pack(text):
    if not isinstance(text,str) or len(text.encode('utf-8'))>25_000_000: raise ValueError('Evidence pack must be text at most 25 MB')
    try:
        obj=json.loads(text)
        records=obj if isinstance(obj,list) else [obj]
    except json.JSONDecodeError:
        try: records=[json.loads(line) for line in text.splitlines() if line.strip()]
        except json.JSONDecodeError as exc: raise ValueError('Evidence must be a JSON array or JSONL') from exc
    if not records or len(records)>MAX_RECORDS: raise ValueError('Evidence pack must contain 1 to 50000 records')
    ids=set(); required={'id','kind','symbols','title','source','url','event_at','published_at','available_at','content','provenance'}
    for row in records:
        if not isinstance(row,dict) or not required.issubset(row): raise ValueError('Evidence record is missing required fields')
        if not isinstance(row['id'],str) or not row['id'] or row['id'] in ids: raise ValueError('Evidence IDs must be unique nonempty strings')
        ids.add(row['id'])
        if row['kind'] not in KINDS: raise ValueError('Unsupported evidence kind')
        if not isinstance(row['symbols'],list) or not all(isinstance(s,str) and s for s in row['symbols']): raise ValueError('symbols must be an array of strings')
        if not all(isinstance(row[k],str) for k in ('title','source','url')) or not isinstance(row['content'],(str,dict,list)) or not isinstance(row['provenance'],dict): raise ValueError('Invalid evidence content or provenance')
        # Date-only publication/event values remain metadata; never infer availability from them.
        for k in ('event_at','published_at'):
            if row[k] is not None and not isinstance(row[k],str): raise ValueError(f'{k} must be text or null')
        if row['available_at'] is not None:
            available=timestamp(row['available_at'],'available_at')
            # An event may be announced before it happens, but publication
            # cannot follow the claimed availability time.
            if row['published_at'] and 'T' in row['published_at'] and timestamp(row['published_at'],'published_at')>available:
                raise ValueError('published_at cannot be later than availability')
    canonical=json.dumps(records,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False)
    return records,hashlib.sha256(canonical.encode()).hexdigest(),canonical

def query(records, as_of, symbols):
    cutoff=timestamp(as_of,'as_of'); allowed=set(symbols); selected=[]; unknown=0
    for row in records:
        if not row['available_at']: unknown+=1; continue
        if timestamp(row['available_at'],'available_at')<=cutoff and (not row['symbols'] or allowed.intersection(row['symbols'])):
            selected.append(row)
    selected.sort(key=lambda x:(timestamp(x['available_at'],'available_at'),x['id']),reverse=True)
    visible=selected[:MAX_CONTEXT_RECORDS]
    safe=[]
    for r in visible:
        item={k:r[k] for k in ('id','kind','symbols','title','source','url','available_at','content','provenance')}
        if not isinstance(item['content'],str):item['content']=json.dumps(item['content'],ensure_ascii=False,separators=(',',':'))
        item['content']=item['content'][:MAX_CONTENT_CHARS]
        item['provenance']=json.dumps(item['provenance'],ensure_ascii=False,separators=(',',':'))[:MAX_CONTENT_CHARS]
        safe.append(item)
    return safe,{'eligible':len(selected),'included':len(safe),'unknown_availability_excluded':unknown,'context_cap':MAX_CONTEXT_RECORDS,'as_of':as_of}

def config_options(raw):
    defaults={'min_cash_weight':0.0,'max_gross_weight':1.0,'max_turnover':2.0,'max_sector_weight':1.0,'sectors':{}}
    if raw is None:return defaults
    if not isinstance(raw,dict) or set(raw)-set(defaults):raise ValueError('Invalid harness risk options')
    options={**defaults,**raw}
    for k in ('min_cash_weight','max_gross_weight','max_turnover','max_sector_weight'):
        v=options[k]; maximum=2 if k=='max_turnover' else 1
        if isinstance(v,bool) or not isinstance(v,(int,float)) or not math.isfinite(v) or not 0<=v<=maximum:raise ValueError(f'{k} must be between 0 and {maximum}')
    if not isinstance(options['sectors'],dict) or not all(isinstance(k,str) and isinstance(v,str) and v for k,v in options['sectors'].items()):raise ValueError('sectors must map symbols to nonempty sector labels')
    return options

def summarize_prices(snapshot):
    """Descriptive visible-bar indicators, never a prediction or a future bar."""
    groups={}
    for bar in snapshot.get('bars',[]):
        if isinstance(bar,dict) and bar.get('symbol') and isinstance(bar.get('close'),(int,float)) and not isinstance(bar['close'],bool) and math.isfinite(bar['close']) and bar['close']>0:
            groups.setdefault(bar['symbol'],[]).append(bar)
    out={}
    for symbol,bars in groups.items():
        bars.sort(key=lambda b:b.get('bar_end') or b.get('date') or '')
        closes=[b['close'] for b in bars[-21:]]
        returns=[b/a-1 for a,b in zip(closes,closes[1:])]
        out[symbol]={'bars':len(closes),'return_over_window':closes[-1]/closes[0]-1 if len(closes)>1 else None,
                     'per_bar_return_volatility':statistics.stdev(returns) if len(returns)>1 else None}
    return out

def recent_bars(snapshot):
    by_symbol={}
    for bar in snapshot.get('bars',[]):
        if isinstance(bar,dict) and bar.get('symbol'):by_symbol.setdefault(bar['symbol'],[]).append(bar)
    return [bar for group in by_symbol.values() for bar in sorted(group,key=lambda b:b.get('bar_end') or b.get('date') or '')[-61:]]

def portfolio_risk(bars,weights):
    """Visible-bar constant-weight historical sample; not a forecast guarantee."""
    active={s:w for s,w in weights.items() if w>1e-12}
    if not active:return {'available':False,'reason':'No invested target weights'}
    prices={s:{} for s in active}
    for bar in bars:
        sym=bar.get('symbol'); key=bar.get('bar_end') or bar.get('date'); close=bar.get('close')
        if sym in prices and key and isinstance(close,(int,float)) and not isinstance(close,bool) and math.isfinite(close) and close>0:prices[sym][key]=float(close)
    keys=sorted(set.intersection(*(set(p) for p in prices.values()))) if prices else []
    keys=keys[-61:]
    returns=[sum(w*(prices[s][b]/prices[s][a]-1) for s,w in active.items()) for a,b in zip(keys,keys[1:])]
    if len(returns)<20:return {'available':False,'reason':'At least 20 aligned return observations required','observations':len(returns)}
    losses=sorted((-r for r in returns),reverse=True)
    # Every observation has mass 1/n. Integrate exactly the worst 5% of
    # the empirical loss distribution, including a fractional boundary mass.
    tail_mass=len(losses)/20
    whole_observations=int(tail_mass)
    boundary_weight=tail_mass-whole_observations
    tail_loss=math.fsum(losses[:whole_observations])+boundary_weight*losses[whole_observations]
    return {'available':True,'observations':len(returns),'per_bar_volatility':statistics.stdev(returns),
            'mean_return':statistics.mean(returns),'worst_observed_loss':max(losses),
            'historical_expected_shortfall_95':tail_loss/tail_mass,
            'method':'Equal-time aligned, constant target weights; mean of exactly the worst 5% empirical loss mass with a fractionally weighted boundary observation; per-bar, excludes costs; signed losses may be negative; descriptive and not calibrated predictive confidence.'}

def current_weights(state,symbols):
    equity=state.get('equity') or 0
    if not isinstance(equity,(int,float)) or equity<=0:return {}
    return {s:(state.get('positions',{}).get(s,{}).get('quantity',0)*state.get('positions',{}).get(s,{}).get('last_price',0)/equity) for s in symbols}

def risk_check(cfg,state,proposal,bars=None):
    opts=cfg['harness_risk']; action=proposal.get('action'); targets=proposal.get('targets',{})
    if action not in ('hold','rebalance') or not isinstance(targets,dict): raise ValueError('Invalid proposal structure')
    if action=='hold' and targets: raise ValueError('Hold cannot contain target weights')
    allowed=set(cfg['symbols']); weights={}
    for sym,v in targets.items():
        if sym not in allowed or isinstance(v,bool) or not isinstance(v,(int,float)) or not math.isfinite(v) or v<0:raise ValueError('Invalid target symbol or weight')
        weights[sym]=float(v)
    preserve=proposal.get('preserve_symbols',[])
    if preserve:
        from .score_fusion import validated_preserve
        validated_preserve(state,proposal)
    equity=state.get('equity') or 0
    if not isinstance(equity,(int,float)) or not math.isfinite(equity) or equity<=0:raise ValueError('Cannot evaluate risk without positive equity')
    current=current_weights(state,allowed)
    for sym in preserve:weights[sym]=current.get(sym,0.0)
    gross=sum(weights.values())
    if action=='hold':
        gross=sum(current.values())
        return {'passed':True,'action':'hold','checks':['preserve current holdings'],'limits':opts,
                'gross_weight':gross,'cash_weight':1-gross,'turnover_l1':0.0,
                'historical_risk':portfolio_risk(bars or [],current),
                'stress_scenarios':{'label':'Illustrative uniform shocks, not forecasts; excludes costs and gaps','portfolio_loss_if_all_assets_fall_5pct':gross*0.05,'portfolio_loss_if_all_assets_fall_10pct':gross*0.10}}
    turnover=sum(abs(weights.get(s,0)-current[s]) for s in allowed)
    sectors={}; missing=[]
    for sym,w in weights.items():
        sector=opts['sectors'].get(sym)
        if w and not sector:missing.append(sym)
        if sector:sectors[sector]=sectors.get(sector,0)+w
    failures=[]
    if any(w>cfg['max_position_weight']+1e-9 for sym,w in weights.items() if sym not in preserve): failures.append('position limit')
    if gross>min(1.0,opts['max_gross_weight'])+1e-9:failures.append('gross exposure')
    if 1-gross<opts['min_cash_weight']-1e-9:failures.append('minimum cash')
    if turnover>opts['max_turnover']+1e-9:failures.append('turnover')
    if opts['max_sector_weight']<1 and missing:failures.append('sector mapping missing')
    if any(w>opts['max_sector_weight']+1e-9 for w in sectors.values()):failures.append('sector concentration')
    return {'passed':not failures,'failures':failures,'gross_weight':gross,'cash_weight':1-gross,'turnover_l1':turnover,'sector_weights':sectors,'missing_sectors':missing,'limits':opts,
            'historical_risk':portfolio_risk(bars or [],weights),
            'stress_scenarios':{'label':'Illustrative uniform shocks, not forecasts; excludes costs and gaps',
                                'portfolio_loss_if_all_assets_fall_5pct':gross*0.05,
                                'portfolio_loss_if_all_assets_fall_10pct':gross*0.10}}

def validate_citations(proposal,evidence):
    ids=proposal.get('citation_ids')
    if not isinstance(ids,list) or not all(isinstance(v,str) for v in ids) or len(ids)!=len(set(ids)):raise ValueError('citation_ids must be a unique list of evidence IDs')
    unknown=set(ids)-{x['id'] for x in evidence}
    if unknown:raise ValueError('Citation not present in the visible evidence snapshot')
    for key in ('uncertainty','scenario'):
        if not isinstance(proposal.get(key),str) or not proposal[key].strip():raise ValueError(f'{key} must be nonempty text')
