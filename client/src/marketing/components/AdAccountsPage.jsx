import React, { useEffect, useState } from 'react';
import { ArrowUpRight, Check, Clock3, Link2, Plus, RefreshCw, ShieldCheck, Trash2, UserPlus, Users, X, Pencil } from 'lucide-react';
import { api } from '../api/client.jsx';
import AdHierarchyPanel from './AdHierarchyPanel.jsx';
import {displayRef} from '../utils/display-id';
import {isNativePKR, displaySpendPKR, sourceCurrencyNote, fxStatusDescription} from '../utils/currency.js';

const showConverted = m => displaySpendPKR(m);
const fxExplanation = fxStatusDescription;
const platforms = ['Meta Ads', 'Google Ads', 'TikTok Ads'];
const accountStyles = `
.adaccess-fx{margin:14px 0;padding:16px;border:1px solid #b8d7ea;background:linear-gradient(120deg,#f0f9ff,#f7fbff);border-radius:15px}
.adaccess-fx form{display:flex;gap:10px;flex-wrap:wrap;align-items:end;margin-top:10px}
.adaccess-fx label{display:flex;flex-direction:column;gap:6px;color:#235878;font-size:12px;font-weight:700;min-width:130px;flex:1}
.adaccess-fx input,.adaccess-fx select{background:#fff;border:1px solid #bdd8e9;border-radius:9px;padding:10px;min-width:90px;color:#113d62;font:inherit}
.adaccess-fx .fx-list{color:#235878;font-size:12px;line-height:1.8;margin-top:10px}
.adaccess-live{background:linear-gradient(130deg,#f2f9ff,#ecf5ff);border:1px solid #cae3f8;border-radius:14px;padding:15px;margin-top:16px}
.adaccess-live-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin-top:10px}
.adaccess-live-grid>div{background:white;border:1px solid #d9e9f6;border-radius:10px;padding:10px}
.adaccess-live-grid small{display:block;color:#65829a;font-size:11px}
.adaccess-live-grid strong{display:block;color:#143c60;font-size:16px;margin-top:3px}
.adaccess-campaigns{max-height:150px;overflow:auto;margin-top:10px}
.adaccess-campaigns>div{padding:8px;border-bottom:1px solid #dbe8f4;font-size:12px;color:#244d6b;display:flex;justify-content:space-between;gap:8px}
.adaccess-actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.adaccess-actions button{white-space:nowrap}
.adaccess-summary{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px}
.adaccess-count{border-radius:999px;background:#e8f4fe;color:#0763a0;padding:7px 12px;font-size:12px;font-weight:800}
.adaccess-user-list{display:flex;flex-direction:column;gap:8px;max-height:260px;overflow:auto}
.adaccess-user{display:flex;align-items:center;justify-content:space-between;gap:12px;border:1px solid #ddebf5;background:#f6fbff;padding:12px;border-radius:12px}
.adaccess-user strong{font-size:13px;color:#143755}.adaccess-user small{display:block;color:#6e89a0;margin-top:3px;overflow-wrap:anywhere}
.adaccess-note{background:#ecf7ff;color:#316781;padding:12px 14px;border:1px solid #cce5f7;border-radius:12px;line-height:1.65;font-size:12px;margin:12px 0}
.adaccess-select{width:100%;padding:12px;border:1px solid #d6e6f1;border-radius:10px;background:#fff;color:#174263}
.adaccess-danger{background:#fff1f3;color:#af2640;border:1px solid #f1bdc9;border-radius:9px;padding:9px 12px;cursor:pointer}
.adaccess-small{font-size:12px;color:#6d8ba4;line-height:1.5}
.adaccess-inline{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.adaccess-overlay{position:fixed;inset:0;z-index:150;background:#061d3699;display:grid;place-items:center;padding:15px}
.adaccess-dialog{background:#fff;width:min(100%,600px);border-radius:22px;max-height:92dvh;overflow:auto;padding:25px;box-shadow:0 25px 80px #05234440}
.adaccess-dialog-head{display:flex;align-items:start;justify-content:space-between;gap:12px}.adaccess-dialog h2{font-size:22px;color:#193d5d;margin:0}.adaccess-dialog p{color:#728ba3;font-size:13px;line-height:1.6}
.adaccess-form{display:grid;gap:13px;margin-top:18px}.adaccess-form label{font-size:12px;font-weight:750;color:#385978;display:grid;gap:6px}.adaccess-form input,.adaccess-form select{border:1px solid #d2e5f4;border-radius:11px;padding:13px;min-width:0;color:#1d4667;font:inherit}
.adaccess-footer{display:flex;justify-content:flex-end;gap:9px;margin-top:20px;flex-wrap:wrap}
.adaccess-btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:10px 13px;border:0;border-radius:10px;background:linear-gradient(105deg,#086aa9,#189dd6);font-size:12px;font-weight:800;color:white;cursor:pointer;transition:transform .2s,box-shadow .2s}
.adaccess-btn:hover:not(:disabled){transform:translateY(-2px);box-shadow:0 9px 19px #118bc544}.adaccess-btn:disabled{opacity:.5;cursor:not-allowed}
.adaccess-btn.secondary{background:#eaf4fc;color:#17669c;border:1px solid #c9e3f5}.adaccess-btn.warn{background:#fff0f3;color:#ad2d40;border:1px solid #f4c0c8}
.adaccess-detail{display:flex;justify-content:space-between;gap:14px;padding:11px 0;border-bottom:1px solid #ebf2f7;font-size:13px;overflow-wrap:anywhere}.adaccess-detail span{color:#7f93a4}.adaccess-detail b{text-align:right;color:#193f60}
.adaccess-empty{border:1px dashed #b9d6ec;background:#f2faff;border-radius:15px;text-align:center;padding:40px 18px;color:#487b9d;grid-column:1/-1}.adaccess-empty strong{display:block;color:#154b77;margin-top:10px}.adaccess-empty p{font-size:13px}
@media(max-width:620px){.adaccess-dialog{padding:19px}.adaccess-actions{width:100%}.adaccess-actions button{flex:1}.adaccess-footer>*{flex:1}.adaccess-user{flex-direction:column;align-items:stretch}}
`;

export default function AdAccountsPage({ accounts, isAdmin, team, onRefresh, notify, reportingPeriod }) {
  const [dialog, setDialog] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [platform, setPlatform] = useState('Meta Ads');
  const [name, setName] = useState('');
  const [externalId, setExternalId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(null);
  const [campaignResult,setCampaignResult]=useState(null);
  const [hierarchyResult,setHierarchyResult]=useState(null);
  const [performanceResult,setPerformanceResult]=useState(null);
  const [liveBusy,setLiveBusy]=useState(false);
  const [fxRates,setFxRates]=useState([]);
  const [fxMonth,setFxMonth]=useState(reportingPeriod?.month||new Date().toISOString().slice(0,7));
  const [fxCurrency,setFxCurrency]=useState('');
  const [fxValue,setFxValue]=useState('');
  const [fxSource,setFxSource]=useState('');
  const [fxBusy,setFxBusy]=useState(false);
  // Finance controls appear only if an authorized account reports a non-PKR currency.
  const foreignCurrencies=[...new Set(accounts.map(a=>a.currency).filter(c=>c && !isNativePKR(c)).map(c=>c.toUpperCase()))];
  const hasForeignAccount=foreignCurrencies.length>0;
  useEffect(()=>{if(hasForeignAccount && !foreignCurrencies.includes(fxCurrency))setFxCurrency(foreignCurrencies[0]);},[accounts,fxCurrency]);
  useEffect(()=>{api.fxRates().then(setFxRates).catch(()=>{});},[]);
  const storeFx=async e=>{e.preventDefault();setFxBusy(true);try{await api.saveFxRate({currency:fxCurrency,month:fxMonth,rate:Number(fxValue),source:fxSource.trim()});setFxRates(await api.fxRates());await onRefresh();if(selectedId && dialog==='manage')await getLive(selectedId);notify('Monthly PKR reporting rate saved. Previous platform currency values remain unchanged.');setFxValue('');}catch(error){notify(error.message)}finally{setFxBusy(false)}};
  const selected = accounts.find(a => a.id === selectedId);
  const periodQuery=reportingPeriod||{};
  const getLive = async id => {
    const [status,camps,perf,tree]=await Promise.all([api.adStatus(id,periodQuery),api.adCampaigns(id,periodQuery),api.adPerformance(id,periodQuery),api.adHierarchy(id,periodQuery)]);
    setLive(status);setCampaignResult(camps);setPerformanceResult(perf);setHierarchyResult(tree);
  };
  useEffect(()=>{
    if(!selectedId||dialog!=='manage')return;
    let active=true;
    Promise.all([api.adStatus(selectedId,periodQuery),api.adCampaigns(selectedId,periodQuery),api.adPerformance(selectedId,periodQuery),api.adHierarchy(selectedId,periodQuery)])
      .then(([status,camps,perf,tree])=>{if(active){setLive(status);setCampaignResult(camps);setPerformanceResult(perf);setHierarchyResult(tree);}})
      .catch(()=>{if(active)setLive(null)});
    return()=>{active=false};
  },[selectedId,dialog,reportingPeriod?.month,reportingPeriod?.startDate,reportingPeriod?.endDate]);
  const syncAccount=async id=>{
    setLiveBusy(true);
    try {
      await api.refreshAdAccount(id,periodQuery);notify('Sync requested. Historical ranges can take longer; status updates in the background.');
      // Poll read-only status endpoint while sync completes; no credentials reach browser.
      for(let i=0;i<25;i++){
        await new Promise(done=>setTimeout(done,1700));
        const result=await api.adStatus(id,periodQuery);
        setLive(result);
        if(!result.syncInProgress)break;
      }
      await getLive(id);await onRefresh();
    }catch(e){notify(e.message)}finally{setLiveBusy(false)}
  };
  const verifyAccount=async id=>{
    setLiveBusy(true);
    try{await api.verifyAdAccount(id);await getLive(id);await onRefresh();notify('Authorized account verified successfully')}
    catch(e){notify(e.message);try{await getLive(id)}catch{}}
    finally{setLiveBusy(false)}
  };
  const refreshList=async()=>{
    await onRefresh();
    const verified=accounts.filter(a=>a.lastVerifiedAt);
    if(verified.length) {notify(`Checking ${verified.length} verified account(s)...`);await Promise.allSettled(verified.map(a=>api.refreshAdAccount(a.id,periodQuery)));await onRefresh();}
  };
  // Opening this section again asks the backend to refresh verified accounts (throttled server-side).
  useEffect(()=>{
    const timer=setInterval(()=>{onRefresh().catch(()=>{});},30000);
    return ()=>clearInterval(timer);
  },[]);
  useEffect(()=>{
    if(dialog!=='manage'||!selectedId)return;
    const interval=setInterval(()=>getLive(selectedId).catch(()=>{}),15000);
    return()=>clearInterval(interval);
  },[dialog,selectedId]);
  const assignedUsers = selected?.assignedEmployees || [];
  const selectableEmployees = team.filter(u => u.role==='Employee' && u.status==='Active' && !assignedUsers.some(x=>x.userId===u.id));
  useEffect(() => { if(dialog==='manage' && !selected) setDialog(null); }, [accounts,dialog,selected]);
  const run = async (work, success) => {
    setBusy(true);
    try { await work(); await onRefresh(); notify(success); }
    catch (err) { notify(err.message); }
    finally { setBusy(false); }
  };
  const create = e => { e.preventDefault(); run(async()=>{ await api.createAdAccount({platform,name,externalAccountId:externalId}); setDialog(null);setName('');setExternalId('');},'Account ID registered. Configure backend API credentials, then verify'); };
  const assign = e => {e.preventDefault(); if(!employeeId)return;run(async()=>{await api.assignAdAccount(selectedId,employeeId);setEmployeeId('');},'Account assigned to employee');};
  const unassign = userId => run(()=>api.unassignAdAccount(selectedId,userId),'Employee access removed');
  const rename = e => {e.preventDefault();run(async()=>{await api.updateAdAccount(selectedId,{name});setDialog('manage');},'Account name updated');};
  const remove = () => run(async()=>{await api.removeAdAccount(selectedId);setSelectedId(null);setDialog(null);},'Ad account reference removed');
  const open = id => {setSelectedId(id);setDialog('manage');setLive(null);setCampaignResult(null);setHierarchyResult(null);setPerformanceResult(null);setEmployeeId('');};
  const close = () => {if(!busy)setDialog(null);};
  return <>
    <style>{accountStyles}</style>
    <div className="page-heading"><div><div className="eyebrow">SCHOLARSHIPHIVE / AD ACCESS</div><h1>{isAdmin?'Ad Account Management':'My Assigned Ad Accounts'}</h1><p>{isAdmin?'Manage company Meta, Google & TikTok accounts and employee access.':'View spend and performance of accounts your Admin has assigned to you.'}</p></div>
      <div className="heading-action adaccess-actions">
        <button className="adaccess-btn secondary" onClick={refreshList}><RefreshCw size={16}/> Refresh / Request Sync</button>
        {isAdmin&&<button className="adaccess-btn" onClick={()=>{setPlatform('Meta Ads');setName('');setExternalId('');setDialog('create');}}><Plus size={16}/> Register Account</button>}
      </div>
    </div>
    <div className="info-strip"><Clock3 size={18}/><div><strong>Read-only API adapters + 15-minute background sync foundation</strong><small>Verified accounts sync when backend credentials are configured. Open an account to verify, refresh and inspect fetched data. PostgreSQL stores account references and historical advertising data in database mode. Meta/Google/TikTok reporting requires authorized API access.</small></div></div>
    {isAdmin&&hasForeignAccount&&<section className="adaccess-fx"><strong>Currency Conversion — Approved Monthly FX Rates</strong><p className="adaccess-small">For PKR reporting, enter the company's approved rate for each source currency and reporting month. 1 unit of source currency = entered PKR. No guessed exchange rates; original Meta spend stays unchanged. This is a management-reporting rate, not automatically an accounting/settlement rate.</p><form onSubmit={storeFx}><label>From currency<select value={fxCurrency} onChange={e=>setFxCurrency(e.target.value)}>{foreignCurrencies.map(c=><option key={c} value={c}>{c}</option>)}</select></label><label>Month<input required type="month" value={fxMonth} onChange={e=>setFxMonth(e.target.value)}/></label><label>1 {fxCurrency} = PKR<input required type="number" min="0.000001" step="any" placeholder="Approved rate" value={fxValue} onChange={e=>setFxValue(e.target.value)}/></label><label>Rate source / approval<input required minLength={3} maxLength={180} placeholder="e.g. Finance team approved rate" value={fxSource} onChange={e=>setFxSource(e.target.value)}/></label><button disabled={fxBusy} className="adaccess-btn" type="submit">{fxBusy?'Saving...':'Save FX rate'}</button></form><div className="fx-list">{fxRates.length?fxRates.map(x=><div key={`${x.currency}-${x.month}`}>{x.month} · 1 {x.currency} = PKR {Number(x.rate).toLocaleString('en-PK',{maximumFractionDigits:6})} · {x.source}</div>):'No approved FX rates entered. Foreign-currency spend will show PKR conversion pending.'}</div></section>}
    <div className="adaccess-summary"><span className="adaccess-count">{accounts.length} {isAdmin?'company account(s)':'assigned account(s)'}</span>{!isAdmin&&<span className="adaccess-small"><ShieldCheck size={13} style={{verticalAlign:'middle'}}/> Read-only access · Assigned by Admin</span>}</div>
    <div className="account-grid">{accounts.length ? accounts.map((a,i)=><section className="surface-card account-card" key={a.id}>
      <div className="account-head"><div className={'platform-symbol p'+(platforms.indexOf(a.platform)%3)}>{a.platform==='Meta Ads'?'∞':a.platform==='Google Ads'?'G':'♪'}</div><span className={"pill " + (a.integrationStatus === "Synced" ? "pill-green" : "pill-amber")}>{a.integrationStatus||"Not connected"}</span></div>
      <h3>{a.platform}</h3><p>{a.name}</p><p className="adaccess-small">{displayRef('ACC',a.displayNumber)}</p><div className="account-spend">{a.lastSyncedAt&&a.coverage?.complete ? displaySpendPKR(a.metrics,a.currency) : 'Not loaded for period'}<small>{a.lastSyncedAt ? `${a.period?.label||'Selected reporting dates'} · ${sourceCurrencyNote(a.metrics?.spend,a.metrics?.currency||a.currency) ? sourceCurrencyNote(a.metrics?.spend,a.metrics?.currency||a.currency)+' · ' : ''}${fxExplanation(a.metrics)}` : 'Select account for reporting period'}</small></div><div className="account-stats"><div><b>{a.lastSyncedAt ? (a.campaignCount??'—') : '—'}</b><span>Campaigns</span></div><div><b>{a.lastSyncedAt ? (a.metrics?.leads ?? '—') : '—'}</b><span>Leads (if available)</span></div></div>
      {isAdmin&&<p className="adaccess-small"><Users size={13} style={{verticalAlign:'middle'}}/> {a.assignedEmployees?.length||0} employee(s) assigned</p>}
      <button className="card-link" onClick={()=>open(a.id)}>{isAdmin?'Manage & assign':'View details (read only)'} <ArrowUpRight size={16}/></button>
    </section>) : <div className="adaccess-empty"><Link2 size={30}/><strong>{isAdmin?'No ad accounts registered':'No ad accounts assigned'}</strong><p>{isAdmin?'No accounts registered yet. Register an authorized company account ID. Add its API credentials on the backend, verify access, then sync.':'Ask your Admin to assign Meta, Google or TikTok accounts to your user profile.'}</p></div>}</div>
    {dialog && <div className="adaccess-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)close()}}><div className="adaccess-dialog" role="dialog" aria-modal="true" aria-label={dialog==='create'?'Register account reference':'Ad account details'}>
      <div className="adaccess-dialog-head"><div><h2>{dialog==='create'?'Register Ad Account':dialog==='remove'?'Remove Account Reference':dialog==='rename'?'Rename Account':selected?.platform||'Account Details'}</h2><p>{dialog==='create'?'Register the company advertiser/customer ID. Credentials stay on the Express backend.':selected?.name}</p></div><button className="adaccess-btn secondary" onClick={close} disabled={busy} aria-label="Close"><X size={17}/></button></div>
      {dialog==='create'&&isAdmin&&<form className="adaccess-form" onSubmit={create}><label>Platform<select value={platform} onChange={e=>setPlatform(e.target.value)}>{platforms.map(p=><option key={p}>{p}</option>)}</select></label><label>Account display name<input required maxLength={120} value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Scholarshiphive Brand Campaign"/></label><label>Company advertiser / customer ID<input required maxLength={100} value={externalId} onChange={e=>setExternalId(e.target.value)} placeholder="Exact ID provided by company"/></label><div className="adaccess-note">Registering an ID is not a successful connection. Admin must configure authorized API credentials in backend .env and click Verify Connection. Do not enter API tokens here.</div><div className="adaccess-footer"><button type="button" className="adaccess-btn secondary" onClick={close}>Cancel</button><button type="submit" disabled={busy} className="adaccess-btn"><Plus size={15}/> Register Account</button></div></form>}
      {selected&&dialog==='manage'&&<>
        {[['MEA Account Reference',displayRef('ACC',selected.displayNumber)],['Platform Ad Account ID',selected.externalAccountId||'Not provided'],['Platform',selected.platform],['Display Name',selected.name],['Integration',live?.integrationStatus||selected.integrationStatus||'Not connected'],['Credentials configured',live?.credentialsConfigured?'Yes':'No'],['Last verified',live?.lastVerifiedAt?new Date(live.lastVerifiedAt).toLocaleString():'Never'],['Last synced',live?.lastSyncedAt?new Date(live.lastSyncedAt).toLocaleString():'Never'],['Individual Ads',live?.lastSyncedAt?live.adCount:'Awaiting sync'],['Access',isAdmin?'Admin management':'Employee read-only']].map(([k,v])=><div className="adaccess-detail" key={k}><span>{k}</span><b>{v}</b></div>)}
        <div className="adaccess-live"><strong>Live platform status</strong><p>Performance is based on the selected reporting period. Historic ranges require Fetch Selected Period; records are retained if ads disappear from Meta.</p>
          {live?.lastError&&<p style={{color:'#b93d51'}}>Last error: {live.lastError}</p>}{live?.newAdsDetected>0&&<p style={{color:'#126da6',fontWeight:800}}>{live.newAdsDetected} new ad(s) found on last sync!</p>}
          <div className="adaccess-live-grid"><div><small>Ad Spend (PKR)</small><strong>{performanceResult?.coverage?.complete&&performanceResult?.metrics ? showConverted(performanceResult.metrics) : 'Not fetched'}</strong>{sourceCurrencyNote(performanceResult?.metrics?.spend,performanceResult?.metrics?.currency||live?.currency)&&<small>{sourceCurrencyNote(performanceResult.metrics.spend,performanceResult.metrics.currency||live?.currency)}</small>}<small>{fxExplanation(performanceResult?.metrics)}</small></div><div><small>Clicks</small><strong>{performanceResult?.coverage?.complete?performanceResult?.metrics?.clicks??'—':'Not fetched'}</strong></div><div><small>Impressions</small><strong>{performanceResult?.coverage?.complete?performanceResult?.metrics?.impressions??'—':'Not fetched'}</strong></div></div>
          <p style={{fontSize:11}}>Leads and conversions are platform-dependent; unknown values are not displayed as zero. Unavailable means the API stopped returning an ad, not proof it was deleted.</p>
          <div className="adaccess-footer">{isAdmin&&<button className="adaccess-btn secondary" disabled={liveBusy||!selected.externalAccountId} onClick={()=>verifyAccount(selected.id)}><ShieldCheck size={15}/> Verify Connection</button>}
            <button className="adaccess-btn" disabled={liveBusy||!live?.lastVerifiedAt} onClick={()=>syncAccount(selected.id)}><RefreshCw size={15}/> {liveBusy?'Working...':'Fetch Selected Period / Sync Now'}</button></div>
          <div className="adaccess-note">Historical coverage: {performanceResult?.coverage ? `${performanceResult.coverage.coveredDays}/${performanceResult.coverage.totalDays} days` : 'Not fetched'}. {performanceResult?.coverage?.complete?'Selected period fetched.':'Click Fetch Selected Period to import available history.'} · Last sync: {live?.lastSyncedAt ? new Date(live.lastSyncedAt).toLocaleString() : 'Never'}</div><AdHierarchyPanel data={hierarchyResult} currency={live?.currency||performanceResult?.metrics?.currency}/>
        </div>
        {isAdmin&&<><h3 style={{color:'#174b76',margin:'23px 0 6px'}}>Assigned Employees</h3><p>Employees only see accounts explicitly assigned here.</p><div className="adaccess-user-list">{assignedUsers.length?assignedUsers.map(u=><div className="adaccess-user" key={u.userId}><div><strong>{u.userName}</strong><small>{u.email} · {u.userId.slice(0,8)} · {u.status}</small></div><button className="adaccess-btn warn" disabled={busy} onClick={()=>unassign(u.userId)}>Remove Access</button></div>):<p>No employees assigned yet.</p>}</div>
          <form className="adaccess-form" onSubmit={assign}><label>Assign account to active employee<select className="adaccess-select" value={employeeId} onChange={e=>setEmployeeId(e.target.value)} required><option value="">Choose an employee</option>{selectableEmployees.map(u=><option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}</select></label><button className="adaccess-btn" type="submit" disabled={busy||!employeeId}><UserPlus size={15}/> Assign Employee</button></form>
          <div className="adaccess-footer"><button className="adaccess-btn secondary" onClick={()=>{setName(selected.name);setDialog('rename');}}><Pencil size={15}/> Rename</button><button className="adaccess-btn warn" onClick={()=>setDialog('remove')}><Trash2 size={15}/> Remove Account Reference</button></div></>}
        {!isAdmin&&<p className="adaccess-note"><ShieldCheck size={14} style={{verticalAlign:'middle'}}/> You have viewing rights only. To change account configuration or access, contact your Admin.</p>}
      </>}
      {selected&&dialog==='rename'&&isAdmin&&<form className="adaccess-form" onSubmit={rename}><label>Display name<input required maxLength={120} value={name} onChange={e=>setName(e.target.value)}/></label><div className="adaccess-footer"><button type="button" className="adaccess-btn secondary" onClick={()=>setDialog('manage')}>Back</button><button className="adaccess-btn" type="submit" disabled={busy}><Check size={15}/> Save Name</button></div></form>}
      {selected&&dialog==='remove'&&isAdmin&&<><p className="adaccess-note">Removing this account reference will also clear its employee assignments. This does not disconnect a live advertising platform.</p><div className="adaccess-footer"><button className="adaccess-btn secondary" onClick={()=>setDialog('manage')}>Cancel</button><button className="adaccess-btn warn" disabled={busy} onClick={remove}>Confirm Remove</button></div></>}
    </div></div>}
  </>;
}
