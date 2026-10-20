/** The public address of the web app, for links sent to tenants and staff (no trailing slash). */
export function appBaseUrl(): string {
    return (process.env.PUBLIC_APP_URL || 'https://hor-care.vercel.app').replace(/\/$/, '');
}
