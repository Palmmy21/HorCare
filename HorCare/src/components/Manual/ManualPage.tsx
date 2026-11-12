import { useMemo, useState } from 'react';
import { BookOpenText, ChevronDown, ExternalLink, LifeBuoy, Search, Sparkles } from 'lucide-react';
import { MANUAL_CHANGES, MANUAL_GROUPS, searchManual, type ManualSection } from '../../shared/manual';

interface Props {
  /** Open an app screen the section explains; omitted for screens this account cannot open. */
  onOpen?: (view: string) => void;
  /** The screens this account may open (the "open this screen" button is only offered for those). */
  canOpen?: (view: string) => boolean;
}

const card: React.CSSProperties = { background: 'var(--color-white, #fff)', border: '1px solid var(--color-gray-200, #DCE5EF)', borderRadius: 14, padding: '1rem 1.1rem' };

function Section({ s, open, onToggle, onOpen, canOpen }: { s: ManualSection; open: boolean; onToggle: () => void } & Props) {
  const openable = s.view && s.view !== 'manual' && onOpen && (!canOpen || canOpen(s.view));
  return (
    <article id={`manual-${s.id}`} style={{ ...card, padding: 0, overflow: 'hidden' }}>
      <button type="button" onClick={onToggle} aria-expanded={open}
        style={{ width: '100%', display: 'flex', gap: 10, alignItems: 'flex-start', textAlign: 'left', padding: '0.9rem 1.1rem', background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit', font: 'inherit' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: '1rem' }}>{s.title}</div>
          <div style={{ fontSize: '0.85rem', color: 'var(--color-gray-600, #557089)', marginTop: 2 }}>{s.summary}</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--color-gray-500, #6B7F95)', marginTop: 4 }}>สำหรับ: {s.who}</div>
        </div>
        <ChevronDown size={18} style={{ flexShrink: 0, marginTop: 2, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
      </button>
      {open && (
        <div style={{ padding: '0 1.1rem 1rem', display: 'flex', flexDirection: 'column', gap: 14, borderTop: '1px solid var(--color-gray-100, #EEF2F7)' }}>
          {(s.steps ?? []).map(st => (
            <section key={st.title} style={{ marginTop: 12 }}>
              <h4 style={{ margin: '0 0 6px', fontSize: '0.92rem' }}>{st.title}</h4>
              <ol style={{ margin: 0, paddingLeft: '1.3rem', display: 'flex', flexDirection: 'column', gap: 5, lineHeight: 1.55, fontSize: '0.9rem' }}>
                {st.items.map(i => <li key={i}>{i}</li>)}
              </ol>
            </section>
          ))}
          {s.tips && s.tips.length > 0 && (
            <section style={{ background: 'rgba(10,108,194,0.06)', borderRadius: 10, padding: '0.6rem 0.8rem', fontSize: '0.86rem', lineHeight: 1.55, marginTop: s.steps ? 0 : 12 }}>
              <b>💡 เคล็ดลับ</b>
              <ul style={{ margin: '4px 0 0', paddingLeft: '1.2rem' }}>{s.tips.map(t => <li key={t}>{t}</li>)}</ul>
            </section>
          )}
          {s.problems && s.problems.length > 0 && (
            <section style={{ marginTop: s.steps || s.tips ? 0 : 12 }}>
              <h4 style={{ margin: '0 0 6px', fontSize: '0.92rem', display: 'flex', gap: 6, alignItems: 'center' }}><LifeBuoy size={15} /> ถ้าเจอปัญหา</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {s.problems.map(p => (
                  <div key={p.problem} style={{ border: '1px solid #F5C26B', background: '#FFF9EC', borderRadius: 10, padding: '0.6rem 0.8rem', fontSize: '0.86rem', lineHeight: 1.55 }}>
                    <b>{p.problem}</b>
                    <ol style={{ margin: '4px 0 0', paddingLeft: '1.2rem' }}>{p.fix.map(f => <li key={f}>{f}</li>)}</ol>
                  </div>
                ))}
              </div>
            </section>
          )}
          {openable && (
            <div><button type="button" className="btn btn-outline btn-sm" onClick={() => onOpen!(s.view!)} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <ExternalLink size={14} /> เปิดหน้านี้
            </button></div>
          )}
        </div>
      )}
    </article>
  );
}

/** คู่มือการใช้งาน: every screen and every LINE chat, step by step, and what to do when something goes wrong. */
export default function ManualPage({ onOpen, canOpen }: Props) {
  const [query, setQuery] = useState('');
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const found = useMemo(() => searchManual(query), [query]);
  const searching = query.trim() !== '';
  const toggle = (id: string) => setOpenIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const isOpen = (id: string) => searching || openIds.has(id);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: 880 }}>
      <div className="page-header" style={{ marginBottom: 0 }}>
        <h1 className="page-title" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><BookOpenText size={26} /> คู่มือการใช้งาน</h1>
        <p className="page-subtitle">ทำตามได้ทีละขั้น ทุกหน้าจอและทุกปุ่มใน LINE พร้อมวิธีรับมือเมื่อเกิดเหตุไม่คาดคิด</p>
      </div>

      <div style={{ position: 'relative' }}>
        <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-gray-400)' }} />
        <input className="form-input" type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="ค้นหา เช่น สลิป, ขาจร, บอทไม่ตอบ, ตรวจยอด"
          aria-label="ค้นหาในคู่มือ" style={{ width: '100%', paddingLeft: '2.2rem', boxSizing: 'border-box' }} />
      </div>

      {!searching && MANUAL_CHANGES[0] && (
        <div style={{ ...card, borderColor: '#A6E9C0', background: '#F2FCF6' }}>
          <div style={{ fontWeight: 700, display: 'flex', gap: 6, alignItems: 'center' }}><Sparkles size={16} /> มีอะไรใหม่ ({new Date(`${MANUAL_CHANGES[0].date}T00:00:00+07:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })})</div>
          <ul style={{ margin: '6px 0 0', paddingLeft: '1.2rem', fontSize: '0.88rem', lineHeight: 1.6 }}>{MANUAL_CHANGES[0].items.map(i => <li key={i}>{i}</li>)}</ul>
        </div>
      )}

      {!searching && (
        <nav aria-label="หมวดในคู่มือ" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {MANUAL_GROUPS.map(g => <a key={g.id} href={`#manual-group-${g.id}`} className="btn btn-outline btn-sm" style={{ textDecoration: 'none' }}>{g.title}</a>)}
        </nav>
      )}

      {searching ? (
        found.length === 0
          ? <div style={{ ...card, color: 'var(--color-gray-600)' }}>ไม่พบ "{query}" ลองคำอื่น หรือดูหมวด "เมื่อเกิดเหตุไม่คาดคิด"</div>
          : <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{found.map(s => <Section key={s.id} s={s} open onToggle={() => undefined} onOpen={onOpen} canOpen={canOpen} />)}</div>
      ) : MANUAL_GROUPS.map(g => (
        <section key={g.id} id={`manual-group-${g.id}`} style={{ display: 'flex', flexDirection: 'column', gap: 10, scrollMarginTop: 80 }}>
          <h2 style={{ margin: '0.5rem 0 0', fontSize: '1.05rem' }}>{g.title}</h2>
          {found.filter(s => s.group === g.id).map(s => <Section key={s.id} s={s} open={isOpen(s.id)} onToggle={() => toggle(s.id)} onOpen={onOpen} canOpen={canOpen} />)}
        </section>
      ))}

      {!searching && MANUAL_CHANGES.length > 1 && (
        <details style={card}>
          <summary style={{ cursor: 'pointer', fontWeight: 700 }}>ประวัติการเปลี่ยนแปลง</summary>
          {MANUAL_CHANGES.slice(1).map(c => (
            <div key={c.date} style={{ marginTop: 8 }}>
              <b style={{ fontSize: '0.85rem' }}>{c.date}</b>
              <ul style={{ margin: '4px 0 0', paddingLeft: '1.2rem', fontSize: '0.86rem', lineHeight: 1.55 }}>{c.items.map(i => <li key={i}>{i}</li>)}</ul>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
