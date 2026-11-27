// PROTOTYPE, throwaway: the receipt's Changes tab with a sample diff, so the
// variants can be judged without running a task. Real tasks get the same
// variants on their Changes tab via `?variant=`.
import { DiffView } from '../components/DiffView.tsx';
import { SAMPLE_DIFF } from '../components/DiffView.prototype.tsx';

const TABS = ['Changes', 'Checks', 'Context', 'Containment', 'Live log'];

export const DiffPrototypePage = () => (
  <main className="focus focus-page">
    <p className="muted small focus-meta">
      PROTOTYPE · sample diff · branch <code>task/proto</code>
    </p>
    <div className="task-head">
      <h1 className="focus-title">
        Discount code rejected when typed in lower case
      </h1>
    </div>
    <section className="receipt">
      <div className="receipt-head">
        <h2>Receipt</h2>
        <a className="receipt-pr" href="#">
          Pull request #42
        </a>
        <div className="tabs" role="tablist">
          {TABS.map((t, i) => (
            <button
              key={t}
              role="tab"
              className={`tab ${i === 0 ? 'active' : ''}`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <div className="receipt-body flush">
        <DiffView diff={SAMPLE_DIFF} />
      </div>
    </section>
  </main>
);
