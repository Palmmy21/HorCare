// Inline SVG data URI for PromptPay logo — avoids CORS and external network failures on mobile browsers
export const PROMPTPAY_LOGO_DATA_URI = `data:image/svg+xml;utf8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 64" width="160" height="64">
  <rect width="160" height="64" rx="10" fill="#003D6B"/>
  <path d="M22 46 C22 28, 38 18, 54 18 C46 26, 44 38, 44 46 Z" fill="#00A3E0"/>
  <path d="M30 46 C30 34, 40 24, 52 24 C44 30, 42 38, 42 46 Z" fill="#FFFFFF"/>
  <text x="56" y="38" font-family="Arial, Helvetica, sans-serif" font-weight="900" font-size="22" fill="#FFFFFF" letter-spacing="-0.5">PromptPay</text>
  <text x="58" y="49" font-family="Arial, Helvetica, sans-serif" font-weight="600" font-size="9" fill="#00A3E0" letter-spacing="1.5">พร้อมเพย์</text>
</svg>
`)}`;
