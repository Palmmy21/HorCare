// Platform admin account. firestore.rules hardcodes the same email in isAdmin(); keep them in sync.
export const ADMIN_EMAIL = 'horcare.admin@gmail.com';

export function isAdminUser(email: string | null | undefined, role?: string | null): boolean {
  return role === 'admin' || (!!email && email.toLowerCase() === ADMIN_EMAIL);
}
