import { Crown, Users } from 'lucide-react';
import type { Membership } from '../../hooks/useMembership';
import { ROLE_LABELS_TH } from '../../shared/permissions';
import './WorkspaceSwitcher.css';

interface WorkspaceSwitcherProps {
  teams: Membership[];
  hasOwn: boolean;
  /** owner uid of the team being worked in, or null for the person's own account */
  activeOwnerUid: string | null;
  onChoose: (ownerUid: string | null) => void;
  /** 'cards' on the branch page, 'select' in the dark sidebar */
  variant?: 'cards' | 'select';
}

const roleLabel = (m: Membership) => ROLE_LABELS_TH[m.role as keyof typeof ROLE_LABELS_TH] ?? 'ทีมงาน';
const teamName = (m: Membership) => `ทีมงานของ ${m.owner_name || 'เจ้าของ'}`;

/** Switch between the person's own account and the teams they were added to. Shown only when there is a choice. */
export default function WorkspaceSwitcher({ teams, hasOwn, activeOwnerUid, onChoose, variant = 'cards' }: WorkspaceSwitcherProps) {
  if (teams.length + (hasOwn ? 1 : 0) < 2) return null;

  if (variant === 'select') {
    return (
      <label className="ws-select">
        <span>ทำงานในบัญชี</span>
        <select value={activeOwnerUid ?? ''} onChange={e => onChoose(e.target.value || null)}>
          {hasOwn && <option value="">บัญชีของฉัน (เจ้าของ)</option>}
          {teams.map(t => <option key={t.owner_uid} value={t.owner_uid}>{teamName(t)} · {roleLabel(t)}</option>)}
        </select>
      </label>
    );
  }

  return (
    <nav className="ws-cards" aria-label="เลือกบัญชีที่จะทำงาน">
      {hasOwn && (
        <button type="button" className={`ws-card ${activeOwnerUid === null ? 'is-on' : ''}`} aria-pressed={activeOwnerUid === null} onClick={() => onChoose(null)}>
          <Crown size={16} aria-hidden />
          <span className="ws-card-text"><strong>บัญชีของฉัน</strong><small>สาขาที่คุณเป็นเจ้าของ</small></span>
        </button>
      )}
      {teams.map(t => (
        <button key={t.owner_uid} type="button" className={`ws-card ${activeOwnerUid === t.owner_uid ? 'is-on' : ''}`} aria-pressed={activeOwnerUid === t.owner_uid} onClick={() => onChoose(t.owner_uid)}>
          <Users size={16} aria-hidden />
          <span className="ws-card-text"><strong>{teamName(t)}</strong><small>{roleLabel(t)}</small></span>
        </button>
      ))}
    </nav>
  );
}
