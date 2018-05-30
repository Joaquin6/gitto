import bluebird from 'bluebird';

import { INVERSE_DELAY_INTERVALS } from '../../../src/helpers/calculateRetryDelay';

import makeRequest from '../../../src/helpers/requestHandler';

describe('helpers/requestHandler', () => {
  let options;
  let retryCallback;

  beforeEach(() => {
    options = {
      file: 'somefile',
      stat: { size: 736134 },
      dest: 'some/path/dest',
    };

    retryCallback = () => true;
  });

  it('should return value of the method on success', async () => {
    const methodStub = sinon.stub()
      .withArgs(options)
      .resolves('success');

    const response = await makeRequest(methodStub, options, 3, retryCallback);

    expect(response).equal('success');
  });

  describe('when the method call fails', () => {
    let bluebirdDelay;
    let error;
    let retryCount;

    beforeEach(() => {
      error = new Error('BOOM!');
      retryCallback = sinon.stub();
      retryCount = 3;

      bluebirdDelay = bluebird.delay;
      bluebird.delay = sinon.stub().returns(bluebird.resolve());
    });

    afterEach(() => {
      bluebird.delay = bluebirdDelay;
    });

    it('should retry provided method given number of times if the retryCallback is truthy', async () => {
      const methodStub = sinon.stub()
        .withArgs(options)
        .rejects(error)
        .onThirdCall()
        .resolves('success');

      retryCallback.withArgs(error).returns(true);

      await makeRequest(methodStub, options, retryCount, retryCallback);

      expect(methodStub).calledThrice;
      expect(retryCallback).calledTwice;

      expect(bluebird.delay).calledTwice;
      expect(bluebird.delay.firstCall).calledWith(INVERSE_DELAY_INTERVALS[retryCount - 1]);
      expect(bluebird.delay.secondCall).calledWith(INVERSE_DELAY_INTERVALS[retryCount - 2]);
    });

    it('should throw an error after given number of retries', () => {
      const methodStub = sinon.stub()
        .withArgs(options)
        .rejects(error);

      retryCallback.withArgs(error).returns(true);

      const promise = makeRequest(methodStub, options, retryCount, retryCallback);

      return expect(promise).eventually.rejectedWith('BOOM!').then(() => {
        expect(retryCallback).calledThrice;

        expect(bluebird.delay).calledThrice;
        expect(bluebird.delay.firstCall).calledWith(INVERSE_DELAY_INTERVALS[retryCount - 1]);
        expect(bluebird.delay.secondCall).calledWith(INVERSE_DELAY_INTERVALS[retryCount - 2]);
        expect(bluebird.delay.thirdCall).calledWith(INVERSE_DELAY_INTERVALS[retryCount - 3]);
      });
    });

    it('should throw if the retryCallback is not truthy', () => {
      const methodStub = sinon.stub()
        .withArgs(options)
        .rejects(error);

      retryCallback.withArgs(error).returns(false);

      const promise = makeRequest(methodStub, options, retryCount, retryCallback);

      return expect(promise).eventually.rejectedWith('BOOM!').then(() => {
        expect(retryCallback).calledOnce;
      });
    });
  });
});
