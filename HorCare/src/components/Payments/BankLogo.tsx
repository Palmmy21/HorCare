import { useState } from 'react';
import { bankByShort, bankLogoUrl } from '../../shared/banks';

/**
 * Bank logo. Loaded from a public CDN; if it can't load (offline, blocked, unknown bank) a
 * coloured badge with the bank's short code is shown instead, so the UI never has a broken image.
 */
export default function BankLogo({ short, size = 32 }: { short: string | null | undefined; size?: number }) {
    const bank = bankByShort(short);
    const [failed, setFailed] = useState(false);
    const box: React.CSSProperties = {
        width: size, height: size, borderRadius: Math.round(size * 0.28), flexShrink: 0, overflow: 'hidden',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    };

    if (!bank || failed) {
        const label = (short ?? '?').slice(0, 4);
        return (
            <span aria-label={bank?.name_th ?? short ?? 'ธนาคาร'} style={{
                ...box, background: bank?.color ?? '#6B7280', color: '#fff', fontWeight: 800,
                fontSize: Math.max(8, Math.round(size * (label.length > 3 ? 0.26 : 0.32))),
            }}>{label}</span>
        );
    }
    return (
        <span style={{ ...box, background: '#fff', border: '1px solid rgba(0,0,0,0.08)' }}>
            <img
                src={bankLogoUrl(bank.short)} alt={bank.name_th} loading="lazy"
                onError={() => setFailed(true)}
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            />
        </span>
    );
}
