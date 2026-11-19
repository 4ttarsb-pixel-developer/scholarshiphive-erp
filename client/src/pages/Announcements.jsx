import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Megaphone, Plus, Pin, Link2, Send, Trash2, MessageCircle, Pencil } from 'lucide-react';
import { useAuth, useLoad } from '../lib/auth.jsx';
import { api } from '../lib/api.js';
import { Avatar, Badge, Button, Card, Empty, Field, Input, Loader, Modal, Notice, Textarea, useConfirm, useToast } from '../components/ui.jsx';
import { ago, dateTime } from '../lib/format.js';

export default function Announcements() {
  const [params, setParams] = useSearchParams();
  const [v, setV] = useState(0);
  const [form, setForm] = useState(null);
  const { data, loading, error } = useLoad('/announcements', [v]);
  const openId = params.get('id');
  const setOpen = id => setParams(id ? { id: String(id) } : {});
  return (
    <>
      <div className="page-head">
        <div><h1>Announcements</h1><p>News, links and information from admin. Everyone can read and reply.</p></div>
        <div className="page-actions">{data?.canPost && <Button variant="primary" icon={Plus} onClick={() => setForm({})}>New announcement</Button>}</div>
      </div>
      {error && <Notice type="error">{error.message}</Notice>}
      {!data ? (error ? null : <Loader />) : (
        <Card pad={false}>
          {data.rows.length ? data.rows.map(a => (
            <div key={a.id} className={`ann ${a.is_read ? '' : 'unread'}`} onClick={() => setOpen(a.id)} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && setOpen(a.id)}>
              <Avatar fileId={a.author_photo} name={a.author} size={40} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row" style={{ gap: 8 }}>{a.pinned && <Pin size={14} color="var(--orange)" />}<h4>{a.title}</h4>{!a.is_read && <Badge tone="blue">New</Badge>}</div>
                <p>{a.body}</p>
                <div className="small muted row" style={{ gap: 12, marginTop: 6 }}><span>{a.author || 'Admin'} · {ago(a.created_at)}</span><span className="row" style={{ gap: 4 }}><MessageCircle size={13} />{a.replies}</span>{a.link_url && <span className="row" style={{ gap: 4 }}><Link2 size={13} />Link</span>}</div>
              </div>
            </div>
          )) : <Empty icon={Megaphone} title="No announcements yet">{data.canPost ? 'Post the first one with “New announcement”.' : 'Admin announcements will appear here.'}</Empty>}
        </Card>
      )}
      {openId && <Thread id={openId} onClose={() => { setOpen(null); setV(x => x + 1); }} onEdit={a => { setOpen(null); setForm(a); }} />}
      {form && <AnnouncementForm a={form.id ? form : null} onClose={() => setForm(null)} onSaved={() => { setForm(null); setV(x => x + 1); }} />}
    </>
  );
}

function Thread({ id, onClose, onEdit }) {
  const { user, isAdmin } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { data: a, loading, error, reload } = useLoad(`/announcements/${id}`);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!reply.trim()) return;
    setBusy(true);
    try { await api.post(`/announcements/${id}/replies`, { body: reply }); setReply(''); reload(); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const delAnn = async () => {
    if (!(await confirm({ title: 'Delete announcement?', message: 'All replies are deleted too.', danger: true, ok: 'Delete' }))) return;
    try { await api.del(`/announcements/${id}`); toast.success('Deleted.'); onClose(); } catch (e) { toast.error(e.message); }
  };
  const delReply = async r => {
    if (!(await confirm({ title: 'Delete reply?', message: r.body.slice(0, 120), danger: true, ok: 'Delete' }))) return;
    try { await api.del(`/announcements/replies/${r.id}`); reload(); } catch (e) { toast.error(e.message); }
  };
  const mine = a && (isAdmin || a.created_by === user.id);
  return (
    <Modal open onClose={onClose} drawer title={a?.title || 'Announcement'} subtitle={a ? `${a.author || 'Admin'} · ${dateTime(a.created_at)}` : ''}
      footer={mine && a && <><Button variant="danger" icon={Trash2} onClick={delAnn}>Delete</Button><Button icon={Pencil} onClick={() => onEdit(a)}>Edit</Button></>}>
      {error ? <Notice type="error">{error.message}</Notice> : loading && !a ? <Loader /> : (
        <div className="stack">
          <div className="prose" style={{ whiteSpace: 'pre-wrap', color: 'var(--text)' }}>{a.body}</div>
          {a.link_url && <a className="btn" href={a.link_url} target="_blank" rel="noopener noreferrer"><Link2 />{a.link_label || a.link_url}</a>}
          <div>
            <div className="field-label" style={{ marginBottom: 6 }}>Replies ({a.replies.length})</div>
            {a.replies.map(r => (
              <div key={r.id} className="reply">
                <Avatar fileId={r.photo_file_id} name={r.full_name} size={32} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="small"><b>{r.full_name || 'Deleted user'}</b> <span className="muted">· {ago(r.created_at)}</span>{(isAdmin || r.user_id === user.id) && <button className="btn btn-ghost btn-sm" style={{ float: 'right', padding: 2 }} onClick={() => delReply(r)} aria-label="Delete reply"><Trash2 /></button>}</div>
                  <div className="reply-body">{r.body}</div>
                </div>
              </div>
            ))}
            {!a.replies.length && <div className="muted small">No replies yet.</div>}
          </div>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}><Textarea rows={2} value={reply} onChange={e => setReply(e.target.value)} placeholder="Write a reply…" onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(); }} /></div>
            <Button variant="primary" icon={Send} loading={busy} onClick={send} disabled={!reply.trim()}>Reply</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function AnnouncementForm({ a, onClose, onSaved }) {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const [f, setF] = useState(a ? { title: a.title, body: a.body, link_url: a.link_url || '', link_label: a.link_label || '', pinned: a.pinned } : { title: '', body: '', link_url: '', link_label: '', pinned: false, notify: true });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setErr(''), [f]);
  const save = async () => {
    setBusy(true);
    try {
      if (a) await api.put(`/announcements/${a.id}`, f); else await api.post('/announcements', f);
      toast.success(a ? 'Updated.' : f.notify ? 'Posted and emailed to everyone.' : 'Posted.');
      onSaved();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={a ? 'Edit announcement' : 'New announcement'} size="lg" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon={Send} loading={busy} onClick={save}>{a ? 'Save' : 'Post announcement'}</Button></>}>
      <div className="form">
        {err && <Notice type="error">{err}</Notice>}
        <Field label="Title" required><Input value={f.title} onChange={e => setF(x => ({ ...x, title: e.target.value }))} /></Field>
        <Field label="Message" required><Textarea rows={6} value={f.body} onChange={e => setF(x => ({ ...x, body: e.target.value }))} /></Field>
        <div className="form-grid">
          <Field label="Link (optional)" hint="Full link, e.g. https://drive.google.com/…"><Input value={f.link_url} onChange={e => setF(x => ({ ...x, link_url: e.target.value }))} placeholder="https://" /></Field>
          <Field label="Link text"><Input value={f.link_label} onChange={e => setF(x => ({ ...x, link_label: e.target.value }))} placeholder="e.g. Open the form" /></Field>
        </div>
        {isAdmin && <label className="check"><input type="checkbox" checked={f.pinned} onChange={e => setF(x => ({ ...x, pinned: e.target.checked }))} />Pin to top</label>}
        {!a && <label className="check"><input type="checkbox" checked={f.notify} onChange={e => setF(x => ({ ...x, notify: e.target.checked }))} />Email this announcement to all employees</label>}
      </div>
    </Modal>
  );
}
