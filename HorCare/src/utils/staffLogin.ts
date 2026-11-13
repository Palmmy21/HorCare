import { browserLocalPersistence, setPersistence, signInWithCustomToken } from 'firebase/auth';
import { auth } from '../firebase/config';

export type StaffPhoneLogin = 'ok' | 'invalid' | 'too_many' | 'error';

/**
 * Sign in to an administrator account with the phone number the owner set up for it. The server checks the password
 * with Firebase Auth and hands back a sign-in token for that account; 'invalid' covers an unknown phone and a wrong
 * password alike (the caller may then try the number as a housekeeper's).
 */
export async function staffPhoneLogin(phone: string, password: string): Promise<StaffPhoneLogin> {
  let res: Response;
  try {
    res = await fetch('/api/members', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'login', phone, password }),
    });
  } catch {
    return 'error';
  }
  const data = await res.json().catch(() => ({})) as { token?: string };
  if (res.status === 429) return 'too_many';
  if (res.status === 401 || res.status === 400) return 'invalid';
  if (!res.ok || !data.token) return 'error';
  await setPersistence(auth, browserLocalPersistence);
  await signInWithCustomToken(auth, data.token);
  return 'ok';
}
