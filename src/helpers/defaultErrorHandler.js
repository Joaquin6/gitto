// import HttpError from 'standard-http-error';

export default function defaultErrorHandler(error) {
  // http error
  if (typeof error.code === 'number') {
    return error.code >= 500;
  }

  // system error
  if (typeof error.code === 'string') {
    return [
      // request timeout
      'ETIMEDOUT',
      // response connection cut-off, e.g. server response connection severed
      'ECONNABORTED',
      // request connection closed
      'ECONNRESET',
      // error piping data from one stream to another, potentially due to one of the above
      // XXX: This may require additional testing to verify if this is _truly_ a retryable case
      'EPIPE',
    ].includes(error.code);
  }

  return false;
}

// (err) => defaultErrorHandler(err) || mySpecificHandler(err)
