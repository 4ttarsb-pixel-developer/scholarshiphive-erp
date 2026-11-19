import { useState } from 'react';
import { Lock, Send } from 'lucide-react';
import { Button, Field, Segmented, Textarea, useToast } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';

export default function Locked({ module, admin }) {
  const { boot } = useAuth();
  const toast = useToast();
  const label = boot?.modules?.find(m => m.key === module)?.label || 'this page';
  const [level, setLevel] = useState('view');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const send = async () => {
    setBusy(true);
    try { await api.post('/requests', { type: 'access', module, level, message: msg }); setSent(true); toast.success('Request sent to admin. You will get an email when it is handled.'); }
    catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="locked-page card card-pad">
      <div className="big-icon"><Lock /></div>
      <h2>Not approved by admin</h2>
      <p className="muted">{admin ? 'Only admins can open Admin Settings.' : `You don't have access to ${label} yet. Admin decides which pages each employee can open.`}</p>
      {!admin && module && !sent && (
        <div className="form" style={{ textAlign: 'left', marginTop: 16 }}>
          <Field label="Access needed"><Segmented value={level} onChange={setLevel} options={[{ value: 'view', label: 'View only' }, { value: 'edit', label: 'View + edit' }]} /></Field>
          <Field label="Message to admin (optional)"><Textarea rows={2} value={msg} onChange={e => setMsg(e.target.value)} placeholder="Why do you need this page?" /></Field>
          <Button variant="primary" icon={Send} loading={busy} onClick={send}>Request access</Button>
        </div>
      )}
      {sent && <p className="strong" style={{ color: 'var(--green)' }}>Request sent ✔</p>}
    </div>
  );
}
