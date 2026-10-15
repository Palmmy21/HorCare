const SAFE = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

const rand = (n: number) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
const pick = (set: string) => set[rand(set.length)];

/** A readable random password: 10 characters, never ambiguous (no 0/O, 1/l/I), always with a letter and a digit. */
export function generatePassword(): string {
  const chars = [pick('23456789'), pick('ABCDEFGHJKLMNPQRSTUVWXYZ'), pick('abcdefghijkmnopqrstuvwxyz'), ...Array.from({ length: 7 }, () => pick(SAFE))];
  for (let i = chars.length - 1; i > 0; i--) { const j = rand(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join('');
}