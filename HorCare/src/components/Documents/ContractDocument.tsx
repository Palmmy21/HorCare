import { QRCodeCanvas } from 'qrcode.react';
import './documents.css';
import horcareLogo from '../../assets/horcare_logo.png';
import { bahtAmount, thaiLongDate, type DocIssuer } from './docFormat';

/** What the contract page needs — a saved contract (SignedContractData) and the editor's form both fit. */
export interface ContractDocData {
  contract_number: string;
  contract_type: 'market_stall' | 'residential' | 'commercial';
  title: string;
  lessor_name: string;
  lessor_phone?: string;
  lessor_id_card?: string;
  lessor_address?: string;
  lessor_signature?: string;
  lessor_signed_at?: string;
  lessee_name: string;
  lessee_phone?: string;
  lessee_id_card?: string;
  lessee_address?: string;
  lessee_business_type?: string;
  lessee_signature?: string;
  lessee_signed_at?: string;
  unit_number: string;
  zone_or_floor?: string;
  stall_or_room_size?: string;
  rent_amount: number;
  rent_cycle: 'daily' | 'weekly' | 'monthly' | 'yearly';
  deposit_amount: number;
  start_date: string;
  end_date?: string;
  electricity_rate_desc?: string;
  water_rate_desc?: string;
  waste_fee_desc?: string;
  clauses: string[];
  custom_terms?: string;
  verification_code?: string;
}

const CYCLE: Record<string, string> = { daily: 'วัน', weekly: 'สัปดาห์', monthly: 'เดือน', yearly: 'ปี' };

const BLANK = '..............................';

/** Templates number their clauses in the text ("3. การชำระเงิน: ..."): split that off so it hangs in its own column. */
function splitClause(text: string, i: number): { no: string; head: string; body: string } {
  const m = /^\s*(\d+(?:\.\d+)*)[.)]\s*(.*)$/s.exec(text);
  const no = m ? `${m[1]}.` : `${i + 1}.`;
  const rest = (m ? m[2] : text).trim();
  // "การชำระค่าเช่า: ผู้เช่าตกลง..." — a short lead-in before the colon is the clause's heading
  const h = /^([^:：]{2,48})[:：]\s*(.+)$/s.exec(rest);
  return h ? { no, head: h[1].trim(), body: h[2] } : { no, head: '', body: rest };
}

export function ContractDocument({ c, issuer, unitWord, tenantWord = 'ผู้เช่า' }: {
  c: ContractDocData;
  issuer: DocIssuer;
  /** e.g. ห้อง / แผงค้า / พื้นที่ */
  unitWord?: string;
  /** what the tenant is called in this business (ผู้เช่า / ผู้ค้า) */
  tenantWord?: string;
}) {
  const unit = unitWord ?? (c.contract_type === 'market_stall' ? 'แผงค้า' : c.contract_type === 'commercial' ? 'พื้นที่' : 'ห้อง');
  const lessorName = c.lessor_name || issuer.name || '';
  const code = c.verification_code || c.contract_number;
  const utilities = [
    c.electricity_rate_desc && `ค่าไฟฟ้า ${c.electricity_rate_desc}`,
    c.water_rate_desc && `ค่าน้ำประปา ${c.water_rate_desc}`,
    c.waste_fee_desc && `ค่าขยะ/ทำความสะอาด ${c.waste_fee_desc}`,
  ].filter(Boolean).join(' · ');
  const clauses = c.clauses.filter(x => x.trim());

  return (
    <>
      <header className="doc-head doc-block">
        <div className="doc-issuer">
          <img className="doc-logo" src={issuer.logo || horcareLogo} alt="" />
          <div style={{ minWidth: 0 }}>
            <div className="doc-issuer-name">{lessorName || 'ผู้ให้เช่า'}</div>
            {(c.lessor_address || issuer.address) && <div className="doc-issuer-line">{c.lessor_address || issuer.address}</div>}
            {(c.lessor_phone || issuer.phone) && <div className="doc-issuer-line">โทร. {c.lessor_phone || issuer.phone}</div>}
          </div>
        </div>
        <div className="doc-head-side">
          {/* contract number and audit code only — a printed contract must not carry the tenant's portal link */}
          <QRCodeCanvas value={`HorCare ${c.contract_number} ${c.verification_code ?? ''}`.trim()} size={64} level="M" />
          <div className="doc-code">{code}</div>
        </div>
      </header>

      <h1 className="doc-title doc-block">{c.title || 'สัญญาเช่า'}</h1>
      <div className="doc-subtitle doc-block">สัญญาเลขที่ <span className="doc-num">{c.contract_number}</span></div>

      <p className="doc-para doc-block">
        สัญญาฉบับนี้ทำขึ้น ณ <b>{lessorName || BLANK}</b> เมื่อวันที่ <b>{thaiLongDate(c.start_date) || BLANK}</b> ระหว่าง
      </p>
      <p className="doc-party doc-block">
        <b>(1) {lessorName || BLANK}</b>
        {c.lessor_id_card ? <> เลขประจำตัว {c.lessor_id_card}</> : null}
        {c.lessor_address || issuer.address ? <> ที่อยู่ {c.lessor_address || issuer.address}</> : null}
        {c.lessor_phone || issuer.phone ? <> โทร. {c.lessor_phone || issuer.phone}</> : null}
        {' '}ซึ่งต่อไปในสัญญานี้เรียกว่า <b>“ผู้ให้เช่า”</b> ฝ่ายหนึ่ง กับ
      </p>
      <p className="doc-party doc-block">
        <b>(2) {c.lessee_name || BLANK}</b>
        {c.lessee_id_card ? <> เลขประจำตัวประชาชน {c.lessee_id_card}</> : null}
        {c.lessee_address ? <> ที่อยู่ {c.lessee_address}</> : null}
        {c.lessee_business_type ? <> ประกอบกิจการ {c.lessee_business_type}</> : null}
        {c.lessee_phone ? <> โทร. {c.lessee_phone}</> : null}
        {' '}ซึ่งต่อไปในสัญญานี้เรียกว่า <b>“{tenantWord}”</b> อีกฝ่ายหนึ่ง
      </p>
      <p className="doc-para doc-block">ทั้งสองฝ่ายตกลงทำสัญญากัน โดยมีข้อความดังต่อไปนี้</p>

      <div className="doc-section-title doc-block">สาระสำคัญของสัญญา</div>
      <table className="doc-terms">
        <tbody>
          <tr className="doc-block"><th>ทรัพย์สินที่เช่า</th><td>{unit} <b>{c.unit_number}</b>{c.zone_or_floor ? ` · ${c.zone_or_floor}` : ''}{c.stall_or_room_size ? ` · ขนาดประมาณ ${c.stall_or_room_size}` : ''}</td></tr>
          <tr className="doc-block"><th>ค่าเช่า</th><td><b className="doc-num">{bahtAmount(c.rent_amount)}</b> ต่อ{CYCLE[c.rent_cycle] ?? 'เดือน'}</td></tr>
          <tr className="doc-block"><th>เงินประกัน</th><td><b className="doc-num">{bahtAmount(c.deposit_amount)}</b></td></tr>
          <tr className="doc-block"><th>ระยะเวลาเช่า</th><td>ตั้งแต่ {thaiLongDate(c.start_date) || BLANK} ถึง {c.end_date ? thaiLongDate(c.end_date) : 'ไม่มีกำหนด'}</td></tr>
          {utilities && <tr className="doc-block"><th>ค่าสาธารณูปโภค</th><td>{utilities}</td></tr>}
        </tbody>
      </table>

      {clauses.length > 0 && <div className="doc-section-title doc-block">ข้อตกลงและเงื่อนไข</div>}
      {clauses.map((text, i) => {
        const { no, head, body } = splitClause(text, i);
        return (
          <div key={i} className="doc-clause doc-block">
            <span className="doc-clause-no">{no}</span>
            <span>{head && <b>{head} </b>}{body}</span>
          </div>
        );
      })}
      {c.custom_terms?.trim() && (
        <>
          <div className="doc-section-title doc-block">ข้อตกลงเพิ่มเติม</div>
          {c.custom_terms.split(/\n+/).filter(Boolean).map((line, i) => <p key={i} className="doc-para doc-block">{line}</p>)}
        </>
      )}

      <p className="doc-para doc-block" style={{ marginTop: 18 }}>
        สัญญานี้ทำขึ้นเป็นเอกสารอิเล็กทรอนิกส์ คู่สัญญาได้อ่านและเข้าใจข้อความโดยตลอดแล้ว เห็นว่าถูกต้องตามเจตนา
        จึงได้ลงลายมือชื่ออิเล็กทรอนิกส์ไว้เป็นสำคัญ
      </p>

      <div className="doc-signs doc-block">
        {[
          { img: c.lessor_signature, name: lessorName, role: 'ผู้ให้เช่า', at: c.lessor_signed_at },
          { img: c.lessee_signature, name: c.lessee_name, role: tenantWord, at: c.lessee_signed_at },
        ].map(s => (
          <div key={s.role} className="doc-sign">
            <div className="doc-sign-img">
              {s.img ? <img src={s.img} alt={`ลายมือชื่อ${s.role}`} /> : <span className="doc-sign-wait">ยังไม่ได้ลงนาม</span>}
            </div>
            <div className="doc-sign-line" />
            <div className="doc-sign-name">( {s.name || BLANK} )</div>
            <div className="doc-sign-role">{s.role}</div>
            <div className="doc-sign-date">{s.at ? `ลงนามเมื่อ ${thaiLongDate(s.at)}` : 'วันที่ ' + BLANK}</div>
          </div>
        ))}
      </div>

      <footer className="doc-foot doc-block">
        <span>ลงนามอิเล็กทรอนิกส์ตาม พ.ร.บ. ว่าด้วยธุรกรรมทางอิเล็กทรอนิกส์ พ.ศ. 2544 ผ่านระบบ HorCare</span>
        <span className="doc-code">{code}</span>
      </footer>
    </>
  );
}
