import { useEffect, useRef } from 'react';

interface Props {
  /** Value of the hidden trap field; send it as `website` (it must stay empty for real people). */
  trap: string;
  onTrap: (v: string) => void;
  /** Receives the Cloudflare Turnstile token (only when VITE_TURNSTILE_SITE_KEY is set). */
  onToken: (token: string) => void;
}

interface TurnstileApi {
  render: (el: HTMLElement, opts: { sitekey: string; callback: (t: string) => void; 'expired-callback'?: () => void }) => string;
  remove: (id: string) => void;
}
const SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) ?? '';
const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

function loadTurnstile(): Promise<TurnstileApi> {
  const w = window as unknown as { turnstile?: TurnstileApi };
  if (w.turnstile) return Promise.resolve(w.turnstile);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT}"]`);
    const s = existing ?? Object.assign(document.createElement('script'), { src: SCRIPT, async: true });
    s.addEventListener('load', () => (w.turnstile ? resolve(w.turnstile) : reject(new Error('turnstile'))));
    s.addEventListener('error', () => reject(new Error('turnstile')));
    if (!existing) document.head.appendChild(s);
  });
}

/**
 * Bot protection for public forms: a hidden trap field that people never see, and (when configured) Cloudflare
 * Turnstile, which is invisible to most visitors. Without a site key only the trap field is active.
 */
export default function AntiBot({ trap, onTrap, onToken }: Props) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!SITE_KEY || !box.current) return;
    let id: string | null = null;
    let api: TurnstileApi | null = null;
    let cancelled = false;
    loadTurnstile().then(t => {
      if (cancelled || !box.current) return;
      api = t;
      id = t.render(box.current, { sitekey: SITE_KEY, callback: onToken, 'expired-callback': () => onToken('') });
    }).catch(() => undefined);
    return () => { cancelled = true; if (api && id) api.remove(id); };
  }, [onToken]);

  return (
    <>
      <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', top: 'auto', width: 1, height: 1, overflow: 'hidden' }}>
        <label>เว็บไซต์ (ห้ามกรอก)<input type="text" tabIndex={-1} autoComplete="off" value={trap} onChange={e => onTrap(e.target.value)} /></label>
      </div>
      {SITE_KEY && <div ref={box} />}
    </>
  );
}

/** True when a captcha is configured, so a form knows to wait for the token before enabling "send". */
export const captchaRequired = SITE_KEY !== '';
