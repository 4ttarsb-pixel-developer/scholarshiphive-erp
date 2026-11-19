import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, downloadFile, qs } from '../api.js';
import { Card, ErrorBox, Field, Header, Loading, Table } from '../components/ui.jsx';
import { dateTime } from '../format.js';

export default function Audit() {
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const q = useQuery({ queryKey: ['audit', applied], queryFn: () => api.get(`/api/audit${qs({ search: applied, limit: 1000 })}`) });
  return (
    <>
      <Header overline="Administration / audit" title="Activity & audit history" subtitle="Trace salary, attendance, commission, approval and policy changes. Stored append-only in PostgreSQL.">
        <button className="btn outline sm" onClick={() => downloadFile('/api/audit/export', 'audit_log.csv')}>Export audit CSV</button>
      </Header>
      <ErrorBox error={q.error} />
      <Card title="Chronological activity" sub="The database rejects edits or deletion of audit entries.">
        <form className="controls" onSubmit={(e) => { e.preventDefault(); setApplied(search); }}>
          <Field label="Search" grow><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Action, person or detail" /></Field>
          <button className="btn" type="submit">Search</button>
          <button className="btn outline" type="button" onClick={() => { setSearch(''); setApplied(''); }}>Clear</button>
        </form>
        {q.isLoading ? <Loading /> : (
          <Table heads={['Time', 'Performed by', 'Action', 'Record', 'Details']}>
            {(q.data || []).map((a) => (
              <tr key={a.id}><td className="nowrap">{dateTime(a.created_at)}</td><td>{a.actor_name || 'System'}</td><td><b>{a.action}</b></td>
                <td className="tiny">{a.entity_type ? `${a.entity_type} #${a.entity_id}` : '—'}</td><td style={{ whiteSpace: 'normal', minWidth: 300 }}>{a.detail}</td></tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
