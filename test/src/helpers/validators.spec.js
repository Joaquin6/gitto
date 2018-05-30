import program from 'commander';
import { ensureDir, remove, writeFile } from 'fs-extra';
import { resolve } from 'path';

import {
  parseAccessTokenFile,
  required,
  validateLogfile,
  validateRetryCount,
} from '../../../src/helpers/validators';

describe('helpers/validators', () => {
  describe('required', () => {
    let requiredFlags;

    program
      .option('-F, --foo [value]', 'some options for foo')
      .option('-B, --bar [value]', 'some options for bar')
      .option('-Z, --baz [value]', 'some options for baz');

    program.allowUnknownOption = true;

    beforeEach(() => {
      requiredFlags = ['foo', 'bar', 'baz'];
      sinon.stub(program, 'help');
    });

    afterEach(() => program.help.restore());

    it('required option is missing', () => {
      const command = 'node test --foo fooVal --bar barVal';
      program.parse(command.split(' '));
      required(requiredFlags);
      expect(program.help.called).equal(true);
    });

    it('required option is passed without a value', () => {
      const command = 'node test --foo fooVal --bar barVal -Z';
      program.parse(command.split(' '));
      required(requiredFlags);
      expect(program.help.called).equal(true);
    });

    it('all required options are present', () => {
      const command = 'node test --foo fooVal --bar barVal --baz bazVal';
      program.parse(command.split(/\s/g));
      required(requiredFlags);
      expect(program.help.called).equal(false);
    });
  });

  describe('validateRetryCount', () => {
    const randomNumberBetween0and5 = Math.floor(Math.random() * 6);

    it('value is set to true', async () =>
      expect(await validateRetryCount(true)).equal(3));

    it('value is set to 0', async () =>
      expect(await validateRetryCount(0)).equal(0));

    it('value is set to any value between 0 and 5', async () =>
      expect(await validateRetryCount(randomNumberBetween0and5))
        .equal(randomNumberBetween0and5));

    it('value is set to a stringified number', async () =>
      expect(await validateRetryCount('3')).equal(3));

    it('value is set to a non-numerical string', async () => {
      try {
        await validateRetryCount('three');
      } catch (reason) {
        return expect(reason).equal('Retry count must be a number');
      }
    });

    it('value is set to any value greater than 5', async () => {
      try {
        await validateRetryCount(6);
      } catch (reason) {
        return expect(reason).equal('Out of range');
      }
    });

    it('value is set to any value less than 0', async () => {
      try {
        await validateRetryCount(-2);
      } catch (reason) {
        return expect(reason).equal('Out of range');
      }
    });
  });

  describe('validateLogfile', () => {
    const tempDest = resolve('./tmp_test');
    before(() => ensureDir(tempDest));
    after(() => remove(tempDest));

    it('value is a boolean', async () => {
      try {
        await validateLogfile(true);
      } catch (reason) {
        return expect(reason.message).equal('You must specify a path to a log file.');
      }
    });

    it('value is a non-existent path', async () => {
      try {
        await validateLogfile('./tmp_test/non_existent_path');
      } catch (reason) {
        return expect(reason).equal('Invalid path');
      }
    });

    it('value is an existent path', () =>
      validateLogfile('./tmp_test/logfile.txt'));
  });

  describe('parseAccessTokenFile', () => {
    let accessTokenFile;

    beforeEach(() => {
      accessTokenFile = createRandomString('filename');
    });
    afterEach(() => remove(accessTokenFile));

    it('should throw an error if the file does not exist', async () => {
      const missingTokenFile = createRandomString('filename');
      await writeFile(accessTokenFile, '');

      try {
        await parseAccessTokenFile(missingTokenFile);
      } catch (e) {
        return expect(e.message).equal(`The access token file provided, ${missingTokenFile}, can't be found.`);
      }
    });

    it('should throw an error if the file cannot be read', async () => {
      await writeFile(accessTokenFile, 'data', { mode: 0o222 });

      try {
        await parseAccessTokenFile(accessTokenFile);
      } catch (e) {
        return expect(e.message).equal(`The access token file provided, ${accessTokenFile}, can't be read.`);
      }
    });

    it('should throw an error if the JSON cannot be parsed', async () => {
      await writeFile(accessTokenFile, '{ "data: invalid: }');

      try {
        await parseAccessTokenFile(accessTokenFile);
      } catch (e) {
        return expect(e.message).equal(`The access token file provided, ${accessTokenFile}, can't be read.`);
      }
    });

    it('should return a json object if successfully read and parsed', async () => {
      await writeFile(accessTokenFile, '{ "data": "someValue" }');

      return expect(await parseAccessTokenFile(accessTokenFile)).deep.equal({
        data: 'someValue',
      });
    });
  });
});
