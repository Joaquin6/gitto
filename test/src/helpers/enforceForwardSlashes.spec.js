import enforceForwardSlashes from '../../../src/helpers/enforceForwardSlashes';

describe('enforceForwardSlashes', () => {
  it('should replace single backward slashes with forward slashes', () =>
    expect(enforceForwardSlashes('/data\\Projects\\Real World Data\\icons'))
      .equal('/data/Projects/Real World Data/icons'));

  it('should replace double backward slashes with forward slashes', () =>
    expect(enforceForwardSlashes('/data\\\\Projects\\\\Real World Data\\\\icons'))
      .equal('/data/Projects/Real World Data/icons'));
});
