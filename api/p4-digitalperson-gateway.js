import crypto from 'node:crypto';

const EXPECTED_AUTH_SHA256 = '95a29bb7be0bc52c679cb3e0ddfcd88420c8a31fb52dbfc7364c61dc05127bec';
const MODEL = 'gpt-5-mini';
const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const MAX_BODY_BYTES = 32_000;

function json(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(status).json(body);
}

function bearer(req) {
  const raw = req.headers.authorization;
  if (typeof raw !== 'string') return null;
  const match = /^Bearer\s+([^\s]+)$/i.exec(raw.trim());
  return match?.[1] ?? null;
}

function authorized(req) {
  const credential = bearer(req);
  if (!credential) return false;
  const digest = crypto.createHash('sha256').update(credential).digest('hex');
  const a = Buffer.from(digest, 'utf8');
  const b = Buffer.from(EXPECTED_AUTH_SHA256, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function extractText(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.output)) return null;
  const chunks = [];
  for (const item of payload.output) {
    if (!item || typeof item !== 'object' || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (part && typeof part === 'object' && part.type === 'output_text' && typeof part.text === 'string') {
        chunks.push(part.text);
      }
    }
  }
  const text = chunks.join('').trim();
  return text || null;
}

function validGrounding(value) {
  return Boolean(value && typeof value === 'object' && value.authorized === true && Array.isArray(value.memories) && Array.isArray(value.citations));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'METHOD_NOT_ALLOWED' });
  if (!authorized(req)) return json(res, 401, { error: 'NOT_AUTHENTICATED' });
  if (!process.env.OPENAI_API_KEY) return json(res, 503, { error: 'PROVIDER_NOT_CONFIGURED' });

  const contentLength = Number(req.headers['content-length'] ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return json(res, 413, { error: 'PAYLOAD_TOO_LARGE' });
  }

  const body = req.body;
  if (!body || typeof body !== 'object') return json(res, 400, { error: 'INVALID_REQUEST' });
  if (body.model !== MODEL) return json(res, 400, { error: 'MODEL_NOT_ADMITTED' });
  if (!Array.isArray(body.tools) || body.tools.length !== 0) return json(res, 400, { error: 'TOOLS_FORBIDDEN' });
  if (typeof body.systemPolicy !== 'string' || !body.systemPolicy.startsWith('You are a read-only Digital Person assistant.')) {
    return json(res, 400, { error: 'POLICY_NOT_ADMITTED' });
  }
  if (typeof body.userInput !== 'string' || !body.userInput.startsWith('[P4_SYNTHETIC]') || body.userInput.length > 2000) {
    return json(res, 400, { error: 'SYNTHETIC_INPUT_REQUIRED' });
  }
  if (!validGrounding(body.grounding)) return json(res, 400, { error: 'GROUNDING_INVALID' });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const upstream = await fetch(OPENAI_RESPONSES_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        store: false,
        tools: [],
        tool_choice: 'none',
        max_output_tokens: 256,
        instructions: `${body.systemPolicy} This is a synthetic-only P4.3 staging rehearsal. Do not infer that any supplied identity or memory is real.`,
        input: [{
          role: 'user',
          content: [{
            type: 'input_text',
            text: JSON.stringify({ userInput: body.userInput, grounding: body.grounding }),
          }],
        }],
      }),
    });
    if (!upstream.ok) return json(res, 503, { error: 'MODEL_PROVIDER_UNAVAILABLE' });
    const payload = await upstream.json();
    const text = extractText(payload);
    if (!text) return json(res, 503, { error: 'MODEL_PROVIDER_RESPONSE_INVALID' });
    return json(res, 200, { text, provider: 'openai', model: typeof payload.model === 'string' ? payload.model : MODEL });
  } catch (error) {
    if (error?.name === 'AbortError') return json(res, 504, { error: 'MODEL_PROVIDER_TIMEOUT' });
    return json(res, 503, { error: 'MODEL_PROVIDER_UNAVAILABLE' });
  } finally {
    clearTimeout(timeout);
  }
}
