// Tiny Anthropic Messages API client. Mirrors the style of _shared/stripe.ts:
// no SDK dependency (smaller Deno bundle, one obvious file to audit), reads
// the API key from env at call time, pins the model and API version.

export const ANTHROPIC_VERSION = '2023-06-01';
export const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AnthropicCallOptions {
  system?: string;
  messages: AnthropicMessage[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
  // Pass a stable string to enable prompt caching of the system block.
  // The Messages API caches automatically on the system field when this is
  // set, dramatically cutting cost on repeat calls with the same prompt.
  cacheSystem?: boolean;
}

export interface AnthropicCallResult {
  ok: boolean;
  status: number;
  text: string;
  inputTokens: number;
  outputTokens: number;
  error?: string;
}

export function getAnthropicKey(): string {
  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) throw new Error('Edge Function secret ANTHROPIC_API_KEY is not set.');
  return key;
}

export async function anthropicMessages(opts: AnthropicCallOptions): Promise<AnthropicCallResult> {
  const apiKey = getAnthropicKey();
  const model = opts.model || DEFAULT_MODEL;
  const maxTokens = opts.maxTokens ?? 4096;

  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    temperature: opts.temperature ?? 0,
    messages: opts.messages,
  };
  if (opts.system) {
    // Use the structured form so we can mark the block as cacheable.
    if (opts.cacheSystem) {
      body.system = [
        { type: 'text', text: opts.system, cache_control: { type: 'ephemeral' } },
      ];
    } else {
      body.system = opts.system;
    }
  }

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
  });

  let parsed: Record<string, unknown> = {};
  try { parsed = await resp.json(); } catch (_) { parsed = {}; }

  if (!resp.ok) {
    const err = (parsed.error as { message?: string } | undefined)?.message
      || `Anthropic responded ${resp.status}`;
    return { ok: false, status: resp.status, text: '', inputTokens: 0, outputTokens: 0, error: err };
  }

  const content = Array.isArray(parsed.content) ? parsed.content as Array<{ type: string; text?: string }> : [];
  const text = content.filter((c) => c.type === 'text').map((c) => c.text || '').join('');
  const usage = (parsed.usage as { input_tokens?: number; output_tokens?: number } | undefined) || {};

  return {
    ok: true,
    status: resp.status,
    text,
    inputTokens: usage.input_tokens || 0,
    outputTokens: usage.output_tokens || 0,
  };
}

// Helper to pull a JSON object out of a Claude response. Claude usually
// returns clean JSON when asked, but sometimes wraps it in ```json fences
// or adds a stray "Here's the JSON:" preamble — strip both.
export function extractJsonFromText(text: string): unknown {
  const trimmed = text.trim();
  // Strip ```json ... ``` or ``` ... ``` fences if present.
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced ? fenced[1] : trimmed;
  // If there is still text before the first { or after the last }, slice.
  const first = candidate.indexOf('{');
  const last = candidate.lastIndexOf('}');
  if (first < 0 || last < 0 || last <= first) {
    throw new Error('No JSON object found in response.');
  }
  return JSON.parse(candidate.slice(first, last + 1));
}
