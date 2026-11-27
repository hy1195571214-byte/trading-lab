import React, {useEffect, useState} from "react";
import {req, Any} from "./api";
import {useLocale} from "./i18n";
import {retryMarketRead} from "./marketReadRetry";
import {ErrorMessage} from "./ui";

export default function ReplayNews({experimentId, asOf, symbol}: {experimentId:string; asOf:string; symbol:string}) {
  const {t}=useLocale();
  const [items,setItems]=useState<Any[]>([]);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState<Error|string>("");
  useEffect(()=>{
    setItems([]);setError("");
    if(!asOf){setLoading(false);return;}
    const controller=new AbortController();let cancelled=false;setLoading(true);
    // Coalesce fast playback changes; a previous point's headlines must never
    // remain visible while a new point or symbol is loading.
    const timer=window.setTimeout(()=>{
      const query=new URLSearchParams({as_of:asOf.slice(0,10),symbol});
      retryMarketRead(()=>req(`/experiments/${experimentId}/news?${query}`,{signal:controller.signal}),controller.signal)
        .then(data=>{if(!cancelled)setItems(data.items||[]);})
        .catch(e=>{if(!cancelled)setError(e);})
        .finally(()=>{if(!cancelled)setLoading(false);});
    },300);
    return()=>{cancelled=true;window.clearTimeout(timer);controller.abort();};
  },[experimentId,asOf,symbol]);
  return <details className="panel" style={{marginTop:16}} open>
    <summary><b>{t("Contemporaneous news")} · {symbol}</b></summary>
    <p className="muted">{t("News is background material for this rule-based demo; it does not generate trades. Dates use a conservative visibility delay, not verified publication times.")}</p>
    {loading?<p>{t("Loading news for this replay point…")}</p>:error?<p className="error"><ErrorMessage error={error}/></p>:!items.length?<p className="muted">{t("No news is available at this replay point.")}</p>:<ul>
      {items.map(item=><li key={item.id} style={{marginBottom:12}}><a style={{color:"#d6ee3e",textUnderlineOffset:3}} href={/^https?:\/\//.test(item.url||"")?item.url:undefined} target="_blank" rel="noreferrer">{item.title}</a><small style={{display:"block"}}>{item.source} · {t("Available from")}: {item.available_at}</small></li>)}
    </ul>}
  </details>;
}
