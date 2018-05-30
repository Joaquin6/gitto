import defaultErrorHandler from '../../../src/helpers/defaultErrorHandler';

describe('helpers/defaultErrorHandler', () => {
  let error;

  beforeEach(() => {
    error = new Error('BOOM!');
  });

  it('returns false if the error is not easily handle-able', () => {
    expect(defaultErrorHandler(error)).to.equal(false);
  });

  describe('when the error is an HTTP error', () => {
    it('returns true when the error is from a 5XX response', () => {
      error.code = 500;

      expect(defaultErrorHandler(error)).to.equal(true);
    });

    it('returns false when the error is a 4XX response', () => {
      error.code = 400;

      expect(defaultErrorHandler(error)).to.equal(false);
    });
  });

  describe('when the error is a System error', () => {
    [
      'ETIMEDOUT',
      'ECONNABORTED',
      'ECONNRESET',
      'EPIPE',
    ].forEach((code) => {
      it(`returns true when the error is an ${code} error`, () => {
        error.code = code;

        expect(defaultErrorHandler(error)).to.equal(true);
      });
    });
  });
});
