import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import RegisterWizard from './RegisterWizard';

describe('RegisterWizard', () => {
  const html = renderToStaticMarkup(<RegisterWizard onRegister={async () => {}} error={null} clearError={() => {}} />);

  it('opens on the account step only: email and password, nothing else yet', () => {
    expect(html).toContain('ขั้นที่ 1 จาก 4');
    expect(html).toContain('type="email"');
    expect(html).toContain('type="password"');
    for (const later of ['นามสกุล', 'เบอร์โทรศัพท์', 'ค่าไฟ', 'ครบกำหนดชำระ', 'รู้จักเราจากที่ไหน']) expect(html).not.toContain(later);
  });

  it('has no back button on the first step and the main button says next', () => {
    expect(html).not.toContain('ย้อนกลับ');
    expect(html).toContain('ถัดไป');
    expect(html).not.toContain('>สมัครสมาชิก');
  });
});
