// Owner Information — portfolio-style profile (hero with photo, about with Skills / Experience / Education tabs,
// services, work gallery, contact + social accounts). Admin / owner fills it through "Add information".
import { useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Trash2, UserSquare2, Download, ExternalLink, Mail, Phone, MapPin, Building2, Sparkles, Briefcase, GraduationCap, Award, Image as ImageIcon, Link2, Hash, CalendarDays, Globe, Quote, ArrowRight } from 'lucide-react';
import { useAuth, useLoad } from '../lib/auth.jsx';
import { api, fileUrl } from '../lib/api.js';
import { Button, Empty, Field, FileInput, Input, Loader, Modal, Notice, Select, Textarea, useConfirm, useToast } from '../components/ui.jsx';
import { PLATFORMS, SocialBadge, SocialGlyph } from '../components/SocialIcons.jsx';
import { dateTime, initials } from '../lib/format.js';

// "Select a field, then enter its data"
const SINGLE = {
  owner_name: { label: 'Owner name', group: 'Profile' }, designation: { label: 'Designation', group: 'Profile', ph: 'e.g. Founder & CEO' },
  headline: { label: 'Headline / tagline', group: 'Profile', ph: 'e.g. Helping students study abroad since 2018' }, intro: { label: 'Short intro (hero text)', group: 'Profile', area: true },
  about: { label: 'About', group: 'Profile', area: true, rows: 6 }, photo_file_id: { label: 'Profile photo', group: 'Profile', file: 'photo' }, cv_file_id: { label: 'CV / profile (PDF)', group: 'Profile', file: 'cv' },
  portfolio_url: { label: 'Portfolio website', group: 'Links', ph: 'https://yourportfolio.netlify.app' }, website: { label: 'Company website', group: 'Links', ph: 'https://scholarshiphive.com' },
  company_name: { label: 'Company name', group: 'Company' }, email: { label: 'Email', group: 'Contact', type: 'email' }, phone: { label: 'Phone', group: 'Contact', type: 'tel' },
  whatsapp: { label: 'WhatsApp number', group: 'Contact', type: 'tel' }, address: { label: 'Office address', group: 'Contact' },
  registration_no: { label: 'Registration no. (SECP)', group: 'Company' }, ntn: { label: 'NTN', group: 'Company' }, founded: { label: 'Founded', group: 'Company', ph: 'e.g. 2018' },
};
const LISTS = {
  socials: { label: 'Social media account', group: 'Links' },
  skills: { label: 'Skill', group: 'About tabs', fields: [['name', 'Skill', true], ['level', 'Level % (optional)', false, 'number']] },
  experience: { label: 'Experience', group: 'About tabs', fields: [['title', 'Role / title', true], ['org', 'Company / organisation'], ['period', 'Period', false, 'text', 'e.g. 2020 – Present'], ['detail', 'Details', false, 'area']] },
  education: { label: 'Education', group: 'About tabs', fields: [['title', 'Degree / course', true], ['institute', 'Institute'], ['period', 'Period', false, 'text', 'e.g. 2014 – 2018']] },
  services: { label: 'Service', group: 'Sections', fields: [['title', 'Service', true], ['description', 'Description', false, 'area'], ['link', 'Link (optional)', false, 'url']] },
  work: { label: 'Work / gallery item', group: 'Sections', fields: [['title', 'Title', true], ['description', 'Description', false, 'area'], ['link', 'Link (optional)', false, 'url'], ['image_file_id', 'Image', false, 'image']] },
  extra: { label: 'Extra field', group: 'Company', fields: [['label', 'Label', true], ['value', 'Value', true]] },
};

function usePoppins() {
  useEffect(() => {
    if (document.getElementById('pf-font')) return;
    const l = document.createElement('link'); l.id = 'pf-font'; l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&display=swap';
    document.head.appendChild(l);
  }, []);
}

export default function OwnerInfo() {
  usePoppins();
  const { isAdmin } = useAuth();
  const [v, setV] = useState(0);
  const [picker, setPicker] = useState(null); // { section, index }
  const [tab, setTab] = useState('skills');
  const { data, error } = useLoad('/owner', [v]);
  const confirm = useConfirm();
  const toast = useToast();
  if (!data) return error ? <Notice type="error">{error.message}</Notice> : <Loader />;
  const info = data.info || {};
  const reload = () => setV(x => x + 1);
  const remove = async (section, index, label) => {
    if (!(await confirm({ title: 'Remove this item?', message: label, danger: true, ok: 'Remove' }))) return;
    try { await api.del(`/owner/item?section=${section}${index !== undefined ? `&index=${index}` : ''}`); toast.success('Removed.'); reload(); } catch (e) { toast.error(e.message); }
  };
  const has = k => Array.isArray(info[k]) && info[k].length > 0;
  const empty = !info.owner_name && !info.about && !has('socials') && !has('skills') && !info.photo_file_id && !info.company_name;
  const Edit = ({ section, index, label }) => (isAdmin ? (
    <span className="pf-edit">
      <button type="button" onClick={() => setPicker({ section, index })} aria-label="Edit" title="Edit"><Pencil size={13} /></button>
      <button type="button" onClick={() => remove(section, index, label)} aria-label="Remove" title="Remove"><Trash2 size={13} /></button>
    </span>
  ) : null);
  const aboutTabs = [['skills', 'Skills', has('skills')], ['experience', 'Experience', has('experience')], ['education', 'Education', has('education')]].filter(t => t[2] || isAdmin);
  const activeTab = aboutTabs.find(t => t[0] === tab) ? tab : aboutTabs[0]?.[0];

  return (
    <>
      <div className="page-head">
        <div><h1>Owner Information</h1><p>Owner profile, company details and social media accounts.{data.updated_at ? ` Updated ${dateTime(data.updated_at)}` : ''}</p></div>
        <div className="page-actions">{isAdmin && <Button variant="primary" icon={Plus} onClick={() => setPicker({})}>Add information</Button>}</div>
      </div>
      {empty && !isAdmin ? <div className="card"><Empty icon={UserSquare2} title="No information added yet">Admin has not added owner information yet.</Empty></div> : (
        <div className="pf">
          {/* ── Hero ── */}
          <section className="pf-hero">
            <div className="pf-hero-text">
              <p className="pf-kicker">{info.designation || 'Owner'}{info.company_name ? ` · ${info.company_name}` : ''}{isAdmin && <Edit section="designation" label="Designation" />}</p>
              <h2 className="pf-title">Hi, I'm <span data-no-translate>{info.owner_name || 'Your name'}</span>{isAdmin && <Edit section="owner_name" label="Owner name" />}<br /><small data-no-translate>{info.headline || (isAdmin ? 'Add a headline / tagline' : '')}</small></h2>
              {info.intro && <p className="pf-intro" data-no-translate>{info.intro}</p>}
              <div className="pf-cta">
                {info.cv_file_id && <a className="pf-btn" href={fileUrl(info.cv_file_id, true)}><Download size={16} />Download CV</a>}
                {info.portfolio_url && <a className="pf-btn ghost" href={info.portfolio_url} target="_blank" rel="noopener noreferrer"><ExternalLink size={16} />View portfolio</a>}
                {info.website && <a className="pf-btn ghost" href={info.website} target="_blank" rel="noopener noreferrer"><Globe size={16} />Website</a>}
              </div>
              {has('socials') && <div className="pf-social-row">{info.socials.map(s => <a key={s.platform} href={s.url} target="_blank" rel="noopener noreferrer" title={PLATFORMS[s.platform]?.label} aria-label={PLATFORMS[s.platform]?.label}><SocialBadge platform={s.platform} size={38} /></a>)}</div>}
            </div>
            <div className="pf-photo">
              {info.photo_file_id ? <img src={fileUrl(info.photo_file_id)} alt={info.owner_name || 'Owner'} /> : <span className="pf-initials">{initials(info.owner_name || 'Owner')}</span>}
              {isAdmin && <button type="button" className="pf-photo-btn" onClick={() => setPicker({ section: 'photo_file_id' })}><ImageIcon size={15} />{info.photo_file_id ? 'Change photo' : 'Add photo'}</button>}
            </div>
          </section>

          {/* ── About ── */}
          {(info.about || aboutTabs.length > 0) && (
            <section className="pf-section pf-about">
              <h3 className="pf-h">About Me{isAdmin && <Edit section="about" label="About" />}</h3>
              {info.about ? <p className="pf-text" data-no-translate>{info.about}</p> : isAdmin && <p className="pf-muted">Add an “About” text with “Add information”.</p>}
              {aboutTabs.length > 0 && <>
                <div className="pf-tabs" role="tablist">{aboutTabs.map(([k, l]) => <button key={k} role="tab" aria-selected={activeTab === k} className={activeTab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
                <ul className="pf-list">
                  {(info[activeTab] || []).map((x, i) => (
                    <li key={i}>
                      {activeTab === 'skills' ? <><b data-no-translate>{x.name}</b>{x.level ? <span className="pf-bar"><i style={{ width: `${x.level}%` }} /></span> : null}</>
                        : <><span className="pf-period" data-no-translate>{x.period}</span><b data-no-translate>{x.title}</b><span data-no-translate>{activeTab === 'experience' ? x.org : x.institute}</span>{x.detail && <small data-no-translate>{x.detail}</small>}</>}
                      <Edit section={activeTab} index={i} label={x.name || x.title} />
                    </li>
                  ))}
                  {!(info[activeTab] || []).length && <li className="pf-muted">Nothing added yet.</li>}
                </ul>
              </>}
            </section>
          )}

          {/* ── Services ── */}
          {(has('services') || isAdmin) && (
            <section className="pf-section">
              <h3 className="pf-h">My Services</h3>
              <div className="pf-services">
                {(info.services || []).map((s, i) => (
                  <div key={i} className="pf-service">
                    <Sparkles className="pf-ico" />
                    <h4 data-no-translate>{s.title}</h4>
                    {s.description && <p data-no-translate>{s.description}</p>}
                    {s.link && <a href={s.link} target="_blank" rel="noopener noreferrer">Learn more <ArrowRight size={14} /></a>}
                    <Edit section="services" index={i} label={s.title} />
                  </div>
                ))}
                {isAdmin && <button type="button" className="pf-service add" onClick={() => setPicker({ section: 'services' })}><Plus />Add service</button>}
              </div>
            </section>
          )}

          {/* ── Work ── */}
          {(has('work') || isAdmin) && (
            <section className="pf-section">
              <h3 className="pf-h">My Work</h3>
              <div className="pf-work">
                {(info.work || []).map((w, i) => (
                  <div key={i} className="pf-work-item">
                    {w.image_file_id ? <img src={fileUrl(w.image_file_id)} alt={w.title} loading="lazy" /> : <div className="pf-work-ph"><ImageIcon /></div>}
                    <div className="pf-layer">
                      <h4 data-no-translate>{w.title}</h4>
                      {w.description && <p data-no-translate>{w.description}</p>}
                      {w.link && <a href={w.link} target="_blank" rel="noopener noreferrer" aria-label="Open link"><ExternalLink size={16} /></a>}
                    </div>
                    <Edit section="work" index={i} label={w.title} />
                  </div>
                ))}
                {isAdmin && <button type="button" className="pf-work-item add" onClick={() => setPicker({ section: 'work' })}><Plus />Add work / image</button>}
              </div>
              {info.portfolio_url && <div style={{ textAlign: 'center', marginTop: 22 }}><a className="pf-btn" href={info.portfolio_url} target="_blank" rel="noopener noreferrer">See more</a></div>}
            </section>
          )}

          {/* ── Contact ── */}
          <section className="pf-section pf-contact">
            <div>
              <h3 className="pf-h">Contact</h3>
              {info.email && <p className="pf-line"><Mail size={18} /><a href={`mailto:${info.email}`} data-no-translate>{info.email}</a><Edit section="email" label="Email" /></p>}
              {info.phone && <p className="pf-line"><Phone size={18} /><a href={`tel:${info.phone}`} dir="ltr" data-no-translate>{info.phone}</a><Edit section="phone" label="Phone" /></p>}
              {info.whatsapp && <p className="pf-line"><SocialGlyph platform="whatsapp" size={18} /><a href={`https://wa.me/${info.whatsapp.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer" dir="ltr" data-no-translate>{info.whatsapp}</a><Edit section="whatsapp" label="WhatsApp" /></p>}
              {info.address && <p className="pf-line"><MapPin size={18} /><span data-no-translate>{info.address}</span><Edit section="address" label="Address" /></p>}
              {info.cv_file_id && <a className="pf-btn" style={{ marginTop: 10 }} href={fileUrl(info.cv_file_id, true)}><Download size={16} />Download CV</a>}
              <div className="pf-company">
                {[['company_name', Building2, 'Company'], ['registration_no', Hash, 'Registration no. (SECP)'], ['ntn', Hash, 'NTN'], ['founded', CalendarDays, 'Founded']].filter(([k]) => info[k]).map(([k, I, l]) => (
                  <div key={k}><I size={15} /><span>{l}</span><b data-no-translate>{info[k]}</b><Edit section={k} label={l} /></div>
                ))}
                {(info.extra || []).map((x, i) => <div key={`x${i}`}><Award size={15} /><span data-no-translate>{x.label}</span><b data-no-translate>{x.value}</b><Edit section="extra" index={i} label={x.label} /></div>)}
              </div>
            </div>
            <div>
              <h3 className="pf-h small">Social media</h3>
              {has('socials') ? (
                <div className="pf-socials">
                  {info.socials.map((s, i) => (
                    <div key={s.platform} className="pf-soc">
                      <a href={s.url} target="_blank" rel="noopener noreferrer"><SocialBadge platform={s.platform} size={40} /><span><b>{PLATFORMS[s.platform]?.label || s.platform}</b><small dir="ltr" data-no-translate>{s.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</small></span></a>
                      <Edit section="socials" index={i} label={PLATFORMS[s.platform]?.label} />
                    </div>
                  ))}
                </div>
              ) : <p className="pf-muted">{isAdmin ? 'Add the owner’s social media accounts so employees can follow them.' : 'No social accounts added.'}</p>}
              {isAdmin && <button type="button" className="pf-btn ghost" style={{ marginTop: 12 }} onClick={() => setPicker({ section: 'socials' })}><Plus size={16} />Add social account</button>}
            </div>
          </section>
          {info.headline && <div className="pf-quote"><Quote size={18} /><span data-no-translate>{info.headline}</span></div>}
        </div>
      )}
      {picker && <InfoPicker info={info} preset={picker} onClose={() => setPicker(null)} onSaved={() => { setPicker(null); reload(); }} />}
    </>
  );
}

/** One form for everything: choose the field → its inputs appear → saved into that section of the page. */
function InfoPicker({ info, preset, onClose, onSaved }) {
  const toast = useToast();
  const [section, setSection] = useState(preset.section || '');
  const editIndex = preset.index;
  const existing = editIndex !== undefined ? (info[section] || [])[editIndex] : undefined;
  const [value, setValue] = useState(() => (preset.section && SINGLE[preset.section] && !SINGLE[preset.section].file ? info[preset.section] || '' : ''));
  const [data, setData] = useState(() => existing ? { ...existing } : {});
  const [file, setFile] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const used = new Set((info.socials || []).map(s => s.platform).filter((p, i) => !(section === 'socials' && i === editIndex)));
  const options = useMemo(() => {
    const groups = {};
    for (const [k, d] of [...Object.entries(SINGLE), ...Object.entries(LISTS)]) (groups[d.group] ||= []).push({ value: k, label: d.label, hint: d.group });
    return Object.values(groups).flat();
  }, []);
  const pick = k => { setSection(k); setErr(''); setFile(null); setData({}); setValue(SINGLE[k] && !SINGLE[k].file ? info[k] || '' : ''); };
  const conf = SINGLE[section] || LISTS[section];

  const save = async () => {
    setErr('');
    if (!section) return setErr('Choose which field you want to fill.');
    setBusy(true);
    try {
      if (SINGLE[section]) {
        let v = value;
        if (SINGLE[section].file) {
          if (!file) throw new Error('Choose a file to upload.');
          const up = await api.upload('/owner/upload', { kind: SINGLE[section].file, file });
          v = up.id;
        } else if (!String(v).trim()) throw new Error(`Enter the ${SINGLE[section].label.toLowerCase()}.`);
        await api.post('/owner/item', { section, value: v });
      } else {
        const d = { ...data };
        if (section === 'socials') {
          if (!d.platform) throw new Error('Choose the social platform.');
          if (!String(d.url || '').trim()) throw new Error('Enter the profile link.');
        } else {
          for (const [k, l, req] of LISTS[section].fields) if (req && !String(d[k] || '').trim()) throw new Error(`${l} is required.`);
          if (d.level !== undefined && d.level !== '' && !(Number(d.level) >= 1 && Number(d.level) <= 100)) throw new Error('Level must be between 1 and 100.');
        }
        if (section === 'work' && file) { const up = await api.upload('/owner/upload', { kind: 'image', file }); d.image_file_id = up.id; }
        await api.post('/owner/item', { section, data: d, index: editIndex });
      }
      toast.success('Saved — it now shows on the Owner Information page.');
      onSaved();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title={editIndex !== undefined ? `Edit ${conf?.label?.toLowerCase()}` : 'Add information'} subtitle="Choose a field, then enter its details. It appears in that part of the page." size="lg"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save</Button></>}>
      <div className="form">
        {err && <Notice type="error">{err}</Notice>}
        <Field label="Field" required><Select value={section} onChange={pick} options={options} searchable placeholder="Choose a field…" disabled={editIndex !== undefined} /></Field>
        {SINGLE[section] && !SINGLE[section].file && (
          <Field label={SINGLE[section].label} required>
            {SINGLE[section].area ? <Textarea rows={SINGLE[section].rows || 3} maxLength={section === 'about' ? 4000 : 600} value={value} onChange={e => setValue(e.target.value)} placeholder={SINGLE[section].ph} autoFocus />
              : <Input type={SINGLE[section].type || 'text'} maxLength={300} value={value} onChange={e => setValue(e.target.value)} placeholder={SINGLE[section].ph} autoFocus />}
          </Field>
        )}
        {SINGLE[section]?.file && (
          <Field label={SINGLE[section].label} required hint={SINGLE[section].file === 'cv' ? 'PDF up to 3 MB' : 'JPG, PNG or WEBP up to 3 MB · at least 200 × 200 px'}>
            <FileInput file={file} onChange={setFile} accept={SINGLE[section].file === 'cv' ? 'application/pdf' : 'image/jpeg,image/png,image/webp'} image={SINGLE[section].file !== 'cv'} label={info[section] ? 'Choose a new file to replace the current one' : 'Choose file'} />
          </Field>
        )}
        {section === 'socials' && (
          <div className="form-grid">
            <Field label="Platform" required>
              <Select value={data.platform || ''} onChange={p => setData(d => ({ ...d, platform: p }))} searchable placeholder="Choose platform…"
                options={Object.entries(PLATFORMS).filter(([k]) => !used.has(k)).map(([k, p]) => ({ value: k, label: p.label }))}
                renderOption={o => <span className="row" style={{ gap: 8 }}><SocialGlyph platform={o.value} size={16} />{o.label}</span>} />
            </Field>
            <Field label="Profile link" required hint={data.platform ? `e.g. ${PLATFORMS[data.platform]?.placeholder}` : 'Choose the platform first'}>
              <Input value={data.url || ''} onChange={e => setData(d => ({ ...d, url: e.target.value }))} placeholder={data.platform ? PLATFORMS[data.platform]?.placeholder : ''} maxLength={300} dir="ltr" />
            </Field>
            {data.platform && <div className="row" style={{ gap: 10 }}><SocialBadge platform={data.platform} size={44} /><span className="small muted">This icon shows on the page with the link.</span></div>}
          </div>
        )}
        {LISTS[section]?.fields && (
          <div className="form-grid">
            {LISTS[section].fields.map(([k, l, req, type, ph]) => (
              type === 'image' ? (
                <Field key={k} label={l} full hint="JPG, PNG or WEBP up to 3 MB">
                  <FileInput file={file} onChange={setFile} accept="image/jpeg,image/png,image/webp" image label={data.image_file_id ? 'Choose a new image to replace the current one' : 'Choose image'} />
                </Field>
              ) : (
                <Field key={k} label={l} required={req} full={type === 'area'}>
                  {type === 'area' ? <Textarea rows={3} maxLength={500} value={data[k] || ''} onChange={e => setData(d => ({ ...d, [k]: e.target.value }))} />
                    : <Input type={type === 'number' ? 'text' : type === 'url' ? 'url' : 'text'} inputMode={type === 'number' ? 'numeric' : undefined} value={data[k] ?? ''} placeholder={ph || (type === 'url' ? 'https://' : '')}
                      onChange={e => setData(d => ({ ...d, [k]: type === 'number' ? e.target.value.replace(/\D/g, '').slice(0, 3) : e.target.value }))} maxLength={type === 'url' ? 300 : 120} />}
                </Field>
              )
            ))}
          </div>
        )}
        {!section && <Notice type="info">Example: choose “Social media account”, pick Instagram, paste the link — the Instagram icon and link appear on the page for every employee.</Notice>}
      </div>
    </Modal>
  );
}
