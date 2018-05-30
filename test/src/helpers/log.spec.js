import td from 'testdouble';
import sinon from 'sinon';
import { logFactory } from '../../../src/helpers/log';

describe('log helper', () => {
  let sandbox;
  let clock;
  let logger;
  let log;
  const now = new Date();

  beforeEach(() => {
    logger = {
      info: td.function('log'),
      error: td.function('err'),
      warn: td.function('warning'),
    };
    log = logFactory(logger);
    sandbox = sinon.sandbox.create();
    clock = sinon.useFakeTimers(now.getTime());
  });

  afterEach(() => {
    td.reset();
    sandbox.restore();
    clock.restore();
  });

  describe('error', () => {
    const msg = 'Error happened for some reason: ';
    const args = [
      'more detail',
      'arg1',
    ];

    it('logs the message', () => {
      log.error(msg);
      td.verify(logger.error(td.matchers.contains(msg)));
    });

    it('logs additional args', () => {
      log.error(msg, ...args);
      td.verify(logger.error(
        td.matchers.contains(msg),
        td.matchers.contains(args[0]),
        td.matchers.contains(args[1]),
      ));
    });
  });

  describe('warning', () => {
    const msg = 'warning happened for some reason: ';
    const args = [
      'more detail',
      'arg1',
    ];

    it('logs the message', () => {
      log.warning(msg);
      td.verify(logger.warn(td.matchers.contains(msg)));
    });

    it('logs additional args', () => {
      log.warning(msg, ...args);
      td.verify(logger.warn(
        td.matchers.contains(msg),
        td.matchers.contains(args[0]),
        td.matchers.contains(args[1]),
      ));
    });
  });

  describe('success', () => {
    const msg = 'Success happened for some reason: ';
    const args = [
      'more detail',
      'arg1',
    ];

    it('logs the message', () => {
      log.success(msg);
      td.verify(logger.info(td.matchers.contains(msg)));
    });

    it('logs additional args', () => {
      log.success(msg, ...args);
      td.verify(logger.info(
        td.matchers.contains(msg),
        td.matchers.contains(args[0]),
        td.matchers.contains(args[1]),
      ));
    });
  });

  describe('info', () => {
    const msg = 'Info happened for some reason: ';
    const args = [
      'more detail',
      'arg1',
    ];

    it('logs the message', () => {
      log.info(msg);
      td.verify(logger.info(td.matchers.contains(msg)));
    });

    it('logs additional args', () => {
      log.info(msg, ...args);
      td.verify(logger.info(
        td.matchers.contains(msg),
        td.matchers.contains(args[0]),
        td.matchers.contains(args[1]),
      ));
    });
  });

  describe('toFile', () => {
    const filename = 'path/to/file.log';

    let transport;

    beforeEach(() => {
      logger.remove = td.function('.remove');
      logger.add = td.function('.add');

      transport = { name: 'console' };
      logger.transports = [transport];

      log.toFile(filename);
    });

    it('disables logging to the console', () => {
      td.verify(logger.remove(td.matchers.isA(Object)), { times: 1 });
    });

    it('enables logging to the specified file', () => {
      td.verify(logger.add(td.matchers.isA(Function), td.matchers.contains({
        filename,
        json: false,
      })));
    });
  });
});
