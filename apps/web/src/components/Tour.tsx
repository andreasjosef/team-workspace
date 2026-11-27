import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { placeCard, tour, tourSteps, useTourOpen } from '../tour.ts';

type Box = { top: number; left: number; width: number; height: number };
type Layout = { spot: Box | null; card: { top: number; left: number } };

const PAD = 6; // the spotlight's margin around its target

// Finds the step's target, measures it and the card, and places both; again
// on every resize or scroll, so they follow the layout. The first pass waits
// a frame, for the card to render with the step's text.
const useLayout = (
  target: string,
  card: RefObject<HTMLDivElement | null>
): Layout | null => {
  const [layout, setLayout] = useState<Layout | null>(null);
  useLayoutEffect(() => {
    const el = document.querySelector(`[data-tour="${target}"]`);
    el?.scrollIntoView({ block: 'nearest' });
    const measure = () => {
      const r = el?.getBoundingClientRect();
      const spot =
        r && r.width && r.height
          ? {
              top: r.top - PAD,
              left: r.left - PAD,
              width: r.width + PAD * 2,
              height: r.height + PAD * 2,
            }
          : null;
      const c = card.current;
      if (!c) return;
      setLayout({
        spot,
        card: placeCard(
          spot,
          { width: c.offsetWidth, height: c.offsetHeight },
          { width: window.innerWidth, height: window.innerHeight }
        ),
      });
    };
    const frame = requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [target, card]);
  return layout;
};

export const Tour = () => {
  const open = useTourOpen();
  return open ? <TourSteps /> : null;
};

const TourSteps = () => {
  const [step, setStep] = useState(0);
  const current = tourSteps[step]!;
  const last = step === tourSteps.length - 1;
  const card = useRef<HTMLDivElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const layout = useLayout(current.target, card);
  const spot = layout?.spot;

  useEffect(() => next.current?.focus(), [step]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') tour.close();
      if (e.key === 'ArrowRight' && !last) setStep((s) => s + 1);
      if (e.key === 'ArrowLeft' && step > 0) setStep((s) => s - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, last]);

  return (
    <div className="tour">
      {spot ? (
        <div className="tour-spot" style={spot} aria-hidden />
      ) : (
        <div className="tour-dim" aria-hidden />
      )}
      <div
        ref={card}
        className="tour-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        style={layout?.card ?? { visibility: 'hidden' }}
      >
        <p className="tour-count muted small">
          {step + 1} of {tourSteps.length}
        </p>
        <h2 id="tour-title" className="tour-title">
          {current.title}
        </h2>
        <p className="tour-body">{current.body}</p>
        <div className="tour-actions">
          <button className="linkish tour-skip" onClick={() => tour.close()}>
            {last ? 'Close' : 'Skip tour'}
          </button>
          {step > 0 && (
            <button className="btn" onClick={() => setStep(step - 1)}>
              Back
            </button>
          )}
          <button
            ref={next}
            className="btn btn-primary"
            onClick={() => (last ? tour.close() : setStep(step + 1))}
          >
            {last ? 'Try it' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
};
