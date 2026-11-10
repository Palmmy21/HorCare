import { describe, expect, it } from 'vitest';
import { looksLikeSecret, looksLikeToken, readyToConnect, routePasted, setupProblem } from './lineOaSetup';

const SECRET = '0123456789abcdef0123456789abcdef';
const TOKEN = `${'Ab3+/x'.repeat(28)}XyZ=`;

describe('telling the two values apart', () => {
    it('knows a channel secret and a long-lived token', () => {
        expect(looksLikeSecret(SECRET)).toBe(true);
        expect(looksLikeSecret(` ${SECRET.toUpperCase()}\n`)).toBe(true);
        expect(looksLikeToken(TOKEN)).toBe(true);
        expect(looksLikeToken(SECRET)).toBe(false);
        expect(looksLikeSecret(TOKEN)).toBe(false);
    });
});

describe('routePasted', () => {
    const empty = { secret: '', token: '' };
    it('keeps a value put in the right box, without the spaces a copy brings', () => {
        expect(routePasted(empty, 'secret', ` ${SECRET} `)).toEqual({ secret: SECRET, token: '', moved: false });
        expect(routePasted(empty, 'token', `${TOKEN}\n`)).toEqual({ secret: '', token: TOKEN, moved: false });
    });
    it('moves a token pasted into the secret box, and a secret pasted into the token box', () => {
        expect(routePasted(empty, 'secret', TOKEN)).toEqual({ secret: '', token: TOKEN, moved: true });
        expect(routePasted(empty, 'token', SECRET)).toEqual({ secret: SECRET, token: '', moved: true });
    });
    it('keeps what was already right in the other box', () => {
        expect(routePasted({ secret: SECRET, token: '' }, 'secret', TOKEN)).toEqual({ secret: SECRET, token: TOKEN, moved: true });
        expect(routePasted({ secret: '', token: TOKEN }, 'token', SECRET)).toEqual({ secret: SECRET, token: TOKEN, moved: true });
    });
    it('leaves half-typed text where it is', () => {
        expect(routePasted(empty, 'secret', '0123')).toEqual({ secret: '0123', token: '', moved: false });
    });
});

describe('setupProblem / readyToConnect', () => {
    it('says nothing while empty, and nothing when both are right', () => {
        expect(setupProblem({ secret: '', token: '' })).toBeNull();
        expect(setupProblem({ secret: SECRET, token: TOKEN })).toBeNull();
        expect(readyToConnect({ secret: SECRET, token: TOKEN })).toBe(true);
    });
    it('names the value that is wrong', () => {
        expect(setupProblem({ secret: 'abc', token: '' })).toContain('Channel secret');
        expect(setupProblem({ secret: SECRET, token: 'short' })).toContain('access token');
        expect(readyToConnect({ secret: SECRET, token: '' })).toBe(false);
    });
});
