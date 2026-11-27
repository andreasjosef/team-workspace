import { describe, expect, it } from 'vitest';
import { createInference, describeCompletion } from './inference.ts';

const config = {
  baseUrl: 'http://inference.invalid/v1',
  apiKey: 'test-key',
  model: 'test-model',
};

// A fetch that answers every call with `body` (JSON) and records the calls.
const stubFetch = (body: unknown, status = 200) => {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
};

const messages = [{ role: 'user' as const, content: 'hello' }];

describe('createInference', () => {
  it('returns the content with its finish_reason and token usage', async () => {
    const stub = stubFetch({
      choices: [
        { message: { content: '{"edits":[]}' }, finish_reason: 'stop' },
      ],
      usage: { prompt_tokens: 1200, completion_tokens: 80, total_tokens: 1280 },
    });
    const out = await createInference(config, stub).complete(messages);
    expect(out).toEqual({
      success: true,
      value: {
        content: '{"edits":[]}',
        finishReason: 'stop',
        usage: { promptTokens: 1200, completionTokens: 80, totalTokens: 1280 },
      },
    });
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0]!.url).toBe(
      'http://inference.invalid/v1/chat/completions'
    );
    expect(JSON.parse(String(stub.calls[0]!.init?.body))).toMatchObject({
      model: 'test-model',
      messages,
    });
  });

  it('fails an empty reply with a message naming its finish_reason', async () => {
    for (const reason of ['length', 'content_filter']) {
      const stub = stubFetch({
        choices: [{ message: { content: '' }, finish_reason: reason }],
        usage: {
          prompt_tokens: 1200,
          completion_tokens: 0,
          total_tokens: 1200,
        },
      });
      const out = await createInference(config, stub).complete(messages);
      expect(out.success).toBe(false);
      if (!out.success) {
        expect(out.code).toBe('unavailable');
        expect(out.message).toContain(`finish_reason: ${reason}`);
      }
    }
    const silent = stubFetch({ choices: [{ message: {} }] });
    const out = await createInference(config, silent).complete(messages);
    expect(!out.success && out.message).toContain(
      'finish_reason: not reported'
    );
  });

  it('accepts a reply without usage, or with only some counts', async () => {
    const none = stubFetch({
      choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }],
    });
    expect(await createInference(config, none).complete(messages)).toEqual({
      success: true,
      value: { content: 'hi', finishReason: 'stop', usage: null },
    });
    const some = stubFetch({
      choices: [{ message: { content: 'hi' } }],
      usage: { total_tokens: 42 },
    });
    expect(await createInference(config, some).complete(messages)).toEqual({
      success: true,
      value: { content: 'hi', finishReason: null, usage: { totalTokens: 42 } },
    });
  });

  it('fails a non-2xx answer with the status', async () => {
    const stub = stubFetch({ error: 'busy' }, 503);
    const out = await createInference(config, stub).complete(messages);
    expect(!out.success && out.message).toContain('Inference answered 503');
  });
});

describe('describeCompletion', () => {
  it('names the finish_reason and each token count, or says what is missing', () => {
    expect(
      describeCompletion({
        content: 'x',
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 },
      })
    ).toBe(
      'Model call: finish_reason stop, tokens 10 prompt, 2 completion, 12 total'
    );
    expect(
      describeCompletion({ content: 'x', finishReason: null, usage: null })
    ).toBe('Model call: finish_reason not reported, tokens not reported');
  });
});
