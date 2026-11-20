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

export type Inference = {
  complete: (messages: ChatMessage[]) => Promise<Result<string>>;
};

export const createInference = (config: InferenceConfig): Inference => ({
  complete: async (messages) => {
    let res: Response;
    try {
      res = await fetch(`${config.baseUrl}/chat/completions`, {
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
    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = body.choices?.[0]?.message?.content;
    return content
      ? ok(content)
      : fail('unavailable', 'Inference returned no content');
  },
});
