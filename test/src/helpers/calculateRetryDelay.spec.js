import {
  calculateRetryDelay,
  DELAY_INTERVALS,
  calculateInverseRetryDelay,
  INVERSE_DELAY_INTERVALS,
} from '../../../src/helpers/calculateRetryDelay';

describe('helpers/calculateRetryDelay', () => {
  const len = DELAY_INTERVALS.length;

  for (let i = 0; i < 6; i += 1) {
    it(`returns an exponential delay value for retry count of ${i}`, () => {
      const result = calculateRetryDelay(i);
      expect(result).to.equal(DELAY_INTERVALS[i]);
    });
  }

  it('uses the last interval value as the maximum delay', () => {
    const result = calculateRetryDelay(Number.MAX_SAFE_INTEGER);

    expect(result).to.equal(DELAY_INTERVALS[len - 1]);
  });
});

describe('helpers/calculateInverseRetryDelay', () => {
  for (let i = 5; i >= 0; i -= 1) {
    it(`returns an exponential delay value for retry count of ${i}`, () => {
      const result = calculateInverseRetryDelay(i);
      expect(result).to.equal(INVERSE_DELAY_INTERVALS[i]);
    });
  }

  it('uses the first interval value as the maximum delay', () => {
    const result = calculateInverseRetryDelay(Number.MIN_SAFE_INTEGER);

    expect(result).to.equal(INVERSE_DELAY_INTERVALS[0]);
  });
});
