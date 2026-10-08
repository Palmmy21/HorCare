/**
 * One entry point for every AI call (meter reading, slip amounts, Nong Care chat).
 *
 * Provider is chosen by environment:
 *   • OPENROUTER_API_KEY set  → OpenRouter (OpenAI-compatible /chat/completions)
 *   • otherwise GEMINI_API_KEY → Google Gemini directly (the original behaviour)
 * Set AI_PROVIDER=gemini|openrouter to force one when both keys exist, which makes it easy
 * to switch back without deleting a key.
 *
 * Model output is untrusted input: callers must validate what they extract from it.
 */
// Sent to OpenRouter as the app's identity (attribution / rankings); not a secret.
const appBaseUrl = () => (process.env.PUBLIC_APP_URL || 'https://hor-care.vercel.app').replace(/\/$/, '');

export interface AiImage { base64: string; mimeType: string }

export interface AiRequest {
    /** 'vision' = reads images (meters, slips); 'text' = chat. Each has its own model setting. */
    kind: 'vision' | 'text';
    prompt: string;
    system?: string;
    images?: AiImage[];
    /** Ask for a JSON object back. */
    json?: boolean;
    temperature?: number;
    maxTokens?: number;
}

/** `code` is short and safe to show in the UI when diagnosing a failure. */
export class AiError extends Error {
    code: string;
    constructor(code: string, message: string) { super(message); this.code = code; }
}

export type AiProvider = 'openrouter' | 'gemini';

// Defaults keep the Gemini family (what the app was tuned with); override per deployment.
const OPENROUTER_DEFAULT_MODELS = { vision: 'google/gemini-2.5-flash-lite', text: 'google/gemini-2.5-flash' } as const;
const GEMINI_MODELS = { vision: 'gemini-2.5-flash-lite', text: 'gemini-2.5-flash' } as const;
const TIMEOUT_MS = 25_000;

export function aiProvider(): AiProvider | null {
    const forced = process.env.AI_PROVIDER?.toLowerCase();
    if (forced === 'gemini') return process.env.GEMINI_API_KEY ? 'gemini' : null;
    if (forced === 'openrouter') return process.env.OPENROUTER_API_KEY ? 'openrouter' : null;
    if (process.env.OPENROUTER_API_KEY) return 'openrouter';
    if (process.env.GEMINI_API_KEY) return 'gemini';
    return null;
}

/** The model that will be used for a kind of request (for logs / diagnostics). */
export function aiModel(kind: AiRequest['kind']): string | null {
    const p = aiProvider();
    if (p === 'openrouter') {
        return (kind === 'vision' ? process.env.OPENROUTER_VISION_MODEL : process.env.OPENROUTER_TEXT_MODEL) || OPENROUTER_DEFAULT_MODELS[kind];
    }
    return p === 'gemini' ? GEMINI_MODELS[kind] : null;
}

async function post(url: string, init: { headers: Record<string, string>; body: unknown }): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
        return await fetch(url, { method: 'POST', headers: init.headers, body: JSON.stringify(init.body), signal: ctrl.signal });
    } catch (err) {
        throw new AiError((err as Error).name === 'AbortError' ? 'timeout' : 'network', `AI request failed: ${(err as Error).message}`);
    } finally {
        clearTimeout(timer);
    }
}

async function viaOpenRouter(req: AiRequest): Promise<string> {
    const model = aiModel(req.kind)!;
    const userContent: unknown = req.images?.length
        ? [
            { type: 'text', text: req.prompt },
            ...req.images.map(i => ({ type: 'image_url', image_url: { url: `data:${i.mimeType};base64,${i.base64}` } })),
        ]
        : req.prompt;
    const baseBody = {
        model,
        messages: [
            ...(req.system ? [{ role: 'system', content: req.system }] : []),
            { role: 'user', content: userContent },
        ],
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
    };
    const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': appBaseUrl(),
        'X-Title': 'HorCare',
    };
    const url = 'https://openrouter.ai/api/v1/chat/completions';

    let resp = await post(url, { headers, body: req.json ? { ...baseBody, response_format: { type: 'json_object' } } : baseBody });
    // Not every model supports JSON mode; retry once without it (the prompt still asks for JSON).
    if (req.json && resp.status === 400) resp = await post(url, { headers, body: baseBody });

    if (!resp.ok) {
        console.error('[ai] openrouter', resp.status, (await resp.text().catch(() => '')).slice(0, 300));
        throw new AiError(`provider_${resp.status}`, `OpenRouter error ${resp.status}`);
    }
    const data = await resp.json() as {
        choices?: { message?: { content?: string | { type?: string; text?: string }[] } }[];
        error?: { message?: string };
    };
    if (data.error) throw new AiError('provider_error', `OpenRouter: ${data.error.message}`);
    const content = data.choices?.[0]?.message?.content;
    const text = Array.isArray(content) ? content.map(p => p.text ?? '').join('') : (content ?? '');
    if (!text.trim()) throw new AiError('empty_response', 'AI returned no text');
    return text;
}

async function viaGemini(req: AiRequest): Promise<string> {
    const model = GEMINI_MODELS[req.kind];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
    const text = req.system ? `${req.system}\n\n${req.prompt}` : req.prompt;
    const resp = await post(url, {
        headers: { 'Content-Type': 'application/json' },
        body: {
            contents: [{
                role: 'user',
                parts: [{ text }, ...(req.images ?? []).map(i => ({ inline_data: { mime_type: i.mimeType, data: i.base64 } }))],
            }],
            generationConfig: {
                ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
                ...(req.maxTokens ? { maxOutputTokens: req.maxTokens } : {}),
                ...(req.json ? { responseMimeType: 'application/json' } : {}),
            },
        },
    });
    if (!resp.ok) {
        console.error('[ai] gemini', resp.status, (await resp.text().catch(() => '')).slice(0, 300));
        throw new AiError(`provider_${resp.status}`, `Gemini error ${resp.status}`);
    }
    const data = await resp.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[]; error?: { message?: string } };
    if (data.error) throw new AiError('provider_error', `Gemini: ${data.error.message}`);
    const out = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!out?.trim()) throw new AiError('empty_response', 'AI returned no text');
    return out;
}

/** Run a request and return the model's raw text. Throws AiError (never returns an empty string). */
export async function aiGenerate(req: AiRequest): Promise<string> {
    const provider = aiProvider();
    if (!provider) throw new AiError('missing_key', 'No AI API key configured (OPENROUTER_API_KEY or GEMINI_API_KEY)');
    return provider === 'openrouter' ? viaOpenRouter(req) : viaGemini(req);
}

/**
 * Pull a JSON value out of a model reply. Tolerates ```json fences and prose around the
 * object, which some models add even in JSON mode. Returns null if nothing parses.
 */
export function extractJson(text: string): unknown {
    const cleaned = text.replace(/```(?:json)?/gi, '').trim();
    try { return JSON.parse(cleaned); } catch { /* fall through */ }
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) {
        try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { /* fall through */ }
    }
    return null;
}
