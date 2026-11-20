import { describe, expect, it } from 'vitest';
import { decide } from './stop.ts';

const c = (typeErrors: number, testsFailed = 0) => ({
  typeErrors,
  testsFailed,
});
const clean = c(0);

describe('stop rules', () => {
  it('stops green once checks match the baseline', () => {
    expect(decide([c(31), c(9), c(0)], clean)).toMatchObject({
      stop: true,
      status: 'green',
    });
  });

  it("doesn't blame the upgrade for tests that were already red", () => {
    expect(decide([c(5, 2), c(0, 2)], c(0, 2))).toMatchObject({
      stop: true,
      status: 'green',
    });
  });

  it('keeps going while the count falls', () => {
    expect(decide([c(31), c(9), c(2)], clean)).toEqual({ stop: false });
  });

  it('gives up after two iterations without progress', () => {
    expect(decide([c(31), c(9), c(9), c(10)], clean)).toMatchObject({
      stop: true,
      status: 'gave_up',
    });
  });

  it('gives up at the iteration cap', () => {
    expect(
      decide([c(31), c(30), c(29), c(28), c(27), c(26), c(25)], clean)
    ).toMatchObject({
      stop: true,
      status: 'gave_up',
      reason: 'reached 6 iterations',
    });
  });
});
