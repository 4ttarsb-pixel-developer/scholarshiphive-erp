import React, {useMemo, useState} from 'react';
import {BarChart3, ChevronRight, CircleDot, Eye, Search, X} from 'lucide-react';
import {formatAmount,isNativePKR,displaySpendPKR,sourceCurrencyNote} from '../utils/currency.js';

const css=`
.hierarchy-shell{margin-top:16px;border:1px solid #d8eaf8;background:linear-gradient(160deg,#f5faff,#fff);border-radius:17px;padding:16px}
.hierarchy-title{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px}
.hierarchy-title strong{font-size:16px;color:#153e61}.hierarchy-title small{color:#6b8ca5}
.hierarchy-kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin:14px 0}
.hierarchy-kpis div{background:#fff;border:1px solid #dceaf6;padding:12px;border-radius:12px}
.hierarchy-kpis small{display:block;font-size:11px;color:#6985a1}.hierarchy-kpis strong{font-size:21px;color:#114b79;display:block}
.hierarchy-tree{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.hierarchy-list{background:#fff;border:1px solid #d9e8f5;border-radius:13px;padding:10px;min-width:0;max-height:285px;overflow:auto}
.hierarchy-list h4{font-size:12px;letter-spacing:.3px;margin:4px 7px 11px;color:#4c728e}
.hierarchy-list button{display:flex;align-items:center;justify-content:space-between;text-align:left;width:100%;padding:11px 10px;margin:4px 0;border:1px solid transparent;border-radius:10px;background:transparent;color:#235277;cursor:pointer;gap:7px;font:inherit;font-size:12px;transition:.15s}
.hierarchy-list button:hover{background:#eff7ff}.hierarchy-list button.selected{background:#e7f4ff;border-color:#a3d4f5;color:#075d9b;font-weight:800}
.hierarchy-list button span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}.hierarchy-list button small{color:#7793a7;font-size:11px}
.hierarchy-control{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.hierarchy-control input,.hierarchy-control select{font:inherit;border:1px solid #d2e2ee;background:#fff;padding:10px 12px;color:#264f6a;border-radius:9px;max-width:100%;min-width:0}.hierarchy-control input{flex:1}
.hierarchy-adtable{background:white;border:1px solid #d8e8f4;border-radius:12px;overflow:auto}
.hierarchy-adtable table{width:100%;border-collapse:collapse;min-width:580px;font-size:12px}
.hierarchy-adtable th{background:#f1f7fc;text-align:left;color:#557490;padding:12px;font-size:11px}
.hierarchy-adtable td{padding:12px;border-top:1px solid #e8f1f7;color:#264d6d}
.hierarchy-adtable tr:hover td{background:#f6fbff}.hierarchy-pill{border-radius:20px;background:#eff3f8;padding:5px 9px;font-size:10px;font-weight:800;color:#677c92;white-space:nowrap}.hierarchy-pill.active{background:#e2f8ef;color:#16875d}
.hierarchy-inspect{background:#e5f4ff;border:0;border-radius:9px;color:#1167a3;padding:8px 10px;cursor:pointer;font-weight:750}.hierarchy-inspect:hover{background:#c9eaff}
.hierarchy-overlay{position:fixed;z-index:220;inset:0;background:#06182a9e;padding:16px;display:grid;place-items:center}.hierarchy-modal{background:#fff;border-radius:22px;padding:24px;width:min(100%,560px);max-height:90vh;overflow:auto;box-shadow:0 20px 60px #001c3f52}.hierarchy-modal header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.hierarchy-modal h2{font-size:21px;color:#153a59;margin:4px 0}.hierarchy-modal button.close{border:1px solid #d8e4f0;background:#f7fbff;border-radius:10px;padding:8px;cursor:pointer}.hierarchy-info{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:15px 0}.hierarchy-info div{background:#f4faff;border-radius:12px;padding:11px}.hierarchy-info small{display:block;color:#67839c;font-size:11px}.hierarchy-info strong{color:#124b76;font-size:14px;word-break:break-word}.hierarchy-notice{background:#f2f9ff;color:#62849d;border:1px solid #d7eaf7;border-radius:10px;padding:12px;font-size:12px;line-height:1.6}
@media(max-width:600px){.hierarchy-tree{grid-template-columns:1fr}.hierarchy-kpis{grid-template-columns:repeat(3,minmax(0,1fr))}.hierarchy-modal{padding:17px}}
`;
const active=s=>['ACTIVE','ENABLED','ENABLE','DELIVERY_OK'].includes(String(s||'').toUpperCase());
const cash=formatAmount;
const dual=(metrics,currency)=>{const pkr=displaySpendPKR(metrics,currency);const original=sourceCurrencyNote(metrics?.spend,metrics?.currency||currency);return original?`${pkr} (${original.toLowerCase()})`:pkr;};
const num=v=>v==null?'—':Number(v).toLocaleString();
const sum=(rows)=>rows.some(r=>r.metrics)?Math.round(rows.reduce((n,r)=>n+(r.metrics?.spend||0),0)*100)/100:null;
export default function AdHierarchyPanel({data,currency}){
 const [campaignId,setCampaignId]=useState('');
 const [groupId,setGroupId]=useState('');
 const [status,setStatus]=useState('ALL');
 const [query,setQuery]=useState('');
 const [selectedAd,setSelectedAd]=useState(null);
 const campaigns=data?.campaigns||[],groups=data?.adGroups||[],ads=data?.ads||[];
 const shownGroups=groups.filter(g=>!campaignId||g.campaignId===campaignId);
 const shownAds=useMemo(()=>ads.filter(a=>(!campaignId||a.campaignId===campaignId)&&(!groupId||a.adGroupId===groupId)&&
  (status==='ALL'||(status==='ACTIVE'?active(a.effectiveStatus):status==='PAUSED'?!active(a.effectiveStatus):a.effectiveStatus===status))&&
  (`${a.name} ${a.id}`.toLowerCase().includes(query.toLowerCase()))),[ads,campaignId,groupId,status,query]);
 const getCampaign=id=>campaigns.find(c=>c.id===id)?.name||'Unknown campaign';
 const getGroup=id=>groups.find(g=>g.id===id)?.name||'Unknown ad group';
 return <><style>{css}</style><section className="hierarchy-shell">
  <div className="hierarchy-title"><strong><BarChart3 size={17} style={{verticalAlign:'middle'}}/> Account → Campaign → Ad Group → Ad</strong><small>{data?.lastSyncedAt?`Synced ${new Date(data.lastSyncedAt).toLocaleString()}`:'Awaiting first successful sync'}</small></div>
  <div className="hierarchy-kpis"><div><small>Campaigns</small><strong>{campaigns.length}</strong></div><div><small>Ad Groups</small><strong>{groups.length}</strong></div><div><small>Individual Ads</small><strong>{ads.length}</strong></div></div>
  {data?.source!=='live_api'?<div className="hierarchy-notice">No verified live ad hierarchy yet. Admin must provide authorized API access, verify the account and run a sync. No synthetic ads are displayed.</div>:<>
   <div className="hierarchy-tree">
    <div className="hierarchy-list"><h4>1 · Campaigns</h4><button className={!campaignId?'selected':''} onClick={()=>{setCampaignId('');setGroupId('');}}><span>All campaigns</span><b>{campaigns.length}</b></button>{campaigns.map(c=><button className={campaignId===c.id?'selected':''} key={c.id} onClick={()=>{setCampaignId(c.id);setGroupId('')}}><span title={c.name}>{c.name}</span><small>{c.status}</small><ChevronRight size={13}/></button>)}</div>
    <div className="hierarchy-list"><h4>2 · Ad Sets / Ad Groups</h4><button className={!groupId?'selected':''} onClick={()=>setGroupId('')}><span>All {campaignId?'in campaign':'ad groups'}</span><b>{shownGroups.length}</b></button>{shownGroups.map(g=><button className={groupId===g.id?'selected':''} key={g.id} onClick={()=>setGroupId(g.id)}><span title={g.name}>{g.name}</span><small>{g.status}</small><ChevronRight size={13}/></button>)}</div>
   </div>
   <div className="hierarchy-control"><input type="search" aria-label="Search ads" placeholder="Search ad name or ID..." value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="Filter ad status" value={status} onChange={e=>setStatus(e.target.value)}><option value="ALL">All statuses</option><option value="ACTIVE">Active</option><option value="PAUSED">Paused / Not active</option><option value="UNAVAILABLE">Unavailable / historical</option><option value="DELETED">Deleted</option><option value="ARCHIVED">Archived</option></select></div>
   <div className="hierarchy-title" style={{marginBottom:10}}><strong>{shownAds.length} ad(s) found</strong><small>Selected-period ad-level spend: {!shownAds.length?'—':shownAds.every(a=>a.metrics?.spendPKR!=null)?cash(shownAds.reduce((t,a)=>t+Number(a.metrics.spendPKR),0),'PKR'):isNativePKR(currency)?cash(sum(shownAds),'PKR'):'PKR conversion pending'} · not added to account spend</small></div>
   <div className="hierarchy-adtable"><table><thead><tr><th>Ad / ID</th><th>Status</th><th>Spend (period)</th><th>Clicks</th><th>Impressions</th><th>Details</th></tr></thead><tbody>{shownAds.length?shownAds.map(a=><tr key={a.id}><td><b>{a.name}</b><div style={{fontSize:10,color:'#7b93a9'}}>{a.id}</div></td><td><span className={'hierarchy-pill '+(active(a.effectiveStatus)?'active':'')}>{a.effectiveStatus}</span></td><td>{dual(a.metrics,currency)}</td><td>{num(a.metrics?.clicks)}</td><td>{num(a.metrics?.impressions)}</td><td><button className="hierarchy-inspect" onClick={()=>setSelectedAd(a)}><Eye size={13} style={{verticalAlign:'middle'}}/> View</button></td></tr>):<tr><td colSpan="6">No ads for selected campaign, ad group or status.</td></tr>}</tbody></table></div>
   <p style={{fontSize:11,color:'#7592aa'}}>Ad groups correspond to Meta Ad Sets, Google Ad Groups and TikTok Ad Groups. Metrics cover the selected reporting period, where already fetched from the platform. A blank metric means unavailable, not zero.</p>
  </>}
 </section>
 {selectedAd&&<div className="hierarchy-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setSelectedAd(null)}} role="presentation"><div className="hierarchy-modal" role="dialog" aria-modal="true" aria-label="Individual ad details"><header><div><small style={{color:'#3b83b7'}}>INDIVIDUAL AD PERFORMANCE</small><h2>{selectedAd.name}</h2></div><button className="close" onClick={()=>setSelectedAd(null)} aria-label="Close ad details"><X size={18}/></button></header><div className="hierarchy-info">{[['Ad ID',selectedAd.id],['Campaign',getCampaign(selectedAd.campaignId)],['Ad Group',getGroup(selectedAd.adGroupId)],['Current / last known status',selectedAd.effectiveStatus],['Platform last known status',selectedAd.lastKnownPlatformStatus],['Last seen by API',selectedAd.lastSeenAt?new Date(selectedAd.lastSeenAt).toLocaleString():'Not recorded'],['Historical availability',selectedAd.availabilityStatus||'UNKNOWN'],['Spend (period)',dual(selectedAd.metrics,currency)],['Clicks (period)',num(selectedAd.metrics?.clicks)],['Impressions (period)',num(selectedAd.metrics?.impressions)],['Conversions',num(selectedAd.metrics?.conversions)],['Leads',num(selectedAd.metrics?.leads)]].map(([k,v])=><div key={k}><small>{k}</small><strong>{v}</strong></div>)}</div><div className="hierarchy-notice"><CircleDot size={14} style={{verticalAlign:'middle'}}/> Read-only API reporting. Status is the latest known platform status, not necessarily the status during the selected historical month. Reporting may be delayed by the platform. No ad settings can be changed here.</div></div></div>}
 </>;
}
