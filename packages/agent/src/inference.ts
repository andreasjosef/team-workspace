import { fail, ok, type Result } from '@app/shared';

// Vultr Serverless Inference speaks the OpenAI chat-completions API. A plain
// fetch keeps this dependency-free; swap in the openai SDK if streaming is
// wanted later.

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type InferenceConfig = {
  baseUrl: string; // https://api.vultrinference.com/v1
  apiKey: string;
  model: string;
  timeoutMs?: number;
};

// What a call cost, as the API reported it. Each count may be missing.
export type Usage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

// One reply, with why it ended (`stop`, `length`, `content_filter`, ...) and
// what it cost. Both are the API's word, `null` when it didn't say.
export type Completion = {
  content: string;
  finishReason: string | null;
  usage: Usage | null;
};

export type Inference = {
  complete: (messages: ChatMessage[]) => Promise<Result<Completion>>;
};

// Tests pass a stubbed fetch; the hub uses the global one.
export type InferenceDeps = { fetch?: typeof fetch };

type ApiBody = {
  choices?: { message?: { content?: unknown }; finish_reason?: unknown }[];
  usage?: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    total_tokens?: unknown;
  };
};

const count = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

const readUsage = (raw: ApiBody['usage']): Usage | null => {
  if (!raw || typeof raw !== 'object') return null;
  const usage: Usage = {};
  const prompt = count(raw.prompt_tokens);
  const completion = count(raw.completion_tokens);
  const total = count(raw.total_tokens);
  if (prompt !== undefined) usage.promptTokens = prompt;
  if (completion !== undefined) usage.completionTokens = completion;
  if (total !== undefined) usage.totalTokens = total;
  return Object.keys(usage).length ? usage : null;
};

// One line for the task log: why the reply ended and what it cost.
export const describeCompletion = ({ finishReason, usage }: Completion) => {
  const tokens = usage
    ? [
        `${usage.promptTokens ?? '?'} prompt`,
        `${usage.completionTokens ?? '?'} completion`,
        `${usage.totalTokens ?? '?'} total`,
      ].join(', ')
    : 'not reported';
  return `Model call: finish_reason ${finishReason ?? 'not reported'}, tokens ${tokens}`;
};

export const createInference = (
  config: InferenceConfig,
  deps: InferenceDeps = {}
): Inference => ({
  complete: async (messages) => {
    const fetchImpl = deps.fetch ?? fetch;
    let res: Response;
    try {
      res = await fetchImpl(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: config.model,
          messages,
          temperature: 0.1,
        }),
        signal: AbortSignal.timeout(config.timeoutMs ?? 120_000),
      });
    } catch (err) {
      return fail('unavailable', `Inference request failed: ${String(err)}`);
    }
    if (!res.ok) {
      // The body may echo the request; keep only the status and a short head.
      const head = (await res.text().catch(() => '')).slice(0, 300);
      return fail('unavailable', `Inference answered ${res.status}: ${head}`);
    }
    let body: ApiBody;
    try {
      body = (await res.json()) as ApiBody;
    } catch (err) {
      return fail('unavailable', `Inference answered non-JSON: ${String(err)}`);
    }
    const choice = body?.choices?.[0];
    const content = choice?.message?.content;
    const finishReason =
      typeof choice?.finish_reason === 'string' ? choice.finish_reason : null;
    // An empty reply names its finish_reason, so a content filter can be told
    // apart from running out of output tokens.
    if (typeof content !== 'string' || !content)
      return fail(
        'unavailable',
        `Inference returned no content (finish_reason: ${finishReason ?? 'not reported'})`
      );
    return ok({ content, finishReason, usage: readUsage(body.usage) });
  },
});
