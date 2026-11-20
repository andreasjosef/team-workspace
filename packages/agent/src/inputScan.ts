// A heuristic for task text, which may be a customer's words pasted in
// verbatim. It flags, it doesn't block: real protection is the role scope,
// the sandbox and the human approval. A flag puts a warning on the task and
// in the dev's queue, and it's the cue for the demo's containment moment.

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

// The task text goes into the prompt inside these markers, labelled as data.
// Any marker the text itself contains is defused first, so it can't close the
// block early and continue as "instructions".
export const wrapUntrusted = (label: string, text: string) => {
  const safe = text.replace(/<\/?untrusted[^>]*>/gi, '[marker removed]');
  return `<untrusted source="${label}">\n${safe}\n</untrusted>`;
};
