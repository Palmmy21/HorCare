import { erpModules, VIEW_LABELS_TH, type ModuleStyle } from '../../shared/erpModules';

interface Props {
    isMarket: boolean;
    style?: ModuleStyle;
    /** Screens the current user can open (from the sidebar). */
    available: Set<string>;
    onOpen: (view: string) => void;
}

const card: React.CSSProperties = {
    border: '1px solid var(--color-gray-200, #E5E7EB)', borderRadius: 14, padding: '1rem', background: 'var(--color-white, #fff)',
    display: 'flex', flexDirection: 'column', gap: 8,
};

/** The ERP at a glance: each module, its screens, and what is planned next. */
export default function ModulesHome({ isMarket, style = 'monthly', available, onOpen }: Props) {
    return (
        <div style={{ maxWidth: 1000, margin: '0 auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
                <h1 style={{ margin: 0, fontSize: '1.4rem' }}>ERP อสังหาริมทรัพย์</h1>
                <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: 'var(--color-gray-500)' }}>
                    ครอบคลุมงานอสังหาเท่านั้น: ทรัพย์สิน ปล่อยเช่า เรียกเก็บ บัญชี ซ่อมบำรุง และบริการลูกบ้าน
                </p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.75rem' }}>
                {erpModules(isMarket, style).map(m => {
                    const open = m.views.filter(v => available.has(v));
                    if (open.length === 0) return null; // a module the user has no screen in is not shown
                    return (
                        <section key={m.id} style={card}>
                            <h2 style={{ margin: 0, fontSize: '1.05rem' }}>{m.label}</h2>
                            <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--color-gray-500)' }}>{m.purpose}</p>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                {open.map(v => <button key={v} className="btn btn-outline btn-sm" onClick={() => onOpen(v)}>{VIEW_LABELS_TH[v] ?? v}</button>)}
                            </div>
                            {m.planned.length > 0 && (
                                <div style={{ fontSize: '0.75rem', color: 'var(--color-gray-500)' }}>
                                    เร็วๆ นี้: {m.planned.join(' · ')}
                                </div>
                            )}
                        </section>
                    );
                })}
            </div>
        </div>
    );
}
