const lineClass = (line: string) => {
  if (
    line.startsWith('diff ') ||
    line.startsWith('+++') ||
    line.startsWith('---')
  )
    return 'file';
  if (line.startsWith('+')) return 'add';
  if (line.startsWith('-')) return 'del';
  if (line.startsWith('@@')) return 'hunk';
  return '';
};

export const DiffView = ({ diff }: { diff: string }) => (
  <pre className="diff">
    {diff ? (
      diff.split('\n').map((line, i) => (
        <div key={i} className={lineClass(line)}>
          {line || ' '}
        </div>
      ))
    ) : (
      <div className="muted">No changes.</div>
    )}
  </pre>
);
