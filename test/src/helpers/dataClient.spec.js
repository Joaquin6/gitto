import { Readable } from 'stream';
import fs, { remove, ensureDir, ensureFile } from 'fs-extra';
import { random } from 'lodash';
import nock from 'nock';
import HttpError from 'standard-http-error';
import { resolve, join, basename } from 'path';

import * as handler from '../../../src/helpers/requestHandler';
import defaultErrorHandler from '../../../src/helpers/defaultErrorHandler';
import log from '../../../src/helpers/log';
import {
  formatError,
  filterResponse,
  getWebdavFetchOptions,
  inject,
} from '../../../src/helpers/dataClient';

describe('helpers/dataClient', () => {
  const token = createRandomString('token');
  const tokenFile = createRandomString('tokenFile');
  const retryCount = 3;
  const coreServiceUrl = 'http://core-service-url.com';
  const files = [
    { type: 'file', filename: createRandomString('filename') },
    { type: 'file', filename: createRandomString('filename') },
  ];
  const customOptions = { foo: 'bar' };
  const statInfo = { basename: createRandomString('basename') };

  let client;
  let dataClient;
  let createClient;

  beforeEach(() => {
    client = {
      stat: sinon.stub().returns(Promise.resolve(statInfo)),
      createDirectory: sinon.stub().returns(Promise.resolve()),
      getDirectoryContents: sinon.stub().returns(Promise.resolve(files)),
    };
    createClient = sinon.stub().returns(client);
    dataClient = inject(createClient)(coreServiceUrl, token, tokenFile, retryCount);
  });

  describe('on init', () => {
    it('should call createClient with url to core service data', () => {
      expect(createClient).calledWith(coreServiceUrl);
    });
  });

  describe('statRemote', () => {
    let stat;

    let requestHandler;

    beforeEach(() => {
      requestHandler = handler.default;
      handler.default = sinon.stub();

      handler.default.withArgs(
        sinon.match.func,
        {},
        retryCount,
        defaultErrorHandler,
      ).callsFake((method) => method());

      stat = {};
    });

    afterEach(() => {
      handler.default = requestHandler;
    });

    describe('on success', () => {
      let result;

      beforeEach(async () => {
        client.stat.withArgs('a space', sinon.match.hasNested('headers.Depth', 0)).resolves(stat);

        result = await dataClient.statRemote('a%20space', {});
      });

      it('calls the requestHandler', () => {
        expect(handler.default).calledOnce;
      });

      it('makes a stat call with the underlying webdav client', () => {
        expect(client.stat).calledOnce;
      });

      it('returns a file stat', () => {
        expect(result).to.equal(stat);
      });
    });

    describe('on failure', () => {
      let error;

      beforeEach(() => {
        error = new Error('Invalid response: 404 Not Found');
        error.status = 404;
        client.stat.withArgs('a space', sinon.match.hasNested('headers.Depth', 0)).rejects(error);
      });

      it('formats the error and rejects it', () =>
        expect(dataClient.statRemote('a%20space', {})).eventually.rejected.then((err) => {
          expect(err).to.have.own.property('message', 'Invalid response: 404 Not Found');
          expect(err.response).to.have.own.property('data', 'Not Found');
          expect(err.response).to.have.own.property('status', 404);
          expect(err.status).to.equal(404);
        }));
    });
  });

  describe('listRemote', () => {
    const pathname = `./data/tmp_test/${createRandomString('pathname')}`;

    it('should retrieve stat info for the current path', () => {
      dataClient.listRemote(pathname);
      expect(client.stat.called).equal(true);
    });

    it('should pass the path on to the webdav client', () => {
      dataClient.listRemote(pathname);
      expect(client.stat.calledWith(decodeURIComponent(pathname)));
    });

    describe('when pathname has an escaped space', () => {
      it('unescapes the space for eventual storage in the store', () => {
        dataClient.listRemote('a%20space');
        expect(client.stat.calledWith('a space'));
      });
    });

    describe('when options are provided', () => {
      it('it passes them thru', () => {
        dataClient.listRemote(pathname, customOptions);
        expect(client.stat.calledWith({ ...customOptions, headers: { Depth: 0 } }));
      });
    });

    describe('returned value', () => {
      let result;

      beforeEach(() => dataClient
        .listRemote(pathname, customOptions)
        .then((r) => { result = r; }));

      it('contains the pathname', () => {
        expect(result.pathname).equal(pathname);
      });

      it('contains the file stat', () => {
        expect(result.stat).equal(statInfo);
      });
    });
  });

  describe('getRemoteDirectoryContents', () => {
    const destination = resolve('./tmp_test');
    const parentFolder = '/a/path/to/parent';
    const childFolder = '/a/path/to/parent/child';
    // const parentBase = 'parent';
    const childBase = 'child';
    const parentStat = {
      stat: {
        basename: createRandomString('basename'),
      },
      pathname: parentFolder,
      files: [
        { type: 'file',
          filename: createRandomString('filename'),
          basename: createRandomString('basename') },
        { type: 'file',
          filename: createRandomString('filename'),
          basename: createRandomString('basename') },
        { type: 'directory',
          filename: childFolder,
          basename: childBase },
      ],
    };
    const childStat = {
      stat: {
        basename: createRandomString('basename'),
      },
      pathname: childFolder,
      files: [
        { type: 'file',
          filename: createRandomString('filename'),
          basename: createRandomString('basename') },
      ],
    };

    let options;
    let listStub;

    beforeEach(() => {
      options = {
        type: 'directory',
        filename: '/a/path/to/test',
        basename: 'test',
        destination,
        recursive: false,
      };

      listStub = sinon.stub(dataClient, 'listRemote');
    });

    afterEach(() => {
      dataClient.listRemote.restore();
    });

    describe('when getting a file fails', () => {
      beforeEach(() => {
        listStub.resolves(parentStat);
        sinon.stub(dataClient, 'getFile');
        dataClient.getFile.rejects();
      });

      afterEach(() => {
        dataClient.getFile.restore();
      });

      it('should try all files despite failing', () =>
        expect(dataClient.getRemoteDirectoryContents(options))
          .eventually.fulfilled.then(() => {
            expect(dataClient.getFile).calledTwice;
            expect(dataClient.getFile).calledWith(sinon.match.hasOwn('file', parentStat.files[0].filename));
            expect(dataClient.getFile).calledWith(sinon.match.hasOwn('file', parentStat.files[1].filename));
          }));
    });

    describe('when listRemote fails', () => {
      let successLogSpy;
      let errorLogSpy;
      let infoLogSpy;

      let error;

      beforeEach(() => {
        error = new Error('BOOM!');

        listStub.rejects(error);
        successLogSpy = sinon.spy(log, 'success');
        errorLogSpy = sinon.spy(log, 'error');
        infoLogSpy = sinon.spy(log, 'info');
      });

      afterEach(() => {
        log.success.restore();
        log.error.restore();
        log.info.restore();
      });

      it('should log user friendly message and reject', () =>
        expect(dataClient.getRemoteDirectoryContents(options)).eventually.rejected.then(() => {
          expect(successLogSpy).not.called;
          expect(errorLogSpy).calledOnce.and.calledWith(
            sinon.match(`\t- directory: ${join(destination, options.basename)} - FAILED, ${error.message}`),
          );
          expect(infoLogSpy).calledOnce.and.calledWith(sinon.match('Retry command =>'));
        }));
    });

    describe('when downloading a folder non-recursively', () => {
      let streamStub;

      beforeEach(async () => {
        listStub.onFirstCall().resolves(parentStat);
        streamStub = sinon.stub(dataClient, 'streamFile').resolves();
      });

      afterEach(() => remove(destination));

      it('should retrieve the files from only the parent folder', async () => {
        await dataClient.getRemoteDirectoryContents(options);
        expect(streamStub.callCount).equal(2);
        expect(listStub.callCount).equal(1);
      });
    });

    describe('when downloading a folder recursively', () => {
      let streamStub;

      beforeEach(async () => {
        options.recursive = true;

        listStub.onFirstCall().resolves(parentStat);
        listStub.onSecondCall().resolves(childStat);

        streamStub = sinon.stub(dataClient, 'streamFile').resolves();
      });

      afterEach(() => remove(destination));

      it('should retrieve all the files and sub-folders within the parent folder', async () => {
        await dataClient.getRemoteDirectoryContents(options);
        expect(streamStub).calledThrice;
        expect(listStub).calledTwice;
      });

      describe('when the getRemoteDirectoryContents call fails', () => {
        beforeEach(() => {
          sinon.stub(dataClient, 'getRemoteDirectoryContents').callThrough();
          sinon.stub(dataClient, 'getFile');
          dataClient.getFile.resolves();
        });

        afterEach(() => {
          dataClient.getFile.restore();
          dataClient.getRemoteDirectoryContents.restore();
        });

        it('should still resolve if unable to download a remote directory', () => {
          dataClient.getRemoteDirectoryContents.withArgs(
            sinon.match.hasOwn('destination', join(options.destination, options.basename)),
          ).rejects();

          return expect(
            dataClient.getRemoteDirectoryContents(options),
          ).eventually.fulfilled.then(() => expect(listStub).calledOnce);
        });
      });
    });
  });

  describe('get', () => {
    let fileStat;
    const destination = resolve('./tmp_test');

    beforeEach(() => {
      fileStat = {
        type: 'file',
        filename: '/a/path/to/test/some_file',
        basename: 'some_file',
        size: sinon.stub().returns(736134),
        isFile: sinon.stub().returns(true),
      };
    });

    describe('when the source is a file', () => {
      it('should call getFile', () => {
        sinon.stub(dataClient, 'getFile');

        dataClient.getFile.resolves(736134);

        dataClient.get({
          fileStat,
          recursive: false,
          destination,
        });

        expect(dataClient.getFile).calledWith({
          file: fileStat.filename,
          destination,
          stat: fileStat,
        });

        dataClient.getFile.restore();
      });
    });

    describe('when the source is a directory', () => {
      it('should call getRemoteDirectoryContents', async () => {
        sinon.stub(dataClient, 'getRemoteDirectoryContents');

        fileStat.filename = '/a/path/to/test/some_dir';
        fileStat.basename = 'some_dir';
        fileStat.type = 'directory';
        dataClient.getRemoteDirectoryContents.resolves('downloaded all files');

        await dataClient.get({
          fileStat,
          recursive: false,
          destination,
        });

        expect(dataClient.getRemoteDirectoryContents).calledWith({
          ...fileStat,
          recursive: false,
          destination,
        });

        dataClient.getRemoteDirectoryContents.restore();
      });
    });
  });

  describe('getFile', () => {
    let options;
    const fileStat = { size: 736134 };
    const file = '/a/path/to/test/some_file';
    const dest = resolve('.');

    let requestHandler;
    let successLogSpy;
    let errorLogSpy;
    let infoLogSpy;

    beforeEach(async () => {
      options = {
        file,
        destination: dest,
        stat: fileStat,
      };

      requestHandler = handler.default;
      handler.default = sinon.stub();

      successLogSpy = sinon.spy(log, 'success');
      errorLogSpy = sinon.spy(log, 'error');
      infoLogSpy = sinon.spy(log, 'info');
    });

    afterEach(async () => {
      handler.default = requestHandler;

      log.success.restore();
      log.error.restore();
      log.info.restore();

      nock.cleanAll();
    });

    describe('on success', () => {
      let result;

      beforeEach(async () => {
        handler.default.withArgs(
          sinon.match.func,
          {},
          retryCount,
          defaultErrorHandler,
        ).resolves();

        result = await dataClient.getFile(options);
      });

      it('logs a success message', () => {
        expect(successLogSpy).calledOnce.and.calledWith(sinon.match('\t+ file: '));
      });

      it('returns the size of the file retrieved', () => {
        expect(result).to.equal(fileStat.size);
      });
    });

    describe('on failure', () => {
      let error;

      beforeEach(() => {
        error = new Error('BOOM!');

        handler.default.withArgs(
          sinon.match.func,
          {},
          retryCount,
          defaultErrorHandler,
        ).rejects(error);
      });

      it('logs a failure message and rejects', () =>
        expect(dataClient.getFile(options)).eventually.rejectedWith(error).then(() => {
          expect(errorLogSpy).calledOnce.and.calledWith(sinon.match('\t- file: '));
          expect(infoLogSpy).calledOnce.and.calledWith(sinon.match('Retry command => '));
        }));
    });
  });

  describe('put', () => {
    let fileStat;

    describe('when the source is a file', () => {
      beforeEach(() => {
        fileStat = {
          size: 736134,
          isFile: () => true,
        };

        sinon.stub(dataClient, 'putFile');
      });

      afterEach(() => {
        dataClient.putFile.restore();
      });

      it('should write the file to the remote destination', () => {
        dataClient.putFile.resolves();

        dataClient.put({
          fileStat,
          recursive: false,
          filename: 'tmp_data/upload/some_file',
          destination: 'Projects/My Test Projects',
        });

        expect(dataClient.putFile).calledWith({
          file: 'tmp_data/upload/some_file',
          stat: fileStat,
          dest: 'Projects/My Test Projects',
        });
      });
    });

    describe('when the source is a directory', () => {
      beforeEach(() => {
        fileStat = {
          isFile: () => false,
        };

        sinon.stub(dataClient, 'propfindDirectory');
        sinon.stub(dataClient, 'createRemoteDirectory');
        sinon.stub(dataClient, 'getLocalDirectoryContents');
      });

      afterEach(() => {
        dataClient.propfindDirectory.restore();
        dataClient.createRemoteDirectory.restore();
        dataClient.getLocalDirectoryContents.restore();
      });

      it('should write the folder to the remote destination', async () => {
        dataClient.propfindDirectory.rejects(new HttpError(404, 'BOOM!'));
        dataClient.createRemoteDirectory.resolves();
        dataClient.getLocalDirectoryContents.resolves();

        await dataClient.put({
          fileStat,
          recursive: false,
          retryCount,
          filename: 'tmp_data/upload/some_file',
          destination: 'Projects/My Test Projects',
        });

        const folder = 'Projects/My Test Projects/some_file';

        expect(dataClient.propfindDirectory).calledWith(folder);
        expect(dataClient.createRemoteDirectory).calledWith(folder);
        expect(dataClient.getLocalDirectoryContents).calledWith(
          'tmp_data/upload/some_file',
          folder,
          false,
        );
      });

      describe('when the createRemoteDirectory call fails', () => {
        beforeEach(() => {
          dataClient.propfindDirectory.rejects(new HttpError(404, 'BOOM!'));

          sinon.spy(log, 'info');
        });

        afterEach(() => {
          log.info.restore();
        });

        it('should throw a user friendly error if it is unable to create the folder', async () => {
          dataClient.createRemoteDirectory.rejects(new HttpError(409, 'some message'));

          try {
            await dataClient.put({
              fileStat,
              recursive: false,
              retryCount,
              filename: 'tmp_data/upload/some_file',
              destination: 'Projects/My Test Projects',
            });
          } catch (e) {
            const folder = 'Projects/My Test Projects/some_file';
            expect(e.message).to.include(`Unable to create the remote directory "${folder}"`);
          }
        });

        it('should continue on and upload local contents if the remote folder already exists', async () => {
          dataClient.propfindDirectory.rejects(new HttpError(404, 'BOOM!'));
          dataClient.createRemoteDirectory.rejects(new HttpError(405, 'some message'));

          await dataClient.put({
            fileStat,
            recursive: false,
            retryCount,
            filename: 'tmp_data/upload/some_file',
            destination: 'Projects/My Test Projects',
          });

          const folder = 'Projects/My Test Projects/some_file';
          expect(dataClient.getLocalDirectoryContents).calledWith(
            'tmp_data/upload/some_file',
            folder,
            false,
          );

          expect(log.info).calledOnce.and.calledWith(sinon.match(`Attempted to create a remote directory at "${folder}"`));
        });
      });
    });
  });

  describe('streamFile', () => {
    const remoteDest = '/a/path/to';
    const remotePath = '/a/path/to/stream_file_test';
    const localDest = resolve('.');
    const localPath = resolve('./stream_file_test');
    const requestDefaults = {
      baseUrl: coreServiceUrl,
      strictSSL: false,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    };

    before(() => ensureFile(localPath));
    after(() => remove(localPath));

    afterEach(() => nock.cleanAll());

    it('should resolve on successful upload', () => {
      nock(coreServiceUrl).put(remotePath).reply(201, null, {
        'content-length': 0,
      });

      const promise = dataClient.streamFile({
        filePath: localPath,
        destination: remoteDest,
        isUploading: true,
      }, requestDefaults);

      return expect(promise).eventually.fulfilled;
    });

    it('should resolve on successful download', () => {
      nock(coreServiceUrl)
        .get(remotePath)
        .reply(200, 'Hello Test Data!', {
          'content-length': 16,
        });

      const promise = dataClient.streamFile({
        filePath: remotePath,
        destination: localDest,
        isUploading: false,
      }, requestDefaults);

      return expect(promise).eventually.fulfilled;
    });

    it('should reject when fileStream throws an error', () => {
      const unReadable = `${localDest}/unreadable`;
      const promise = dataClient.streamFile({
        filePath: unReadable,
        destination: localDest,
        isUploading: true,
      }, requestDefaults);

      return expect(promise).eventually.rejected;
    });

    it('should use upload request options', async () => {
      nock(coreServiceUrl).put(remotePath).reply(201, null, {
        'content-length': 0,
      });

      sinon.spy(dataClient, 'req');

      await dataClient.streamFile({
        filePath: localPath,
        destination: remoteDest,
        isUploading: true,
      }, requestDefaults);

      return expect(dataClient.req).calledOnce.and.calledWith({
        method: 'PUT',
        uri: `${remoteDest}/${basename(localPath)}`,
        json: true,
      });
    });

    it('should use download request options', async () => {
      nock(coreServiceUrl)
        .get(remotePath)
        .reply(200, 'Hello Test Data!', {
          'content-length': 16,
        });

      sinon.spy(dataClient, 'req');

      await dataClient.streamFile({
        filePath: remotePath,
        destination: localDest,
        isUploading: false,
      }, requestDefaults);

      return expect(dataClient.req).calledOnce.and.calledWith({
        method: 'GET',
        uri: remotePath,
        json: true,
      });
    });

    it('should reject on connection failure', () => {
      nock(coreServiceUrl, {
        reqheaders: {
          authorization: `Bearer ${token}`,
        },
      }).get(remotePath)
        .replyWithError({ message: 'connection failure', code: 'ECONNRESET' });

      const promise = dataClient.streamFile({
        filePath: remotePath,
        destination: localDest,
        isUploading: false,
      }, requestDefaults);

      return expect(promise)
        .eventually.rejectedWith('connection failure');
    });

    it('should reject on 401 unauthorized access error', () => {
      nock(coreServiceUrl, {
        reqheaders: {
          authorization: `Bearer ${token}`,
        },
      }).get(remotePath)
        .reply(401, {
          message: 'BOOM!',
        });

      const promise = dataClient.streamFile({
        filePath: remotePath,
        destination: localDest,
        isUploading: false,
      }, requestDefaults);

      return expect(promise)
        .eventually.rejectedWith('Failed to authenticate. Please check your access token.');
    });

    it('should reject on 404 resource not found error', () => {
      nock(coreServiceUrl, {
        reqheaders: {
          authorization: `Bearer ${token}`,
        },
      }).get(remotePath)
        .reply(404, {
          message: 'BOOM!',
        });

      const promise = dataClient.streamFile({
        filePath: remotePath,
        destination: localDest,
        isUploading: false,
      }, requestDefaults);

      return expect(promise)
        .eventually.rejectedWith('Remote resource not found.');
    });

    it('should reject on 403 permission error', () => {
      nock(coreServiceUrl, {
        reqheaders: {
          authorization: `Bearer ${token}`,
        },
      }).get(remotePath)
        .reply(403, {
          message: 'BOOM!',
        });

      const promise = dataClient.streamFile({
        filePath: remotePath,
        destination: localDest,
        isUploading: false,
      }, requestDefaults);

      return expect(promise)
        .eventually.rejectedWith('You do not have permission to access the requested resource. Please contact your administrator.');
    });

    it('should reject on 500 server error', () => {
      nock(coreServiceUrl, {
        reqheaders: {
          authorization: `Bearer ${token}`,
        },
      }).get(remotePath)
        .reply(500, {
          message: 'BOOM!',
        }, {
          'content-type': 'application/json',
        });

      const promise = dataClient.streamFile({
        filePath: remotePath,
        destination: localDest,
        isUploading: false,
      }, requestDefaults);

      return expect(promise)
        .eventually.rejectedWith('BOOM!');
    });

    it('should reject on error event during download', () => {
      const readable = new Readable({
        read: () => {},
      });

      nock(coreServiceUrl, {
        reqheaders: {
          authorization: `Bearer ${token}`,
        },
      }).get(remotePath)
        .reply(200, () => readable);

      const promise = dataClient.streamFile({
        filePath: remotePath,
        destination: localDest,
        isUploading: false,
      }, requestDefaults);

      setTimeout(() => {
        readable.emit('error', new Error('BOOM!'));
      }, 100);

      return expect(promise).eventually.rejectedWith('Error on Download: BOOM!');
    });

    it('should reject on error event during upload', () => {
      const readable = new Readable({
        read: () => {},
      });

      nock(coreServiceUrl, {
        reqheaders: {
          authorization: `Bearer ${token}`,
        },
      }).put(remotePath)
        .reply(200, () => readable);

      const promise = dataClient.streamFile({
        filePath: localPath,
        destination: remoteDest,
        isUploading: true,
      }, requestDefaults);

      setTimeout(() => {
        readable.emit('error', new Error('BOOM!'));
      }, 100);

      return expect(promise).eventually.rejectedWith('Error on Upload: BOOM!');
    });
  });

  describe('putFile', () => {
    const tempParentDir = './tmp_test';
    const fileStat = { size: 736134 };
    const destination = `/data/Projects/${encodeURIComponent('My Test Projects')}`;

    let tempTestFile;
    let pathToTempFile;
    let options;

    let requestHandler;

    let successLogSpy;
    let errorLogSpy;
    let infoLogSpy;

    beforeEach(async () => {
      tempTestFile = createRandomString('filename');
      pathToTempFile = `${tempParentDir}/${tempTestFile}`;
      options = {
        file: pathToTempFile,
        stat: fileStat,
        dest: destination,
      };

      requestHandler = handler.default;
      handler.default = sinon.stub();

      successLogSpy = sinon.spy(log, 'success');
      errorLogSpy = sinon.spy(log, 'error');
      infoLogSpy = sinon.spy(log, 'info');
    });

    afterEach(async () => {
      handler.default = requestHandler;

      nock.cleanAll();

      log.success.restore();
      log.error.restore();
      log.info.restore();
    });

    describe('on success', () => {
      beforeEach(() => {
        handler.default.withArgs(
          sinon.match.func,
          {},
          retryCount,
          defaultErrorHandler,
        ).resolves();

        return dataClient.putFile(options);
      });

      it('logs a success message', () => {
        expect(successLogSpy).calledOnce.and.calledWith(sinon.match('\t+ file: '));
      });
    });

    describe('on failure', () => {
      let error;

      beforeEach(() => {
        error = new Error('BOOM!');

        handler.default.withArgs(
          sinon.match.func,
          {},
          retryCount,
          defaultErrorHandler,
        ).rejects(error);
      });

      it('logs a failure message and rejects', () =>
        expect(dataClient.putFile(options)).eventually.rejectedWith(error).then(() => {
          expect(errorLogSpy).calledOnce.and.calledWith(sinon.match('\t- file: '));
          expect(infoLogSpy).calledOnce.and.calledWith(sinon.match('Retry command => '));
        }));
    });
  });

  describe('getLocalDirectoryContents', () => {
    const parent = resolve('./tmp_parent');
    const child = resolve('./tmp_parent/tmp_child');
    const anotherChild = resolve('./tmp_parent/another_child');
    const file1 = createRandomString('file');
    const file2 = createRandomString('file');
    const file3 = createRandomString('file');
    const destination = '/data/Projects';

    before(async () => {
      await ensureDir(child);
      await ensureFile(join(parent, file1));
      await ensureFile(join(parent, file2));
      await ensureFile(join(child, file3));
    });

    after(() => remove(parent));

    describe('when reading a local directory fails', () => {
      beforeEach(() => {
        sinon.stub(log, 'error');
        sinon.stub(fs, 'readdir');
        sinon.stub(dataClient, 'putFile');
        sinon.stub(dataClient, 'propfindDirectory');
        sinon.stub(fs, 'stat');
      });

      afterEach(() => {
        log.error.restore();
        fs.readdir.restore();
        dataClient.putFile.restore();
        dataClient.propfindDirectory.restore();
        fs.stat.restore();
      });

      it('warns the user that the local directory is gone and continues', () => {
        fs.stat.withArgs(join(parent, file2)).returns({
          isFile() { return true; },
        });
        fs.stat.withArgs(join(parent, file1)).returns({
          isFile() { return true; },
        });
        fs.stat.withArgs(join(child, file3)).returns({
          isFile() { return true; },
        });
        fs.stat.withArgs(child).returns({
          isFile() { return false; },
        });
        fs.stat.withArgs(anotherChild).returns({
          isFile() { return false; },
        });

        dataClient.putFile.returns({
          catch() {},
        });
        dataClient.propfindDirectory.returns();

        fs.readdir.withArgs(anotherChild).throws(new Error('BOOM!'));
        fs.readdir.withArgs(child).returns([file3]);
        fs.readdir.withArgs(parent).returns([file1, file2, 'another_child', 'tmp_child']);

        return expect(dataClient.getLocalDirectoryContents(parent, destination, true))
          .eventually.fulfilled.then(() => {
            expect(fs.stat.callCount).equal(5);

            expect(log.error).calledOnce.and.calledWith(sinon.match('Unable to read local directory at'));

            expect(dataClient.putFile).calledThrice;
          });
      });
    });

    describe('when stat-ing a local file fails', () => {
      let error;

      beforeEach(() => {
        error = new Error('BOOM!');
        error.code = 'ENOENT';

        sinon.stub(fs, 'stat');
        sinon.stub(log, 'error');
        sinon.stub(dataClient, 'putFile');
      });

      afterEach(() => {
        fs.stat.restore();
        log.error.restore();
        dataClient.putFile.restore();
      });

      it('warns the user that the local file is gone and continues', () => {
        dataClient.putFile.returns({
          catch() {},
        });
        fs.stat.withArgs(join(parent, file2)).returns({
          isFile() { return true; },
        });
        fs.stat.withArgs(child).returns({
          isFile() { return false; },
        });
        fs.stat.withArgs(anotherChild).returns({
          isFile() { return false; },
        });
        fs.stat.withArgs(join(parent, file1)).throws(error);

        return expect(dataClient.getLocalDirectoryContents(parent, destination, false))
          .eventually.fulfilled.then(() => {
            expect(fs.stat).calledThrice;

            expect(log.error).calledOnce.and.calledWith(
              sinon.match('Unable to find local file or directory at'),
            );

            expect(dataClient.putFile).calledOnce.and.calledWith(
              sinon.match.hasOwn('file', join(parent, file2)),
            );
          });
      });
    });

    describe('when putting a file fails', () => {
      beforeEach(() => {
        sinon.stub(dataClient, 'putFile');
        dataClient.putFile.rejects();
      });

      afterEach(() => {
        dataClient.putFile.restore();
      });

      it('should try all files despite failing', () =>
        expect(dataClient.getLocalDirectoryContents(parent, destination, false))
          .eventually.fulfilled.then(() => {
            expect(dataClient.putFile).calledTwice;
            expect(dataClient.putFile).calledWith(sinon.match.hasOwn('file', join(parent, file1)));
            expect(dataClient.putFile).calledWith(sinon.match.hasOwn('file', join(parent, file2)));
          }));
    });

    describe('when putting a folder non recursively', () => {
      it('should upload only the files in the source (parent) directory', () => {
        const coreService = nock(coreServiceUrl)
          .put(`${destination}/${file1}`)
          .reply(201, null, { 'content-length': 0 })
          .put(`${destination}/${file2}`)
          .reply(201, null, { 'content-length': 0 });

        return expect(dataClient.getLocalDirectoryContents(
          parent, destination, false))
          .eventually.fulfilled.then(() => coreService.done());
      });
    });

    describe('when putting a folder recursively', () => {
      beforeEach(() => {
        sinon.stub(dataClient, 'propfindDirectory');
        sinon.stub(dataClient, 'createRemoteDirectory');
      });

      afterEach(() => {
        dataClient.propfindDirectory.restore();
        dataClient.createRemoteDirectory.restore();
      });

      it('should upload the source directory and all subdirectories and files', () => {
        const coreService = nock(coreServiceUrl)
          .put(`${destination}/${file1}`)
          .reply(201, null, { 'content-length': 0 })
          .put(`${destination}/${file2}`)
          .reply(201, null, { 'content-length': 0 })
          .put(`${destination}/tmp_child/${file3}`)
          .reply(201, null, { 'content-length': 0 });

        dataClient.propfindDirectory.withArgs(`${destination}/tmp_child`).resolves([{ statusCode: 404 }]);
        dataClient.createRemoteDirectory.withArgs(`${destination}/tmp_child`).resolves([{}, {}]);

        return expect(dataClient.getLocalDirectoryContents(parent, destination, true))
          .eventually.fulfilled.then(() => coreService.done());
      });

      describe('when the propfindDirectory call fails', () => {
        let errorLogSpy;
        let infoLogSpy;

        beforeEach(() => {
          sinon.stub(dataClient, 'putFile');
          dataClient.putFile.resolves();

          errorLogSpy = sinon.spy(log, 'error');
          infoLogSpy = sinon.spy(log, 'info');
        });

        afterEach(() => {
          dataClient.putFile.restore();

          log.error.restore();
          log.info.restore();
        });

        it('should log a user friendly message and skip if an unknown error occurs', () => {
          dataClient.propfindDirectory.rejects();

          return expect(dataClient.getLocalDirectoryContents(parent, destination, true))
            .eventually.fulfilled.then(() => {
              expect(errorLogSpy).calledWith(sinon.match('Unable to find remote directory'));
              expect(infoLogSpy).calledWith(sinon.match('Retry command =>'));
            });
        });

        it('should attempt to create the directory if it does not already exist', () => {
          dataClient.propfindDirectory.rejects(new HttpError(404, 'BOOM!'));

          return expect(dataClient.getLocalDirectoryContents(parent, destination, true))
            .eventually.fulfilled.then(() => {
              expect(dataClient.createRemoteDirectory).calledOnce;
            });
        });
      });

      describe('when the createRemoteDirectory call fails', () => {
        let errorLogSpy;
        let infoLogSpy;

        beforeEach(() => {
          sinon.stub(dataClient, 'putFile');
          dataClient.putFile.resolves();

          errorLogSpy = sinon.spy(log, 'error');
          infoLogSpy = sinon.spy(log, 'info');
        });

        afterEach(() => {
          dataClient.putFile.restore();

          log.error.restore();
          log.info.restore();
        });

        it('should log a user friendly error message if unable to create a remote directory', () => {
          dataClient.propfindDirectory.rejects(new HttpError(404, 'BOOM!'));
          dataClient.createRemoteDirectory.rejects(new HttpError(409, 'some message'));

          return expect(
            dataClient.getLocalDirectoryContents(parent, destination, true),
          ).eventually.fulfilled.then(() => {
            expect(errorLogSpy).calledOnce.and.calledWith(sinon.match('Unable to create remote directory'));
            expect(infoLogSpy).calledOnce.and.calledWith(sinon.match('Retry command =>'));
          });
        });

        it('should warn the user the folder already exists if the response is a 405', () => {
          dataClient.propfindDirectory.rejects(new HttpError(404, 'BOOM!'));
          dataClient.createRemoteDirectory.rejects(new HttpError(405, 'some message'));

          return expect(
            dataClient.getLocalDirectoryContents(parent, destination, true),
          ).eventually.fulfilled.then(() => {
            expect(infoLogSpy).calledOnce.and.calledWith(sinon.match('Attempted to create remote directory'));
          });
        });

        it('should log a user friendly error message if an unknown error occurs', () => {
          dataClient.propfindDirectory.rejects(new HttpError(404, 'BOOM!'));
          dataClient.createRemoteDirectory.rejects(new Error('BOOM!'));

          return expect(
            dataClient.getLocalDirectoryContents(parent, destination, true),
          ).eventually.fulfilled.then(() => {
            expect(errorLogSpy).calledOnce.and.calledWith(sinon.match('Unable to create remote directory'));
            expect(infoLogSpy).calledOnce.and.calledWith(sinon.match('Retry command =>'));
          });
        });
      });
    });
  });

  describe('propfindDirectory', () => {
    let dirname;
    let destination;
    let uri;

    let requestHandler;

    beforeEach(() => {
      dirname = createRandomString('dirname');
      destination = `/data/Projects/My Test Projects/${dirname}`;
      uri = destination.split('/').map((component) => encodeURIComponent(component)).join('/');

      requestHandler = handler.default;
      handler.default = sinon.stub();

      handler.default.withArgs(
        sinon.match.func,
        null,
        retryCount,
        defaultErrorHandler,
      ).callsFake((method) => method());
    });

    afterEach(() => {
      handler.default = requestHandler;

      nock.cleanAll();
    });

    describe('on success', () => {
      let body;
      let results;
      let coreServiceMock;

      beforeEach(async () => {
        body = 'foobarbaz';

        coreServiceMock = nock(coreServiceUrl)
          .intercept(uri, 'PROPFIND')
          .reply(207, body);

        results = await dataClient.propfindDirectory(destination);
      });

      it('uses the request handler for retrying', () => {
        expect(handler.default).calledOnce;
      });

      it('makes a PROPFIND request for the directory', () => {
        expect(coreServiceMock.isDone(), 'Made PROPFIND request to core-service').to.equal(true);
      });

      it('returns undefined', async () => {
        expect(results).to.be.undefined;
      });
    });

    describe('on failure', () => {
      let coreServiceMock;

      beforeEach(async () => {
        coreServiceMock = nock(coreServiceUrl)
          .intercept(uri, 'PROPFIND')
          .replyWithError({ message: 'BOOM!', code: 'ECONNRESET' });
      });

      it('rejects with the error that broke the camel\'s back', () =>
        expect(dataClient.propfindDirectory(destination)).eventually.rejected.then((error) => {
          expect(error.message).to.equal('BOOM!');
          expect(error.code).to.equal('ECONNRESET');

          expect(coreServiceMock.isDone()).to.equal(true);
        }));
    });
  });

  describe('createRemoteDirectory', () => {
    let dirname;
    let destination;
    let uri;

    let requestHandler;

    let successLogSpy;
    let errorLogSpy;

    beforeEach(() => {
      dirname = createRandomString('dirname');
      destination = `/data/Projects/My Test Projects/${dirname}`;
      uri = destination.split('/').map((component) => encodeURIComponent(component)).join('/');

      requestHandler = handler.default;
      handler.default = sinon.stub();

      handler.default.withArgs(
        sinon.match.func,
        null,
        retryCount,
        defaultErrorHandler,
      ).callsFake((method) => method());

      successLogSpy = sinon.spy(log, 'success');
      errorLogSpy = sinon.spy(log, 'error');
    });

    afterEach(() => {
      handler.default = requestHandler;

      log.success.restore();
      log.error.restore();

      nock.cleanAll();
    });

    describe('on success', () => {
      let body;
      let results;
      let coreServiceMock;

      beforeEach(async () => {
        body = 'foobarbaz';

        coreServiceMock = nock(coreServiceUrl)
          .intercept(uri, 'MKCOL')
          .reply(201, body);

        results = await dataClient.createRemoteDirectory(destination);
      });

      it('uses the request handler for retrying', () => {
        expect(handler.default).calledOnce;
      });

      it('makes a MKCOL request to create the directory', () => {
        expect(coreServiceMock.isDone(), 'Made MKCOL request to core-service').to.equal(true);
      });

      it('logs the folder was successfully created', () => {
        expect(successLogSpy).calledOnce.and.calledWith(`\t+ directory: ${destination} - --`);
      });

      it('returns undefined', async () => {
        expect(results).to.be.undefined;
      });
    });

    describe('when the request fails', () => {
      describe('on network error', () => {
        beforeEach(() => {
          nock(coreServiceUrl)
            .intercept(uri, 'MKCOL')
            .replyWithError({ message: 'Connection Error', code: 'ECONNRESET' });
        });

        it('logs the failure and rejects', async () => {
          const err = await expect(
            dataClient.createRemoteDirectory(destination),
          ).eventually.rejected;
          expect(errorLogSpy).to.have.been.calledWith(`\t- directory: ${destination} - FAILED, ${err.message}`);
          expect(err.message).to.equal('Connection Error');
        });
      });

      describe('on HTTP error', () => {
        beforeEach(() => {
          nock(coreServiceUrl)
            .intercept(uri, 'MKCOL')
            .reply(409, 'Parent doesnt exist!');
        });

        it('logs the failure and rejects', async () => {
          const err = await expect(
            dataClient.createRemoteDirectory(destination),
          ).eventually.rejected;
          expect(err).to.deep.equal(new HttpError(409, 'Parent doesnt exist!'));
          expect(errorLogSpy).to.have.been.calledWith(`\t- directory: ${destination} - FAILED`);
        });
      });
    });
  });

  describe('internal methods', () => {
    describe('getWebdavFetchOptions', () => {
      let options;

      beforeEach(() => {
        options = { foo: 'bar' };
      });

      it('should include the token in an auth header on the server and set depth to 1', () => {
        const result = getWebdavFetchOptions('asdf', options);
        expect(result).to.have.property('headers');
        expect(result.headers).to.have.property('authorization', 'Bearer asdf');
        expect(result.headers).to.have.property('Depth', 1);
        expect(result).to.have.property('foo', 'bar');
      });
    });

    describe('formatError', () => {
      it('should format errors to look like an axios error', () => {
        const status = random(400, 599);
        const statusText = createRandomString('statusText');
        return formatError(new Error(`Invalid response: ${status} ${statusText}`))
          .catch((error) => {
            expect(error.response).to.have.property('status', status);
            expect(error.response).to.have.property('data', statusText);
            expect(error).to.have.property('code', status);
          });
      });
    });

    describe('filterResponse', () => {
      const stat = { someStat: true };
      const files = [
        {
          filename: 'somefile.txt',
        },
        {
          filename: 'someothername.jpg',
        },
      ];
      let directoryContents = [stat, files];

      it('should return a list of directory contents and the stat of the folder', () => {
        expect(filterResponse('/some/pathname')(directoryContents)).deep.equal({
          stat,
          pathname: '/some/pathname',
          files,
        });
      });

      it('should return a list of directory contents not including the folder itself', () => {
        directoryContents = [stat, [
          ...files,
          { filename: '/some/pathname' },
        ]];
        expect(filterResponse('/some/pathname')(directoryContents)).deep.equal({
          stat,
          pathname: '/some/pathname',
          files,
        });
      });

      it('should return a posix style pathname of the folder', () => {
        expect(filterResponse('\\some\\pathname')(directoryContents)).deep.equal({
          stat,
          pathname: '/some/pathname',
          files,
        });
      });

      it('should return a list of directory contents with posix style filenames', () => {
        directoryContents = [stat, [
          ...files,
          { filename: '\\some\\filetest.jpeg' },
          { filename: '\\\\some\\\\filetest2.jpeg' },
        ]];
        expect(filterResponse('/some/pathname')(directoryContents)).deep.equal({
          stat,
          pathname: '/some/pathname',
          files: [
            ...files,
            { filename: '/some/filetest.jpeg' },
            { filename: '/some/filetest2.jpeg' },
          ],
        });
      });
    });
  });
}).timeout(10000);
