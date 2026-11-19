import React,{useEffect,useState} from 'react';
import { UploadCloud,Download,Trash2,FileCheck2,Send,CheckCircle2,XCircle,ShieldCheck,RefreshCw,FileText } from 'lucide-react';
import {api,downloadDocument} from '../api/client.jsx';
const MAX=2*1024*1024;
async function base64File(file){
  const bytes=new Uint8Array(await file.arrayBuffer());
  let binary='';const n=16384;
  for(let i=0;i<bytes.length;i+=n)binary+=String.fromCharCode(...bytes.subarray(i,i+n));
  return btoa(binary);
}
export default function ExpenseAuditPanel({expense,currentUser,canEdit=true,onChanged}){
  const [docs,setDocs]=useState([]),[events,setEvents]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[reason,setReason]=useState('');
  const isAdmin=currentUser.role==='Admin';
  const canUpload=canEdit&&expense.status==='Pending';
  async function reload(){const [files,hist]=await Promise.all([api.expenseDocuments(expense.id),api.expenseHistory(expense.id)]);setDocs(files);setEvents(hist)}
  useEffect(()=>{let alive=true;Promise.all([api.expenseDocuments(expense.id),api.expenseHistory(expense.id)]).then(([files,hist])=>{if(alive){setDocs(files);setEvents(hist)}}).catch(e=>{if(alive)setError(e.message)});return()=>{alive=false}},[expense.id]);
  async function act(fn,success){setBusy(true);setError('');setMessage('');try{await fn();await reload();await onChanged();setMessage(success)}catch(e){setError(e.message)}finally{setBusy(false)}}
  async function upload(slot,file){
    if(!file)return;
    if(file.size>MAX){setError('Max file size: 2 MB per document');return}
    if(!['application/pdf','image/jpeg','image/png'].includes(file.type)){setError('Only PDF, JPG and PNG files allowed');return}
    await act(async()=>api.uploadDocument(expense.id,{slot,name:file.name,mimeType:file.type,dataBase64:await base64File(file)}),`Document ${slot} uploaded`);
  }
  const slots=[1,2,3];
  return <div className="mea-audit-panel">
    <div className="mea-audit-head"><div><strong>Supporting documents</strong><p>Upload all 3 documents before submitting for Admin review. PDF, JPG, PNG · 2 MB each.</p></div><span className="mea-audit-counter">{docs.length}/3 uploaded</span></div>
    <div className="mea-document-grid">{slots.map(slot=>{const doc=docs.find(d=>d.slot===slot);return <div className="mea-document-slot" key={slot}>
      <div className="mea-document-title"><FileText size={18}/><b>Document {slot}</b><span className={doc?'mea-ready':'mea-needed'}>{doc?'Uploaded':'Required'}</span></div>
      {doc?<><div className="mea-document-name" title={doc.name}>{doc.name}</div><small>{Math.ceil(doc.size/1024)} KB · {doc.uploadedBy}</small><div className="mea-doc-actions"><button type="button" disabled={busy} onClick={()=>act(()=>downloadDocument(expense.id,slot),'Document downloaded')}><Download size={14}/> Download</button>{canUpload&&<button type="button" disabled={busy} onClick={()=>act(()=>api.removeDocument(expense.id,slot),'Document removed')}><Trash2 size={14}/> Remove</button>}</div></>:<p className="mea-document-empty">No file selected</p>}
      {canUpload&&<label className="mea-file-picker"><UploadCloud size={15}/>{doc?'Replace document':'Choose document'}<input aria-label={`Upload document ${slot}`} type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" disabled={busy} onChange={e=>{const f=e.target.files?.[0];e.target.value='';upload(slot,f)}}/></label>}
    </div>})}</div>
    {canUpload&&<div className="mea-review-actions"><button type="button" className="mea-action-primary" disabled={busy||docs.length!==3} onClick={()=>act(()=>api.submitExpense(expense.id),'Expense submitted to Admin for review')}><Send size={16}/> Submit for review</button>{docs.length!==3&&<span>Upload {3-docs.length} remaining document(s) to submit.</span>}</div>}
    {isAdmin&&expense.status==='In Review'&&<div className="mea-admin-review"><div className="mea-audit-head"><div><strong><ShieldCheck size={16}/> Admin decision</strong><p>Review all three documents before approving or rejecting.</p></div></div><label>Reason for rejection (required only when rejecting)<textarea value={reason} maxLength={500} onChange={e=>setReason(e.target.value)} placeholder="Explain why this expense is rejected..." rows={2}/></label><div className="mea-review-actions"><button type="button" disabled={busy||docs.length!==3} className="mea-action-primary" onClick={()=>act(()=>api.auditDecision(expense.id,'approve'),'Expense approved')}><CheckCircle2 size={16}/> Approve</button><button type="button" disabled={busy||reason.trim().length<3} className="mea-action-reject" onClick={()=>act(()=>api.auditDecision(expense.id,'reject',reason),'Expense rejected')}><XCircle size={16}/> Reject</button></div></div>}
    {expense.status==='Approved'&&<div className="mea-confirmed">Approved by Admin · Documents locked</div>}
    {expense.status==='Rejected'&&<div className="mea-rejected">Rejected by Admin · See audit history below</div>}
    {expense.status==='In Review'&&!isAdmin&&<div className="mea-confirmed">Submitted for Admin review · Documents locked</div>}
    {error&&<p role="alert" className="mea-error">{error}</p>}{message&&<p role="status" className="mea-message">{message}</p>}
    <div className="mea-audit-history"><strong>Verification history</strong>{events.length?events.map(evt=><p key={evt.id}><span>{evt.action.replace(/_/g,' ').toUpperCase()}</span> — {evt.reviewer} · {new Date(evt.at).toLocaleString()}{evt.note?` · ${evt.note}`:''}</p>):<p>No actions recorded yet.</p>}</div>
  </div>
}
