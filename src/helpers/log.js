import winston from 'winston';

const consoleTransport = new winston.transports.Console({
  formatter(params) {
    return params.message;
  },
  json: false,
});

const logger = new winston.Logger({
  transports: [
    consoleTransport,
  ],
});

export function logFactory(log) {
  return {
    error(msg, ...args) {
      log.error(msg, ...args);
    },
    warning(msg, ...args) {
      log.warn(msg, ...args);
    },
    success(msg, ...args) {
      log.info(msg, ...args);
    },
    info(msg, ...args) {
      log.info(msg, ...args);
    },

    toFile(filename) {
      // remove the Console transport
      log.remove(consoleTransport);

      // add the file transport
      log.add(winston.transports.File, {
        filename,
        formatter(params) {
          return params.message;
        },
        json: false,
      });
    },
  };
}

export default logFactory(logger);
