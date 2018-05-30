import Promise from 'bluebird';

import { calculateInverseRetryDelay } from './calculateRetryDelay';

export default async function makeRequest(method, options, attemptsRemaining, retryCallback) {
  let response;

  try {
    response = await method(options);
  } catch (e) {
    if (attemptsRemaining > 0 && retryCallback(e)) {
      const attempts = attemptsRemaining - 1;
      const retryDelay = calculateInverseRetryDelay(attempts);

      return Promise.delay(retryDelay).then(() =>
        makeRequest(method, options, attempts, retryCallback));
    }
    throw e;
  }

  return response;
}
