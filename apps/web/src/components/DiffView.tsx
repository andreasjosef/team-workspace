import { Fragment, useState, type ReactNode } from 'react';
import {
  langOf,
  lineSpans,
  parseDiff,
  type DiffLine,
  type FileDiff,
  type Lang,
} from '../diffView.ts';

const Code = ({ line, lang }: { line: DiffLine; lang: Lang }) => (
  <>
    {lineSpans(line, lang).map((s, i) => (
      <span
        key={i}
        className={
          [s.cls && `tk-${s.cls}`, s.changed && 'chg']
            .filter(Boolean)
            .join(' ') || undefined
        }
      >
        {s.text}
      </span>
    ))}
    {line.text === '' && ' '}
  </>
);

const Counts = ({ adds, dels }: { adds: number; dels: number }) => (
  <span className="dv-counts">
    {adds > 0 && <span className="dv-plus">+{adds}</span>}
    {dels > 0 && <span className="dv-minus">−{dels}</span>}
  </span>
);

const Path = ({ path }: { path: string }) => {
  const i = path.lastIndexOf('/');
  return (
    <span className="dv-path">
      <span className="dv-dir">{path.slice(0, i + 1)}</span>
      <span className="dv-name">{path.slice(i + 1)}</span>
    </span>
  );
};

const Chevron = ({ open }: { open: boolean }) => (
  <svg
    className={`dv-chev ${open ? 'open' : ''}`}
    width="12"
    height="12"
    viewBox="0 0 16 16"
    aria-hidden
  >
    <path
      d="M6 4l4 4-4 4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const FileCard = ({
  file,
  children,
}: {
  file: FileDiff;
  children: ReactNode;
}) => {
  const [open, setOpen] = useState(true);
  return (
    <section className="dv-file">
      <button
        className="dv-file-head"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <Chevron open={open} />
        <Path path={file.path} />
        {file.status !== 'modified' && (
          <span className={`dv-badge ${file.status}`}>
            {file.status === 'added' ? 'New' : 'Deleted'}
          </span>
        )}
        <Counts adds={file.adds} dels={file.dels} />
      </button>
      {open && <div className="dv-file-body">{children}</div>}
    </section>
  );
};

const FileTable = ({ file }: { file: FileDiff }) => {
  const lang = langOf(file.path);
  return (
    <table className="dv-code">
      <tbody>
        {file.hunks.map((h, hi) => (
          <Fragment key={hi}>
            <tr className="dv-hunk">
              <td colSpan={4}>
                <span className="dv-hunk-range">{h.range}</span>
                {h.context && (
                  <span className="dv-hunk-ctx">
                    <Code line={{ kind: 'ctx', text: h.context }} lang={lang} />
                  </span>
                )}
              </td>
            </tr>
            {h.lines.map((l, i) => (
              <tr key={i} className={`dv-row ${l.kind}`}>
                <td className="dv-no">{l.oldNo ?? ''}</td>
                <td className="dv-no">{l.newNo ?? ''}</td>
                <td className="dv-sign">
                  {l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ''}
                </td>
                <td className="dv-text">
                  <Code line={l} lang={lang} />
                </td>
              </tr>
            ))}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
};

export const DiffView = ({ diff }: { diff: string }) => {
  const files = parseDiff(diff);
  if (files.length === 0)
    return <div className="dv dv-empty muted">No changes.</div>;
  const adds = files.reduce((n, f) => n + f.adds, 0);
  const dels = files.reduce((n, f) => n + f.dels, 0);
  return (
    <div className="dv">
      <div className="dv-summary">
        <span>
          {files.length} {files.length === 1 ? 'file' : 'files'} changed
        </span>
        <Counts adds={adds} dels={dels} />
      </div>
      {files.map((f) => (
        <FileCard key={f.path} file={f}>
          <FileTable file={f} />
        </FileCard>
      ))}
    </div>
  );
};
