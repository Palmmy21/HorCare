import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiError, aiGenerate, aiModel, aiProvider, extractJson } from './_ai.js';
import { parseMeterOcr } from './_meter-ocr.js';

// _meter-ocr pulls in the Firebase helpers at import time; the pure parser doesn't need them.
vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);

const fetchMock = vi.fn();
const ENV_KEYS = ['OPENROUTER_API_KEY', 'GEMINI_API_KEY', 'AI_PROVIDER', 'OPENROUTER_VISION_MODEL', 'OPENROUTER_TEXT_MODEL', 'PUBLIC_APP_URL'];

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const fail = (status: number, text = 'err') => ({ ok: false, status, json: async () => ({}), text: async () => text });
const orReply = (content: unknown) => ok({ choices: [{ message: { content } }] });
const gemReply = (text: string) => ok({ candidates: [{ content: { parts: [{ text }] } }] });

beforeEach(() => {
    for (const k of ENV_KEYS) delete process.env[k];
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('provider selection', () => {
    it('no key → no provider, and generate fails with missing_key', async () => {
        expect(aiProvider()).toBeNull();
        expect(aiModel('vision')).toBeNull();
        await expect(aiGenerate({ kind: 'text', prompt: 'hi' })).rejects.toMatchObject({ code: 'missing_key' });
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it('Gemini key only → Gemini (the original behaviour)', () => {
        process.env.GEMINI_API_KEY = 'g';
        expect(aiProvider()).toBe('gemini');
        expect(aiModel('vision')).toBe('gemini-2.5-flash-lite');
        expect(aiModel('text')).toBe('gemini-2.5-flash');
    });
    it('OpenRouter key wins when both are set, and AI_PROVIDER can force either', () => {
        process.env.GEMINI_API_KEY = 'g';
        process.env.OPENROUTER_API_KEY = 'o';
        expect(aiProvider()).toBe('openrouter');
        process.env.AI_PROVIDER = 'gemini';
        expect(aiProvider()).toBe('gemini');
        process.env.AI_PROVIDER = 'openrouter';
        expect(aiProvider()).toBe('openrouter');
    });
    it('forcing a provider whose key is missing yields no provider (never silently the other one)', () => {
        process.env.GEMINI_API_KEY = 'g';
        process.env.AI_PROVIDER = 'openrouter';
        expect(aiProvider()).toBeNull();
    });
    it('models are configurable per kind', () => {
        process.env.OPENROUTER_API_KEY = 'o';
        expect(aiModel('vision')).toBe('google/gemini-2.5-flash-lite');
        process.env.OPENROUTER_VISION_MODEL = 'openai/gpt-4o-mini';
        process.env.OPENROUTER_TEXT_MODEL = 'anthropic/claude-3.5-haiku';
        expect(aiModel('vision')).toBe('openai/gpt-4o-mini');
        expect(aiModel('text')).toBe('anthropic/claude-3.5-haiku');
    });
});

describe('OpenRouter requests', () => {
    beforeEach(() => { process.env.OPENROUTER_API_KEY = 'or-key'; process.env.PUBLIC_APP_URL = 'https://app.example/'; });

    it('sends an OpenAI-style chat request with image as a data URL, JSON mode, and attribution headers', async () => {
        fetchMock.mockResolvedValue(orReply('{"amount":1500}'));
        const out = await aiGenerate({
            kind: 'vision', prompt: 'read it', system: 'be exact', images: [{ base64: 'AAAA', mimeType: 'image/png' }],
            json: true, temperature: 0, maxTokens: 120,
        });
        expect(out).toBe('{"amount":1500}');
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
        expect(init.headers.Authorization).toBe('Bearer or-key');
        expect(init.headers['HTTP-Referer']).toBe('https://app.example');
        expect(init.headers['X-Title']).toBe('HorCare');
        const body = JSON.parse(init.body);
        expect(body).toMatchObject({ model: 'google/gemini-2.5-flash-lite', temperature: 0, max_tokens: 120, response_format: { type: 'json_object' } });
        expect(body.messages[0]).toEqual({ role: 'system', content: 'be exact' });
        expect(body.messages[1].content).toEqual([
            { type: 'text', text: 'read it' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
        ]);
    });

    it('text-only requests send a plain string and use the text model', async () => {
        fetchMock.mockResolvedValue(orReply('สวัสดี'));
        await aiGenerate({ kind: 'text', prompt: 'hello', temperature: 0.7 });
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.model).toBe('google/gemini-2.5-flash');
        expect(body.messages).toEqual([{ role: 'user', content: 'hello' }]);
        expect(body.response_format).toBeUndefined();
    });

    it('retries once without JSON mode when the model rejects response_format', async () => {
        fetchMock.mockResolvedValueOnce(fail(400)).mockResolvedValueOnce(orReply('{"a":1}'));
        expect(await aiGenerate({ kind: 'text', prompt: 'x', json: true })).toBe('{"a":1}');
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(JSON.parse(fetchMock.mock.calls[1][1].body).response_format).toBeUndefined();
    });

    it('accepts array-style content parts', async () => {
        fetchMock.mockResolvedValue(orReply([{ type: 'text', text: 'ab' }, { type: 'text', text: 'cd' }]));
        expect(await aiGenerate({ kind: 'text', prompt: 'x' })).toBe('abcd');
    });

    it('maps provider failures to short codes', async () => {
        for (const status of [401, 402, 429, 500]) {
            fetchMock.mockResolvedValueOnce(fail(status));
            await expect(aiGenerate({ kind: 'text', prompt: 'x' })).rejects.toMatchObject({ code: `provider_${status}` });
        }
        fetchMock.mockResolvedValueOnce(ok({ error: { message: 'boom' } }));
        await expect(aiGenerate({ kind: 'text', prompt: 'x' })).rejects.toMatchObject({ code: 'provider_error' });
        fetchMock.mockResolvedValueOnce(orReply('   '));
        await expect(aiGenerate({ kind: 'text', prompt: 'x' })).rejects.toMatchObject({ code: 'empty_response' });
        fetchMock.mockResolvedValueOnce(ok({ choices: [] }));
        await expect(aiGenerate({ kind: 'text', prompt: 'x' })).rejects.toBeInstanceOf(AiError);
    });

    it('network failures and timeouts are reported, not thrown raw', async () => {
        fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));
        await expect(aiGenerate({ kind: 'text', prompt: 'x' })).rejects.toMatchObject({ code: 'network' });
        const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
        fetchMock.mockRejectedValueOnce(abort);
        await expect(aiGenerate({ kind: 'text', prompt: 'x' })).rejects.toMatchObject({ code: 'timeout' });
    });

    it('never leaks the API key in errors', async () => {
        fetchMock.mockResolvedValue(fail(401, 'bad key or-key'));
        const err = await aiGenerate({ kind: 'text', prompt: 'x' }).then(() => new Error('did not throw'), (e: Error) => e);
        expect(err.message).toBe('OpenRouter error 401');
        expect(err.message).not.toContain('or-key');
    });
});

describe('Gemini fallback', () => {
    beforeEach(() => { process.env.GEMINI_API_KEY = 'g-key'; });

    it('uses generateContent with inline image data, JSON mime type and the system text prepended', async () => {
        fetchMock.mockResolvedValue(gemReply('{"x":1}'));
        const out = await aiGenerate({
            kind: 'vision', prompt: 'read', system: 'rules', images: [{ base64: 'BBBB', mimeType: 'image/jpeg' }],
            json: true, temperature: 0, maxTokens: 200,
        });
        expect(out).toBe('{"x":1}');
        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toContain('gemini-2.5-flash-lite:generateContent?key=g-key');
        const body = JSON.parse(init.body);
        expect(body.contents[0].parts[0].text).toBe('rules\n\nread');
        expect(body.contents[0].parts[1]).toEqual({ inline_data: { mime_type: 'image/jpeg', data: 'BBBB' } });
        expect(body.generationConfig).toEqual({ temperature: 0, maxOutputTokens: 200, responseMimeType: 'application/json' });
    });

    it('reports provider errors with codes', async () => {
        fetchMock.mockResolvedValueOnce(fail(429));
        await expect(aiGenerate({ kind: 'text', prompt: 'x' })).rejects.toMatchObject({ code: 'provider_429' });
        fetchMock.mockResolvedValueOnce(gemReply(''));
        await expect(aiGenerate({ kind: 'text', prompt: 'x' })).rejects.toMatchObject({ code: 'empty_response' });
    });
});

describe('extractJson', () => {
    it('parses plain JSON, fenced JSON and JSON surrounded by prose', () => {
        expect(extractJson('{"a":1}')).toEqual({ a: 1 });
        expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
        expect(extractJson('Sure! Here you go: {"a": {"b": 2}} hope that helps')).toEqual({ a: { b: 2 } });
    });
    it('returns null for anything that is not parseable', () => {
        for (const s of ['', 'no json here', '{broken', '}{']) expect(extractJson(s)).toBeNull();
    });
});

describe('meter OCR parsing tolerates fenced model output', () => {
    it('reads a fenced reply', () => {
        const r = parseMeterOcr('```json\n{"room_number":"305","reading":1285,"meter_type":"electric","confidence":0.9,"note":""}\n```');
        expect(r).toMatchObject({ room_number: '305', reading: 1285, meter_type: 'electric', confidence: 0.9 });
    });
});
