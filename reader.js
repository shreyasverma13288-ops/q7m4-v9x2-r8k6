/* Public reader adapter: only exported GET data exists; no backend or write capability. */
window.PUBLIC_BASE='/q7m4-v9x2-r8k6';
(()=>{
'use strict';
const originalFetch=window.fetch.bind(window), root=new URL(window.PUBLIC_BASE+'/',location.origin);
try{localStorage.removeItem('ci-owner')}catch{}
const loaded=originalFetch(new URL('reader-data.json.gz',root)).then(async r=>{
 if(!r.ok)throw Error('Snapshot unavailable');
 const bytes=new Uint8Array(await r.arrayBuffer());
 const text=bytes[0]===31&&bytes[1]===139 ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text() : new TextDecoder().decode(bytes);
 return JSON.parse(text);
});
const clone=x=>JSON.parse(JSON.stringify(x));
const response=(x,status=200,type='application/json')=>new Response(type==='application/json'?JSON.stringify(x):x,{status,headers:{'Content-Type':type}});
const csvCell=x=>'"'+String(x??'').replaceAll('"','""')+'"';
function graph(g,q){
 const country=q.get('country'),node=q.get('node'), cnode=country?g.nodes.find(n=>n.cid===country)?.id:null;
 const list=k=>(q.get(k)||'').split(',').filter(Boolean);
 const families=list('family'),types=list('type'),conf=list('confidence');
 const links=g.links.filter(l=>l.tier<=Number(q.get('max_tier')||2)&&(!families.length||families.includes(l.family))&&(!types.length||types.includes(l.type))&&(!conf.length||conf.includes(l.confidence))&&(!q.get('nature')||l.nature===q.get('nature'))&&(!(q.get('status')==='activated')||l.status?.state!=='normal')&&(!cnode||[l.from,l.to].includes(cnode)||l.origin===country)&&(!node||[l.from,l.to,...(l.named||[]).map(n=>n.node)].includes(node)));
 const ids=new Set(links.flatMap(l=>[l.from,l.to])), weights={};
 links.forEach(l=>[l.from,l.to].forEach(id=>weights[id]=(weights[id]||0)+4-l.tier));
 return {...g,links,nodes:g.nodes.filter(n=>ids.has(n.id)).map(n=>({...n,weight:weights[n.id]||0}))};
}
function overlay(D,q){
 const ms=D.routes['/api/compare-series/measures'].measures,m=ms.find(m=>m.measure===q.get('measure'));
 const selected=(q.get('countries')||'').split(',').filter(Boolean);
 const wanted=m?(selected.length?m.countries.filter(c=>selected.includes(c)):m.countries):[];
 const frozen=D.overlays?.[m?.measure+'|'+[...wanted].sort().join(',')+'|'+(q.get('start')||'')];
 if(frozen&&!q.has('ids')&&!q.has('base'))return clone(frozen);
 const ids=q.get('ids')?q.get('ids').split(','):(m?m.series_ids.filter((id,i)=>!selected.length||selected.includes(m.countries[i])):[]);
 const bundles=ids.map(id=>D.routes['/api/series/'+id]).filter(Boolean), freqCount={};
 bundles.forEach(b=>freqCount[b.meta.frequency]=(freqCount[b.meta.frequency]||0)+1);
 const freq=Object.keys(freqCount).sort((a,b)=>freqCount[b]-freqCount[a]||(b==='M')-(a==='M'))[0];
 const warnings=[],notes=[],kept=bundles.filter(b=>b.meta.frequency===freq),units=[...new Set(kept.map(b=>b.meta.unit))];
 if(kept.length!==bundles.length)warnings.push('Series with a different frequency have been excluded.');
 let mode=units.length===1?'level':'index',base=null;
 const series=kept.map(b=>{const s=b.meta,src=D.routes['/api/sources/'+s.source_id]||{};return {id:s.id,country:s.country,label:s.label,unit:s.unit,measure:s.measure,frequency:s.frequency,projection_from:s.projection_from,decimals:s.decimals,reference_lines:s.reference_lines||[],source:{id:s.source_id,title:src.title,publisher:src.publisher,url:src.url,accessed_at:src.accessed_at},observations:b.observations.filter(o=>!q.get('start')||o.period>=q.get('start')).map(o=>({...o})),...(D.routes['/api/countries/'+s.country+'/workspace']?.snapshot.find(x=>x.series_id===s.id)?.stated?{stated:D.routes['/api/countries/'+s.country+'/workspace'].snapshot.find(x=>x.series_id===s.id).stated}:{})}});
 if(new Set(series.map(s=>s.measure)).size>1)warnings.push('Definitions differ: compare directions with care and read each series definition.');
 if(new Set(series.map(s=>s.source.publisher)).size>1)warnings.push('Different publishers: definitions may not match. Read each source.');
 for(const b of kept){if(b.meta.definition_notes)notes.push(b.meta.id+': '+b.meta.definition_notes);if(b.meta.quote_convention)notes.push(b.meta.quote_convention)}
 if(mode==='index'){
  let common=null;for(const s of series){const p=new Set(s.observations.filter(o=>o.status==='actual'&&!o.partial_through&&o.value).map(o=>o.period));common=common===null?p:new Set([...common].filter(x=>p.has(x)))}
  base=common?.has(q.get('base'))?q.get('base'):[...(common||[])].sort()[0]||null;
  if(!base){mode='none';warnings.push('There is no common observed period suitable for indexing.')}else{warnings.push('Units differ: indexed to '+base+' = 100. Compare changes, not levels.');series.forEach(s=>{const b=s.observations.find(o=>o.period===base).value;s.observations.forEach(o=>o.index=Math.round(o.value/b*10000)/100)})}
 }
 if(series.some(s=>s.observations.some(o=>o.status==='projection')))notes.push('Dashed projections are forecasts, not observations.');
 if(series.some(s=>s.observations.some(o=>o.partial_through)))notes.push('Partial months are flagged and are not full-month observations.');
 const latest=series.map(s=>[...s.observations].reverse().find(o=>o.status==='actual'&&!o.partial_through)?.period);
 if(new Set(latest).size>1)warnings.push('Latest complete observation dates differ across countries: '+latest.join(', ')+'.');
 return {series,warnings,notes,mode,base_period:base,unit:mode==='level'?units[0]:'index',label:m?.label||'Compared series',reading:kept.every(b=>b.meta.quote_convention?.includes('HIGHER number means a WEAKER'))?'Up = the local currency weaker against the US dollar.':null};
}
async function answer(url){
 const D=await loaded,q=url.searchParams,path=decodeURIComponent(url.pathname),R=D.routes;
 // Private and administrative endpoints are absent, rather than hidden by authentication.
 if(path.startsWith('/api/admin')||path==='/api/decisions'||path==='/api/pipeline'||path.includes('/revisions/')||path.endsWith('/source')||path.endsWith('/research'))return response({detail:'Unavailable in the public read-only snapshot'},404);
 if(path==='/api/handbook'||path==='/api/handbook/status')return response({available:false},404);
 if(path==='/api/web')return response(graph(clone(R[path]),q));
 if(path==='/api/compare-series')return response(overlay(D,q));
 if(path==='/api/search'){
  const query=(q.get('q')||'').trim().toLowerCase(),terms=query.split(/\s+/),country=q.get('country');
  const hits=query.length<2?[]:D.search.filter(s=>(!country||!s.country||s.country===country)&&terms.every(t=>(s.label+' '+s.text).toLowerCase().includes(t))).sort((a,b)=>Number(!a.label.toLowerCase().includes(query))-Number(!b.label.toLowerCase().includes(query)));
  const counts={};hits.forEach(s=>counts[s.kind]=(counts[s.kind]||0)+1);
  return response({q:query,results:hits.slice(0,Number(q.get('limit')||40)).map(({text,...s})=>({...s,snippet:(text||'').slice(0,180)})),counts,total:hits.length});
 }
 if(path==='/api/export.csv'||path.endsWith('/export.csv')){
  const ids=path==='/api/export.csv'?(q.get('ids')||'').split(','):[path.split('/')[3]],rows=[['series_id','label','period','value','unit','status','partial_through','vintage','measure','source_publisher','source_title','source_url','retrieved_at']];
  for(const id of ids){const b=R['/api/series/'+id];if(!b)continue;const s=b.meta,src=R['/api/sources/'+s.source_id]||{};for(const o of b.observations){if(q.get('start')&&o.period<q.get('start')||q.get('end')&&o.period>q.get('end'))continue;rows.push([id,s.label,o.period,o.value,s.unit,o.status,o.partial_through,o.vintage,s.measure,src.publisher,src.title,src.url,s.retrieved_at])}}
  return response(rows.map(r=>r.map(csvCell).join(',')).join('\n'),200,'text/csv');
 }
 let data=R[path];
 if(path==='/api/articles'&&q.get('country'))data=data.filter(a=>a.country_id===q.get('country'));
 if(path==='/api/watch'&&q.get('country')){data=clone(data);data.watchpoints=data.watchpoints.filter(w=>!w.country||w.country===q.get('country'))}
 if(path==='/api/calendar'&&q.get('country')){data=clone(data);data.events=data.events.filter(e=>e.country===q.get('country'));data.not_confirmed=data.not_confirmed.filter(e=>e.country===q.get('country'))}
 if(path==='/api/changes') {data=clone(data);data.items=data.items.filter(i=>(!q.get('since')||i.date>=q.get('since'))&&(!q.get('country')||!i.country||i.country===q.get('country')));data.since=q.get('since')||'';data.counts={};data.items.forEach(i=>data.counts[i.kind]=(data.counts[i.kind]||0)+1)}
 if(data?.type&&typeof data.text==='string')return response(data.text,200,data.type);
 return data===undefined?response({detail:'Not included in this public snapshot'},404):response(data);
}
window.fetch=async(input,init={})=>{
 const u=new URL(typeof input==='string'?input:input.url||String(input),location.href);
 if(u.origin===location.origin&&u.pathname.startsWith('/api/')){
  if((init.method||input?.method||'GET').toUpperCase()!=='GET')return response({detail:'Read-only site. No changes can be saved.'},403);
  return answer(u);
 }
 return originalFetch(input,init);
};
document.addEventListener('click',async e=>{
 const a=e.target.closest('a');if(!a)return;const url=new URL(a.href,location.href);
 if(url.origin!==location.origin||!url.pathname.startsWith('/api/'))return;
 e.preventDefault();e.stopPropagation();const r=await answer(url);
 if(!r.ok)return;
 const blob=await r.blob(),link=document.createElement('a');link.href=URL.createObjectURL(blob);
 link.download=url.pathname.includes('export.csv')?(url.searchParams.get('name')||'chart-data')+'.csv':url.pathname.split('/').slice(-3).join('-');
 link.click();setTimeout(()=>URL.revokeObjectURL(link.href),10000);
},true);
// Direct figure URLs are converted to data URIs from the approved article export.
const fixImages=async()=>{const D=await loaded;for(const img of document.querySelectorAll('img[src^="/api/"]')){const v=D.routes[decodeURIComponent(new URL(img.src).pathname)];if(v?.type==='image/svg+xml')img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(v.text)}};
new MutationObserver(fixImages).observe(document.documentElement,{childList:true,subtree:true});
})();