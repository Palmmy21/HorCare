// In-memory stand-in for ./_firebase.js, used only by the *.test.ts files.
// Supports the small slice of the Admin SDK these routes use: doc/collection get/set/
// update/delete, where('==') queries, transactions, FieldValue sentinels and auth.

const DELETE_FIELD = Symbol('delete-field');

type Data = Record<string, unknown>;
const store = new Map<string, Data>();
const authUsers = new Map<string, { uid: string; email: string; displayName?: string; password?: string; emailVerified?: boolean; disabled?: boolean }>();
export const revoked: string[] = [];
let failWritePrefix: string | null = null;

function snap(path: string) {
    const data = store.get(path);
    return {
        id: path.split('/').pop() as string,
        exists: data !== undefined,
        data: () => (data === undefined ? undefined : structuredClone(data)),
        ref: docRef(path),
    };
}

function applyPatch(base: Data, patch: Data): Data {
    const next = { ...base };
    for (const [k, v] of Object.entries(patch)) {
        if (v === DELETE_FIELD) delete next[k]; else next[k] = v;
    }
    return next;
}

function docRef(path: string) {
    return {
        path,
        id: path.split('/').pop() as string,
        get: async () => snap(path),
        set: async (data: Data, opts?: { merge?: boolean }) => {
            if (failWritePrefix && path.startsWith(failWritePrefix)) throw new Error('write failed');
            // structuredClone cannot copy the delete sentinel (a Symbol), so apply the patch before cloning
            store.set(path, structuredClone(applyPatch(opts?.merge ? store.get(path) ?? {} : {}, data)));
        },
        /** Like Firestore: fails with ALREADY_EXISTS (code 6) when the document is there. */
        create: async (data: Data) => {
            if (store.has(path)) throw Object.assign(new Error(`ALREADY_EXISTS: ${path}`), { code: 6 });
            store.set(path, structuredClone(data));
        },
        update: async (patch: Data) => {
            const cur = store.get(path);
            if (!cur) throw new Error(`NOT_FOUND: ${path}`);
            store.set(path, applyPatch(cur, patch));
        },
        delete: async () => { store.delete(path); },
    };
}

type Filter = [string, string, unknown];

/** Like Firestore, a document without the field never matches a filter on it. */
function matches(d: Data, [f, op, v]: Filter): boolean {
    if (!(f in d)) return false;
    const x = d[f] as string | number;
    switch (op) {
        case '==': return x === v;
        case 'in': return (v as unknown[]).includes(x);
        case '>=': return x >= (v as string | number);
        case '<=': return x <= (v as string | number);
        default: throw new Error(`fake firestore does not support ${op}`);
    }
}

function collectionRef(path: string, filters: Filter[] = []) {
    const run = () => [...store.keys()]
        .filter(p => p.startsWith(path + '/') && !p.slice(path.length + 1).includes('/'))
        .map(p => snap(p))
        .filter(s => filters.every(f => matches(s.data() as Data, f)));
    return {
        // like Firestore, doc() with no id makes a new random one
        doc: (id?: string) => docRef(`${path}/${id ?? `auto${Math.random().toString(36).slice(2, 12)}`}`),
        where: (field: string, op: string, value: unknown) => collectionRef(path, [...filters, [field, op, value]]),
        get: async () => { const docs = run(); return { docs, empty: docs.length === 0, size: docs.length }; },
        /** aggregation queries: count(), and sum() via admin.firestore.AggregateField.sum */
        count: () => ({ get: async () => { const n = run().length; aggregateCalls.push('count'); return { data: () => ({ count: n }) }; } }),
        aggregate: (spec: Record<string, { sum: string }>) => ({
            get: async () => {
                const docs = run();
                aggregateCalls.push('aggregate');
                const out: Record<string, number> = {};
                for (const [k, { sum }] of Object.entries(spec)) out[k] = docs.reduce((t, d) => t + (Number((d.data() as Data)[sum]) || 0), 0);
                return { data: () => out };
            },
        }),
    };
}

/** Aggregation queries run since the last reset (tests check a route counts instead of reading). */
export const aggregateCalls: string[] = [];

/** Every document in a collection with this id, at any depth (only == filters, like the rest of the fake). */
function collectionGroupRef(id: string, filters: [string, unknown][] = []) {
    return {
        where: (field: string, op: string, value: unknown) => {
            if (op !== '==') throw new Error('fake firestore only supports ==');
            return collectionGroupRef(id, [...filters, [field, value]]);
        },
        get: async () => {
            const docs = [...store.keys()]
                .filter(p => { const parts = p.split('/'); return parts.length % 2 === 0 && parts[parts.length - 2] === id; })
                .map(p => snap(p))
                .filter(s => filters.every(([f, v]) => (s.data() as Data)[f] === v));
            return { docs, empty: docs.length === 0, size: docs.length };
        },
    };
}

export const db = {
    doc: (path: string) => docRef(path),
    collection: (path: string) => collectionRef(path),
    collectionGroup: (id: string) => collectionGroupRef(id),
    getAll: (...refs: { get: () => Promise<unknown> }[]) => Promise.all(refs.map(r => r.get())),
    /** Writes queued, applied together on commit (like a Firestore WriteBatch). */
    batch: () => {
        const ops: (() => Promise<void>)[] = [];
        const b = {
            set: (ref: { set: (d: Data, o?: { merge?: boolean }) => Promise<void> }, d: Data, o?: { merge?: boolean }) => { ops.push(() => ref.set(d, o)); return b; },
            update: (ref: { update: (d: Data) => Promise<void> }, d: Data) => { ops.push(() => ref.update(d)); return b; },
            delete: (ref: { delete: () => Promise<void> }) => { ops.push(() => ref.delete()); return b; },
            commit: async () => { for (const op of ops) await op(); },
        };
        return b;
    },
    runTransaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn({
        get: (ref: { get: () => Promise<unknown> }) => ref.get(),
        getAll: (...refs: { get: () => Promise<unknown> }[]) => Promise.all(refs.map(r => r.get())),
        set: (ref: { set: (d: Data, o?: { merge?: boolean }) => Promise<void> }, d: Data, o?: { merge?: boolean }) => { void ref.set(d, o); },
        update: (ref: { update: (d: Data) => Promise<void> }, d: Data) => { void ref.update(d); },
        delete: (ref: { delete: () => Promise<void> }) => { void ref.delete(); },
    }),
};

export const admin = {
    auth: () => ({
        verifyIdToken: async (token: string) => {
            // test tokens look like "tok:<uid>"
            const uid = token.startsWith('tok:') ? token.slice(4) : '';
            const u = authUsers.get(uid);
            if (!u) throw new Error('invalid token');
            return { uid: u.uid, email: u.email, name: u.displayName };
        },
        getUser: async (uid: string) => {
            const u = authUsers.get(uid);
            if (!u) throw new Error('auth/user-not-found');
            return u;
        },
        createUser: async (u: { email: string; password: string; displayName?: string; emailVerified?: boolean }) => {
            if ([...authUsers.values()].some(x => x.email === u.email)) throw new Error('auth/email-already-exists');
            const uid = `new-${authUsers.size + 1}-${u.email.split('@')[0]}`;
            authUsers.set(uid, { uid, email: u.email, displayName: u.displayName, password: u.password, emailVerified: u.emailVerified === true, disabled: false });
            return authUsers.get(uid)!;
        },
        updateUser: async (uid: string, patch: { password?: string; disabled?: boolean }) => {
            const u = authUsers.get(uid);
            if (!u) throw new Error('auth/user-not-found');
            Object.assign(u, patch);
            return u;
        },
        revokeRefreshTokens: async (uid: string) => { revoked.push(uid); },
        /** test custom tokens are the JSON of what would be signed */
        createCustomToken: async (uid: string, claims?: object) => JSON.stringify({ uid, claims }),
        getUserByEmail: async (email: string) => {
            const u = [...authUsers.values()].find(x => x.email === email);
            if (!u) throw new Error('auth/user-not-found');
            return u;
        },
    }),
    firestore: {
        FieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }), delete: () => DELETE_FIELD },
        AggregateField: { sum: (field: string) => ({ sum: field }) },
        // plain data (documents are cloned on write): enough for code that only stores an expiry
        Timestamp: { fromMillis: (ms: number) => ({ seconds: Math.floor(ms / 1000), nanoseconds: (ms % 1000) * 1e6 }) },
    },
};

export const firebaseMock = { db, admin };

// ── test helpers ─────────────────────────────────────────────────────────────
export function resetFake() { store.clear(); authUsers.clear(); revoked.length = 0; failWritePrefix = null; aggregateCalls.length = 0; }
/** Make every set() under this path prefix throw (null to stop). */
export function failWritesTo(prefix: string | null) { failWritePrefix = prefix; }
export function seed(path: string, data: object) { store.set(path, structuredClone(data) as Data); }
export function read(path: string) { return store.get(path); }
/** A tenant portal link for a room (see _portal-link.ts); returns the packed value the portal sends as `portal`. */
export function seedPortalLink(ownerUid: string, buildingId: string, roomId: string, secret = 'SECRETsecretSECRETsecret12345678') {
    store.set(`portal_links/${ownerUid}__${buildingId}__${roomId}`, { owner_uid: ownerUid, building_id: buildingId, room_id: roomId, secret });
    return [ownerUid, buildingId, roomId, secret].join('~');
}
export function listPaths(prefix: string) { return [...store.keys()].filter(p => p.startsWith(prefix)); }
export function addAuthUser(uid: string, email: string, displayName?: string) {
    authUsers.set(uid, { uid, email, displayName });
}

export function fakeReq(body: unknown, uid?: string, method = 'POST') {
    return {
        method,
        body,
        headers: uid ? { authorization: `Bearer tok:${uid}` } : {},
        query: {},
        socket: { remoteAddress: '203.0.113.9' },
    } as never;
}

export function fakeRes() {
    const res = {
        statusCode: 0,
        body: undefined as unknown,
        status(code: number) { res.statusCode = code; return res; },
        json(b: unknown) { res.body = b; return res; },
        send(b: unknown) { res.body = b; return res; },
    };
    return res;
}
/** The password a fake auth user was created or reset with (for faking Firebase Auth's password check). */
export function authPassword(email: string) { return [...authUsers.values()].find(x => x.email === email)?.password; }
