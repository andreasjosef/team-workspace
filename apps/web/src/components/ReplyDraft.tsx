import type { TaskSnapshot } from '@app/shared';
import { useState } from 'react';
import { replyDraftLabel } from '../taskView.ts';

// The reply the hub drafted for the customer, once the task has ended. The
// rep edits it and copies it into their own tool: the hub never sends
// anything. Shown as plain text in a text box, never rendered.
export const ReplyDraftBox = ({ task }: { task: TaskSnapshot }) => {
  const draft = task.replyDraft;
  if (!draft) return null;
  // A new draft starts a fresh box; edits to the old one don't carry over.
  return (
    <Editor key={draft.text} text={draft.text} label={replyDraftLabel(draft)} />
  );
};

const Editor = ({ text, label }: { text: string; label: string }) => {
  const [value, setValue] = useState(text);
  const [copied, setCopied] = useState(false);
  const copy = () =>
    navigator.clipboard.writeText(value).then(
      () => setCopied(true),
      () => setCopied(false)
    );
  return (
    <section className="reply-draft" aria-label="Reply to the customer">
      <div className="card-label">
        You · reply to the customer
        <span className="card-label-end">{label}</span>
      </div>
      <textarea
        className="reply-draft-text"
        aria-label="Reply text"
        value={value}
        rows={8}
        onChange={(e) => {
          setValue(e.target.value);
          setCopied(false);
        }}
      />
      <div className="actions">
        <button className="btn" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
        <span className="muted small">
          The hub never sends it: check it, then paste it into your reply.
        </span>
      </div>
    </section>
  );
};
