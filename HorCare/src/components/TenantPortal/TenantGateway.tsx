import { useState, useEffect } from 'react';
import horcareLogo from '../../assets/horcare_logo.png';
import { ClipboardList, AlertTriangle, Building2, Smartphone } from 'lucide-react';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface Window { liff: any; }
}

type GatewayState =
  | { status: 'loading' }
  | { status: 'redirecting'; roomNumber: string; dormName: string }
  | { status: 'not_registered' }
  | { status: 'no_liff' }
  | { status: 'error'; message: string };

const LIFF_ID = import.meta.env.VITE_LIFF_ID as string | undefined;

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
      if (!LIFF_ID) {
        setState({ status: 'error', message: 'LIFF ยังไม่ได้ตั้งค่า กรุณาติดต่อผู้ดูแลระบบ' });
        return;
      }
      try {
        await loadLiffSdk();
        await window.liff.init({ liffId: LIFF_ID });

        if (!window.liff.isInClient()) {
          setState({ status: 'no_liff' });
          return;
        }

        if (!window.liff.isLoggedIn()) {
          window.liff.login({ redirectUri: window.location.href });
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

        const { portal, room_number, dorm_name } = await res.json() as { portal: string; room_number?: string; dorm_name?: string };
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
