import { useState, useEffect } from 'react';
import horcareLogo from '../../assets/horcare_logo.png';
import { ClipboardList, AlertTriangle, Building2, Smartphone, CheckCircle2, Hourglass, Wrench, Sparkles } from 'lucide-react';
import { JOIN_TITLES_TH, isLiffId, type JoinKind } from '../../shared/joinCodes';

interface JoinResponse {
  kind: JoinKind; ok: boolean; outcome?: string; message: string; place?: string;
  room_number?: string; current_rooms?: string[]; add_friend_url?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface Window { liff: any; }
}

type GatewayState =
  | { status: 'loading' }
  | { status: 'redirecting'; roomNumber: string; dormName: string }
  | { status: 'not_registered' }
  | { status: 'no_liff' }
  | { status: 'room_result'; ok: boolean; title: string; message: string; addFriendUrl?: string }
  /** This LINE account looks after several rooms: which portal? */
  | { status: 'pick_room'; rooms: { portal: string; room_number: string; dorm_name: string }[] }
  /** Already has a room and scanned another: moving, or taking one more? `join`: it came through /j/<code>. */
  | { status: 'choose'; code: string; roomNumber: string; currentRooms: string[]; busy: boolean; join?: boolean }
  /** A property's staff sign-up QR: who are you? */
  | { status: 'staff_form'; code: string; place?: string; busy: boolean; error?: string }
  | { status: 'error'; message: string };

const LIFF_ID = import.meta.env.VITE_LIFF_ID as string | undefined;

/** Read before liff.init: a team's own LIFF app opens this page with ?team=<id> in its endpoint URL. */
const TEAM = new URLSearchParams(window.location.search).get('team');

/** Register whatever the scanned code is for (api/_liff-join.ts). */
async function joinCall(code: string, extra: { mode?: 'move' | 'add'; form?: { role: string; name: string; phone: string } } = {}): Promise<{ status: number; data: JoinResponse & { error?: string; url?: string } }> {
  const res = await fetch('/api/liff-join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'join', access_token: window.liff.getAccessToken(), code, ...(TEAM ? { team: TEAM } : {}), ...extra }),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) as JoinResponse & { error?: string; url?: string } };
}

/** What a person sees after a /j/<code> registration that is not a room. */
function joinResult(r: JoinResponse): Extract<GatewayState, { status: 'room_result' }> {
  const friendNote = r.add_friend_url ? ' เหลืออีกขั้นเดียว: กดเพิ่มเพื่อนด้านล่าง เพื่อรับข้อความในแชท' : '';
  const pending = r.outcome === 'pending';
  return {
    status: 'room_result', ok: r.ok,
    title: !r.ok ? 'ลงทะเบียนไม่สำเร็จ' : pending ? 'รอแอดมินอนุมัติ' : `${JOIN_TITLES_TH[r.kind]}สำเร็จ`,
    message: `${r.message}${r.place && r.ok ? ` · ${r.place}` : ''}${r.ok ? friendNote : ''}`,
    addFriendUrl: r.ok ? r.add_friend_url : undefined,
  };
}

/** Turn a /api/liff-join answer into the next screen (or a jump to the right LIFF app / chat). */
function nextFromJoin(code: string, status: number, data: JoinResponse & { error?: string; url?: string }): GatewayState | 'navigated' {
  if (status === 409 && data.url) { window.location.replace(data.url); return 'navigated'; }
  if (status !== 200 || !data.kind) return { status: 'error', message: 'ลงทะเบียนไม่สำเร็จ กรุณาสแกนอีกครั้ง' };
  if (data.kind === 'room') {
    if (data.outcome === 'choose') return { status: 'choose', code, roomNumber: data.room_number ?? '', currentRooms: data.current_rooms ?? [], busy: false, join: true };
    return roomResult({ outcome: data.outcome, room_number: data.room_number, dorm_name: data.place, add_friend_url: data.add_friend_url });
  }
  if (data.kind === 'staff_reg' && data.outcome === 'form') return { status: 'staff_form', code, place: data.place, busy: false };
  return joinResult(data);
}

interface ScanResponse { outcome?: string; room_number?: string; dorm_name?: string; add_friend_url?: string; url?: string; error?: string; current_rooms?: string[]; adding?: boolean }

/** Ask the server to register the scanned room for this LINE account. `mode` answers "move or add" when it was asked. */
async function scanRoom(code: string, mode?: 'move' | 'add'): Promise<{ ok: boolean; data: ScanResponse }> {
  const res = await fetch('/api/room-qr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'liff_scan', access_token: window.liff.getAccessToken(), code, ...(mode ? { mode } : {}) }),
  });
  return { ok: res.ok, data: await res.json().catch(() => ({})) as ScanResponse };
}

/** What a person sees after scanning a room's QR. */
function roomResult(r: ScanResponse): Extract<GatewayState, { status: 'room_result' }> {
  const room = r.room_number ? `ห้อง ${r.room_number}` : 'ห้องนี้';
  const where = r.dorm_name ? ` · ${r.dorm_name}` : '';
  const addFriendUrl = r.add_friend_url;
  const friendNote = addFriendUrl ? ' เหลืออีกขั้นเดียว: กดเพิ่มเพื่อนด้านล่าง ไม่อย่างนั้นบิลจะส่งมาไม่ถึง' : '';
  switch (r.outcome) {
    case 'bound': return { status: 'room_result', ok: true, title: 'ลงทะเบียนสำเร็จ', message: `${room}${where}.${friendNote}`, addFriendUrl };
    case 'already_yours': return { status: 'room_result', ok: true, title: 'ลงทะเบียนไว้แล้ว', message: `คุณลงทะเบียน${room}ไว้แล้ว${friendNote}`, addFriendUrl };
    case 'requested':
    case 'already_requested': return {
      status: 'room_result', ok: true, title: 'รอแอดมินอนุมัติ',
      message: r.adding
        ? `ส่งคำขอเพิ่ม${room}ให้แอดมินแล้ว เมื่ออนุมัติจะแจ้งทาง LINE ระหว่างนี้ห้องเดิมของคุณใช้งานได้ตามปกติ`
        : `${room}มีผู้ลงทะเบียนอยู่แล้ว ระบบส่งคำขอให้แอดมินแล้ว เมื่ออนุมัติจะแจ้งทาง LINE`,
    };
    case 'too_many_rooms': return { status: 'room_result', ok: false, title: 'ลงทะเบียนไว้หลายห้องแล้ว', message: 'LINE นี้ลงทะเบียนไว้เต็มจำนวนแล้ว กรุณาติดต่อเจ้าของหอ' };
    case 'recently_rejected': return { status: 'room_result', ok: false, title: 'ไม่ได้รับการอนุมัติ', message: 'คำขอนี้ไม่ได้รับการอนุมัติ กรุณาติดต่อเจ้าของหอ' };
    case 'too_many_requests': return { status: 'room_result', ok: false, title: 'มีคำขอจำนวนมาก', message: `${room}มีคำขอรออนุมัติหลายรายการ กรุณาติดต่อเจ้าของหอ` };
    case 'room_unavailable': return { status: 'room_result', ok: false, title: 'ห้องไม่พร้อมใช้งาน', message: 'กรุณาติดต่อเจ้าของหอ' };
    default: return { status: 'room_result', ok: false, title: 'QR นี้ใช้ไม่ได้', message: 'กรุณาขอใบใหม่จากเจ้าของหอ' };
  }
}

function StaffForm({ state, cardStyle, boxStyle, onSubmit }: {
  state: Extract<GatewayState, { status: 'staff_form' }>;
  cardStyle: React.CSSProperties; boxStyle: React.CSSProperties;
  onSubmit: (form: { role: string; name: string; phone: string }) => void;
}) {
  const [role, setRole] = useState<'technician' | 'housekeeping' | ''>('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const ready = !!role && name.trim().length >= 2 && phone.replace(/\D/g, '').length >= 9 && !state.busy;
  const roleBtn = (on: boolean): React.CSSProperties => ({
    flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '1rem 0.5rem', borderRadius: 16,
    border: on ? '2px solid #0A6CC2' : '1px solid #CFE2F6', background: on ? 'rgba(10,108,194,0.08)' : '#FFFFFF',
    color: '#102A43', fontFamily: 'inherit', fontSize: '1.05rem', fontWeight: 700, cursor: 'pointer',
  });
  const input: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', padding: '0.875rem 1rem', borderRadius: 12, border: '1px solid #CFE2F6',
    fontFamily: 'inherit', fontSize: '16px', color: '#102A43', background: '#FFFFFF',
  };
  const label: React.CSSProperties = { display: 'block', textAlign: 'left', color: '#3E5872', fontSize: '0.875rem', fontWeight: 600, margin: '1rem 0 0.375rem' };
  return (
    <div style={cardStyle}>
      <img src={horcareLogo} alt="HorCare" style={{ width: 64, height: 64, borderRadius: 16, marginBottom: '1.25rem' }} />
      <div style={boxStyle}>
        <h2 style={{ fontWeight: 800, color: '#102A43', margin: '0 0 0.25rem', fontSize: '1.25rem' }}>สมัครเป็นทีมงาน</h2>
        {state.place && <p style={{ color: '#557089', fontSize: '0.875rem', margin: 0 }}>{state.place}</p>}
        <span style={label}>ทำงานอะไร</span>
        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" style={roleBtn(role === 'technician')} aria-pressed={role === 'technician'} onClick={() => setRole('technician')}><Wrench size={28} color="#0A6CC2" /> ช่าง</button>
          <button type="button" style={roleBtn(role === 'housekeeping')} aria-pressed={role === 'housekeeping'} onClick={() => setRole('housekeeping')}><Sparkles size={28} color="#0A6CC2" /> แม่บ้าน</button>
        </div>
        <label style={label} htmlFor="sf-name">ชื่อ</label>
        <input id="sf-name" style={input} value={name} onChange={e => setName(e.target.value)} placeholder="ชื่อ-นามสกุล" autoComplete="name" />
        <label style={label} htmlFor="sf-phone">เบอร์โทร</label>
        <input id="sf-phone" style={input} value={phone} onChange={e => setPhone(e.target.value)} placeholder="08x-xxx-xxxx" inputMode="tel" autoComplete="tel" />
        {state.error && <p role="alert" style={{ color: '#C62828', fontSize: '0.875rem', margin: '0.75rem 0 0' }}>{state.error}</p>}
        <button type="button" disabled={!ready} onClick={() => role && onSubmit({ role, name: name.trim(), phone: phone.trim() })}
          style={{ width: '100%', marginTop: '1.25rem', padding: '1rem', borderRadius: 14, border: 'none', background: ready ? '#0A6CC2' : '#A9B8C8', color: '#fff', fontFamily: 'inherit', fontSize: '1.05rem', fontWeight: 700, cursor: ready ? 'pointer' : 'default' }}>
          {state.busy ? 'กำลังส่ง...' : 'ส่งใบสมัคร'}
        </button>
        <p style={{ color: '#557089', fontSize: '0.8125rem', margin: '0.75rem 0 0' }}>ผู้จัดการจะอนุมัติ แล้วแจ้งผลใน LINE</p>
      </div>
    </div>
  );
}

function loadLiffSdk(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.liff) { resolve(); return; }
    const s = document.createElement('script');
    s.src = 'https://static.line-scdn.net/liff/edge/2/sdk.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('โหลด LIFF SDK ไม่สำเร็จ'));
    document.head.appendChild(s);
  });
}

export default function TenantGateway() {
  const [state, setState] = useState<GatewayState>({ status: 'loading' });

  useEffect(() => {
    async function init() {
      try {
        // a team's own OA has its own LIFF app (its LINE ids belong to its provider); HorCare's is built in
        let liffId = LIFF_ID;
        if (TEAM) {
          const cfg = await fetch('/api/liff-join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'config', team: TEAM }) });
          const found = cfg.ok ? (await cfg.json() as { liff_id?: string }).liff_id : undefined;
          liffId = isLiffId(found) ? found : undefined;
        }
        if (!liffId) {
          setState({ status: 'error', message: 'LIFF ยังไม่ได้ตั้งค่า กรุณาติดต่อผู้ดูแลระบบ' });
          return;
        }
        await loadLiffSdk();
        await window.liff.init({ liffId });

        // read only after liff.init(): that is what restores the query from the LIFF URL
        const params = new URLSearchParams(window.location.search);
        const roomCode = params.get('room');
        const joinCode = params.get('join');

        // a phone camera may open the QR in the browser; LINE Login still proves who is scanning
        if (!window.liff.isInClient() && !roomCode && !joinCode) {
          setState({ status: 'no_liff' });
          return;
        }

        if (!window.liff.isLoggedIn()) {
          window.liff.login({ redirectUri: window.location.href });
          return;
        }

        // /j/<code>: any registration — room, stall, walk-in, staff, admin, cashier
        if (joinCode) {
          const { status, data } = await joinCall(joinCode);
          const next = nextFromJoin(joinCode, status, data);
          if (next !== 'navigated') setState(next);
          return;
        }

        if (roomCode) {
          const { ok, data } = await scanRoom(roomCode);
          if (data.error === 'use_chat' && data.url) { window.location.replace(data.url); return; }
          if (!ok) {
            setState({ status: 'error', message: 'ลงทะเบียนไม่สำเร็จ กรุณาสแกนอีกครั้ง' });
            return;
          }
          if (data.outcome === 'choose') {
            setState({ status: 'choose', code: roomCode, roomNumber: data.room_number ?? '', currentRooms: data.current_rooms ?? [], busy: false });
            return;
          }
          setState(roomResult(data));
          return;
        }

        // The server checks this LINE access token with LINE itself, so a LINE user id typed into the browser
        // is never enough to open someone's portal.
        const res = await fetch('/api/portal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'liff', access_token: window.liff.getAccessToken() }),
        });

        if (res.status === 404) {
          setState({ status: 'not_registered' });
          return;
        }
        if (!res.ok) {
          setState({ status: 'error', message: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' });
          return;
        }

        const found = await res.json() as { portal: string; room_number?: string; dorm_name?: string; rooms?: { portal: string; room_number: string; dorm_name: string }[] };
        if (found.rooms && found.rooms.length > 1) {
          setState({ status: 'pick_room', rooms: found.rooms });
          return;
        }
        const { portal, room_number, dorm_name } = found;
        setState({ status: 'redirecting', roomNumber: room_number ?? '', dormName: dorm_name ?? '' });
        window.location.replace(`/?p=${encodeURIComponent(portal)}`);
      } catch (err) {
        console.error('[TenantGateway]', err);
        setState({ status: 'error', message: 'เกิดข้อผิดพลาด กรุณาปิดแล้วเปิด LINE ใหม่' });
      }
    }
    init();
  }, []);

  const cardStyle: React.CSSProperties = {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '2rem',
    background: 'linear-gradient(180deg, #E7F0FA 0%, #F2F7FC 50%, #F4F7FB 100%)',
    fontFamily: "var(--font-sans)",
  };

  const boxStyle: React.CSSProperties = {
    background: '#FFFFFF',
    borderRadius: '24px',
    padding: '2.25rem 2rem 2.5rem',
    border: '1px solid #CFE2F6',
    width: '100%',
    maxWidth: 360,
    textAlign: 'center',
    boxShadow: '0 20px 40px -10px rgba(10, 108, 194, 0.15), 0 1px 3px rgba(0, 0, 0, 0.05)',
  };

  // ── Loading ──
  if (state.status === 'loading') {
    return (
      <div style={cardStyle}>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        <img src={horcareLogo} alt="HorCare" style={{ width: 80, height: 80, borderRadius: 20, marginBottom: '1.75rem', boxShadow: '0 8px 32px rgba(10, 108, 194, 0.25)' }} />
        <div style={{ width: 38, height: 38, border: '3px solid rgba(10, 108, 194, 0.25)', borderTopColor: '#0A6CC2', borderRadius: '50%', animation: 'spin 0.8s linear infinite', marginBottom: '1.1rem' }} />
        <p style={{ color: '#08589F', fontWeight: 700, fontSize: '1rem', margin: 0 }}>กำลังตรวจสอบข้อมูล...</p>
      </div>
    );
  }

  // ── Redirecting ──
  if (state.status === 'redirecting') {
    return (
      <div style={cardStyle}>
        <img src={horcareLogo} alt="HorCare" style={{ width: 80, height: 80, borderRadius: 20, marginBottom: '1.75rem', boxShadow: '0 8px 32px rgba(10, 108, 194, 0.25)' }} />
        <div style={boxStyle}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.75rem', color: '#0A6CC2' }}><Building2 size={36} /></div>
          <h2 style={{ fontWeight: 800, color: '#102A43', margin: '0 0 0.375rem', fontSize: '1.25rem' }}>พบข้อมูลแล้ว!</h2>
          {state.dormName && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
              background: 'rgba(10, 108, 194,0.1)', border: '1px solid rgba(10, 108, 194,0.25)',
              borderRadius: '9999px', padding: '0.25rem 0.75rem', margin: '0 0 0.5rem',
              color: '#0A6CC2', fontSize: '0.8125rem', fontWeight: 700,
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22A35A', boxShadow: '0 0 6px #22A35A' }} />
              <span>{state.dormName}</span>
            </div>
          )}
          <p style={{ color: '#29435E', fontSize: '0.95rem', fontWeight: 700, margin: '0 0 1.25rem' }}>ห้อง {state.roomNumber}</p>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', color: '#557089', fontSize: '0.875rem' }}>
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            <div style={{ width: 18, height: 18, border: '2px solid rgba(10, 108, 194, 0.3)', borderTopColor: '#0A6CC2', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            กำลังเข้าสู่หน้าบิล...
          </div>
        </div>
      </div>
    );
  }

  // ── Not registered ──
  if (state.status === 'not_registered') {
    return (
      <div style={cardStyle}>
        <img src={horcareLogo} alt="HorCare" style={{ width: 72, height: 72, borderRadius: 18, marginBottom: '1.5rem', boxShadow: '0 8px 32px rgba(10, 108, 194, 0.25)' }} />
        <div style={boxStyle}>
          <div style={{ marginBottom: '0.75rem', color: '#0A6CC2' }}><ClipboardList size={40} /></div>
          <h2 style={{ fontWeight: 800, color: '#102A43', margin: '0 0 0.5rem', fontSize: '1.2rem' }}>ยังไม่ได้ลงทะเบียน</h2>
          <p style={{ color: '#3E5872', fontSize: '0.875rem', lineHeight: 1.65, margin: '0 0 1.5rem' }}>
            คุณยังไม่ได้แจ้งห้องในระบบ<br />
            กรุณาแจ้งเจ้าของหอพักเพื่อลงทะเบียนก่อนนะคะ
          </p>
          <div style={{
            background: '#F4F7FB',
            borderRadius: '14px',
            border: '1px solid #DCE5EF',
            padding: '1rem',
            textAlign: 'left',
          }}>
            <p style={{ color: '#102A43', fontSize: '0.8125rem', fontWeight: 700, margin: '0 0 0.5rem' }}>วิธีลงทะเบียน</p>
            <p style={{ color: '#557089', fontSize: '0.8125rem', lineHeight: 1.7, margin: 0 }}>
              1. แจ้งเบอร์ห้องของคุณให้เจ้าของหอพัก<br />
              2. เจ้าของหอจะส่งลิงก์ลงทะเบียนมาทาง LINE<br />
              3. กดลิงก์ → พิมพ์เลขห้อง → ลงทะเบียนสำเร็จ
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Several rooms on this LINE account: which one? ──
  if (state.status === 'pick_room') {
    return (
      <div style={cardStyle}>
        <img src={horcareLogo} alt="HorCare" style={{ width: 72, height: 72, borderRadius: 18, marginBottom: '1.5rem', boxShadow: '0 8px 32px rgba(10, 108, 194, 0.25)' }} />
        <div style={boxStyle}>
          <div style={{ marginBottom: '0.75rem', display: 'flex', justifyContent: 'center', color: '#0A6CC2' }}><Building2 size={40} /></div>
          <h2 style={{ fontWeight: 800, color: '#102A43', margin: '0 0 0.25rem', fontSize: '1.2rem' }}>เลือกห้อง</h2>
          <p style={{ color: '#3E5872', fontSize: '0.875rem', lineHeight: 1.65, margin: 0 }}>LINE นี้ดูแล {state.rooms.length} ห้อง</p>
          {state.rooms.map(r => (
            <a key={r.portal} href={`/?p=${encodeURIComponent(r.portal)}`}
              style={{ display: 'block', marginTop: '0.75rem', padding: '0.875rem 1rem', borderRadius: 14, background: '#0A6CC2', color: '#fff', fontWeight: 700, textDecoration: 'none' }}>
              ห้อง {r.room_number}{r.dorm_name ? <span style={{ fontWeight: 500, opacity: 0.85 }}> · {r.dorm_name}</span> : null}
            </a>
          ))}
        </div>
      </div>
    );
  }

  // ── Has a room already: moving, or one more? ──
  if (state.status === 'choose') {
    const mine = state.currentRooms.join(', ');
    const answer = async (mode: 'move' | 'add') => {
      setState({ ...state, busy: true });
      try {
        if (state.join) {
          const { status, data } = await joinCall(state.code, { mode });
          const next = nextFromJoin(state.code, status, data);
          if (next !== 'navigated') setState(next);
          return;
        }
        const { ok, data } = await scanRoom(state.code, mode);
        setState(ok ? roomResult(data) : { status: 'error', message: 'ลงทะเบียนไม่สำเร็จ กรุณาสแกนอีกครั้ง' });
      } catch {
        setState({ status: 'error', message: 'ลงทะเบียนไม่สำเร็จ กรุณาสแกนอีกครั้ง' });
      }
    };
    const choiceBtn: React.CSSProperties = {
      display: 'block', width: '100%', padding: '0.875rem 1rem', borderRadius: 14, border: '1px solid #CFE2F6', background: '#FFFFFF',
      textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', marginTop: '0.75rem', opacity: state.busy ? 0.6 : 1,
    };
    return (
      <div style={cardStyle}>
        <img src={horcareLogo} alt="HorCare" style={{ width: 72, height: 72, borderRadius: 18, marginBottom: '1.5rem', boxShadow: '0 8px 32px rgba(10, 108, 194, 0.25)' }} />
        <div style={boxStyle}>
          <div style={{ marginBottom: '0.75rem', display: 'flex', justifyContent: 'center', color: '#0A6CC2' }}><Building2 size={40} /></div>
          <h2 style={{ fontWeight: 800, color: '#102A43', margin: '0 0 0.5rem', fontSize: '1.2rem' }}>คุณมีห้อง {mine} อยู่แล้ว</h2>
          <p style={{ color: '#3E5872', fontSize: '0.875rem', lineHeight: 1.65, margin: 0 }}>ต้องการทำอย่างไรกับห้อง {state.roomNumber}?</p>
          <button type="button" style={choiceBtn} disabled={state.busy} onClick={() => void answer('add')}>
            <strong style={{ display: 'block', color: '#102A43', fontSize: '1rem' }}>เพิ่มห้อง {state.roomNumber}</strong>
            <span style={{ color: '#557089', fontSize: '0.8125rem' }}>ดูแลทั้งห้อง {mine} และ {state.roomNumber} · ต้องรอแอดมินอนุมัติ</span>
          </button>
          <button type="button" style={choiceBtn} disabled={state.busy} onClick={() => void answer('move')}>
            <strong style={{ display: 'block', color: '#102A43', fontSize: '1rem' }}>ย้ายไปห้อง {state.roomNumber}</strong>
            <span style={{ color: '#557089', fontSize: '0.8125rem' }}>เลิกห้อง {mine} แล้วใช้ห้อง {state.roomNumber} แทน</span>
          </button>
        </div>
      </div>
    );
  }

  // ── Staff sign-up QR: job, name, phone — few words, big buttons ──
  if (state.status === 'staff_form') {
    return <StaffForm state={state} cardStyle={cardStyle} boxStyle={boxStyle}
      onSubmit={async form => {
        setState({ ...state, busy: true, error: undefined });
        try {
          const { status, data } = await joinCall(state.code, { form });
          if (status === 200 && data.kind === 'staff_reg' && !data.ok && data.outcome === 'bad_form') { setState({ ...state, busy: false, error: data.message }); return; }
          const next = nextFromJoin(state.code, status, data);
          if (next !== 'navigated') setState(next);
        } catch {
          setState({ ...state, busy: false, error: 'ส่งไม่สำเร็จ กรุณาลองใหม่' });
        }
      }} />;
  }

  // ── After scanning a room's QR ──
  if (state.status === 'room_result') {
    const pending = state.title === 'รอแอดมินอนุมัติ';
    return (
      <div style={cardStyle}>
        <img src={horcareLogo} alt="HorCare" style={{ width: 72, height: 72, borderRadius: 18, marginBottom: '1.5rem', boxShadow: '0 8px 32px rgba(10, 108, 194, 0.25)' }} />
        <div style={boxStyle}>
          <div style={{ marginBottom: '0.75rem', display: 'flex', justifyContent: 'center', color: state.ok ? (pending ? '#E8740C' : '#15803D') : '#EF4444' }}>
            {!state.ok ? <AlertTriangle size={40} /> : pending ? <Hourglass size={40} /> : <CheckCircle2 size={40} />}
          </div>
          <h2 style={{ fontWeight: 800, color: '#102A43', margin: '0 0 0.5rem', fontSize: '1.2rem' }}>{state.title}</h2>
          <p style={{ color: '#3E5872', fontSize: '0.875rem', lineHeight: 1.65, margin: 0 }}>{state.message}</p>
          {state.addFriendUrl && (
            <a href={state.addFriendUrl} style={{ display: 'block', marginTop: '1.25rem', padding: '0.75rem', borderRadius: 12, background: '#06C755', color: '#fff', fontWeight: 700, textDecoration: 'none' }}>
              เพิ่มเพื่อน LINE
            </a>
          )}
        </div>
      </div>
    );
  }

  // ── Opened in regular browser (not LINE app) ──
  if (state.status === 'no_liff') {
    return (
      <div style={cardStyle}>
        <img src={horcareLogo} alt="HorCare" style={{ width: 72, height: 72, borderRadius: 18, marginBottom: '1.5rem', boxShadow: '0 8px 32px rgba(10, 108, 194, 0.25)' }} />
        <div style={boxStyle}>
          <div style={{ marginBottom: '0.75rem', color: '#0A6CC2' }}><Smartphone size={40} /></div>
          <h2 style={{ fontWeight: 800, color: '#102A43', margin: '0 0 0.5rem', fontSize: '1.2rem' }}>เปิดใน LINE</h2>
          <p style={{ color: '#3E5872', fontSize: '0.875rem', lineHeight: 1.65, margin: 0 }}>
            กรุณาเปิดหน้านี้ผ่าน LINE<br />
            โดยกดที่ Rich Menu ในแชท LINE OA ของหอพักคุณ
          </p>
        </div>
      </div>
    );
  }

  // ── Error ──
  return (
    <div style={cardStyle}>
      <img src={horcareLogo} alt="HorCare" style={{ width: 72, height: 72, borderRadius: 18, marginBottom: '1.5rem', boxShadow: '0 8px 32px rgba(10, 108, 194, 0.25)' }} />
      <div style={boxStyle}>
        <div style={{ marginBottom: '0.75rem', color: '#EF4444' }}><AlertTriangle size={40} /></div>
        <h2 style={{ fontWeight: 800, color: '#102A43', margin: '0 0 0.5rem', fontSize: '1.2rem' }}>เกิดข้อผิดพลาด</h2>
        <p style={{ color: '#3E5872', fontSize: '0.875rem', lineHeight: 1.65, margin: '0 0 1.25rem' }}>
          {(state as { status: 'error'; message: string }).message}
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{
            background: 'linear-gradient(135deg, #0A6CC2 0%, #22A35A 100%)',
            border: 'none',
            borderRadius: '12px',
            color: '#fff',
            fontWeight: 700,
            fontSize: '0.875rem',
            padding: '0.75rem 1.5rem',
            cursor: 'pointer',
            width: '100%',
            boxShadow: '0 4px 12px rgba(10, 108, 194, 0.3)',
          }}
        >
          ลองใหม่อีกครั้ง
        </button>
      </div>
    </div>
  );
}
