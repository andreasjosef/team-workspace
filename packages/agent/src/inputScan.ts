// A heuristic for task text, which may be a customer's words pasted in
// verbatim. A flagged report ends flagged before the sandbox and the model
// see it (pipeline.ts), but the scanner is no wall: a report it misses runs
// as any other, and real protection is the role scope, the sandbox and the
// developer's review. A flag is the cue for the demo's containment moment.

const SIGNALS: [RegExp, string][] = [
  [
    /\b(ignore|disregard|forget)\b.{0,30}\b(previous|prior|above|earlier|all)\b.{0,20}\b(instructions?|rules?|prompts?)\b/i,
    'tries to override instructions',
  ],
  [
    /\b(you are now|act as|new instructions|system prompt)\b/i,
    'addresses the agent directly',
  ],
  [
    /\.env\b|\bapi[_ -]?key\b|\bsecret\b|\btoken\b|\bpassword\b|\bcredentials?\b/i,
    'asks about secrets',
  ],
  [
    /\b(add|create|make)\b.{0,30}\b(admin|superuser|root)\b/i,
    'asks for elevated access',
  ],
  [/\bhttps?:\/\/[^\s)]+/i, 'contains a URL'],
  [
    /\b(curl|wget|rm -rf|chmod|child_process|eval\()/i,
    'contains shell or code commands',
  ],
  [/[A-Za-z0-9+/]{60,}={0,2}/, 'contains a long encoded blob'],
];

export const scanTaskInput = (text: string): string[] =>
  SIGNALS.filter(([re]) => re.test(text)).map(([, signal]) => signal);

// A report's title goes into the prompt and the pull request's title, so it
// is scanned with the text.
export const scanReport = (input: { title: string; text: string }) =>
  scanTaskInput(`${input.title}\n${input.text}`);

// Why a flagged report ended before the agent worked on it: the signals,
// never the text.
export const flaggedReason = (signals: string[]) =>
  `The report carried instructions (${signals.join(', ')}), so the agent didn't work on it`;

// The task text goes into the prompt inside these markers, labelled as data.
// Any marker the text itself contains is defused first, so it can't close the
// block early and continue as "instructions".
export const wrapUntrusted = (label: string, text: string) => {
  const safe = text.replace(/<\/?untrusted[^>]*>/gi, '[marker removed]');
  return `<untrusted source="${label}">\n${safe}\n</untrusted>`;
};
