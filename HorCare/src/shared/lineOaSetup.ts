// Connecting a team's own LINE Official Account: making sense of what the owner pasted. Pure.
//
// Two values come from the LINE Developers Console, from two different tabs, and they are easy to put in the wrong
// box: the channel secret (32 hex characters) and the long-lived channel access token (well over 100 characters).
// They cannot be confused with each other, so the page sorts them out instead of telling the owner off.

const SECRET_RE = /^[0-9a-f]{32}$/i;

/** Remove the spaces and line breaks a copy from a web page brings along. */
export const cleanPasted = (v: string): string => v.replace(/\s+/g, '');

export const looksLikeSecret = (v: string): boolean => SECRET_RE.test(cleanPasted(v));
/** A channel access token: long, base64-like. Never 32 hex characters. */
export const looksLikeToken = (v: string): boolean => {
    const c = cleanPasted(v);
    return c.length >= 100 && /^[A-Za-z0-9+/=_-]+$/.test(c);
};

export interface OaFields { secret: string; token: string }

/**
 * The two boxes after a value was typed or pasted into one of them. A value that is plainly the other one is moved to
 * its own box (only into an empty box or over the same kind of value: nothing the owner entered is lost).
 */
export function routePasted(fields: OaFields, box: keyof OaFields, value: string): OaFields & { moved: boolean } {
    const v = cleanPasted(value);
    if (box === 'secret' && looksLikeToken(v) && !looksLikeSecret(v)) return { secret: looksLikeSecret(fields.secret) ? fields.secret : '', token: v, moved: true };
    if (box === 'token' && looksLikeSecret(v)) return { secret: v, token: looksLikeToken(fields.token) ? fields.token : '', moved: true };
    return { ...fields, [box]: v, moved: false };
}

/** What is still wrong with the two values, in the owner's words; null when they can be sent. */
export function setupProblem(f: OaFields): string | null {
    const secret = cleanPasted(f.secret);
    const token = cleanPasted(f.token);
    if (!secret && !token) return null;
    if (secret && !looksLikeSecret(secret)) return 'Channel secret ต้องมี 32 ตัว (เลข 0-9 และ a-f) ลองคัดลอกจากแท็บ Basic settings อีกครั้ง';
    if (token && !looksLikeToken(token)) return 'Channel access token สั้นเกินไป ต้องเป็นแบบ long-lived จากแท็บ Messaging API (ยาวกว่า 100 ตัว)';
    return null;
}

export const readyToConnect = (f: OaFields): boolean => looksLikeSecret(f.secret) && looksLikeToken(f.token);
