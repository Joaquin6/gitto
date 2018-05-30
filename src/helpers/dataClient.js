import path from 'path';
import {
  createReadStream,
  createWriteStream,
} from 'fs';
import HttpError from 'standard-http-error';
import { readdir, stat as statAsync, ensureDir } from 'fs-extra';
import Promise from 'bluebird';
import prettyBytes from 'pretty-bytes';
import request from 'request';
import { merge } from 'lodash';
import createClient from 'webdav';
import fetch from 'isomorphic-fetch';

import defaultErrorHandler from './defaultErrorHandler';
import enforceForwardSlashes from './enforceForwardSlashes';
import log from './log';
import requestHandler from './requestHandler';

export function filterResponse(dirPath) {
  const pathname = enforceForwardSlashes(dirPath);
  return ([stat, files]) => ({
    stat,
    pathname,
    files: files.filter((file) => {
      file.filename = enforceForwardSlashes(file.filename);
      return file.filename !== pathname;
    }),
  });
}

export function getWebdavFetchOptions(token, options) {
  const authOpts = {
    headers: {
      authorization: `Bearer ${token}`,
      Depth: 1,
    },
  };

  return merge({}, authOpts, options);
}

export function formatError(err) {
  const temp = err.message.replace('Invalid response: ', '');
  const status = parseInt(temp.split(' ')[0], 10);
  const data = temp.replace(`${status} `, '');

  err.response = { status, data };
  err.code = status;

  return Promise.reject(err);
}

const lookupStatusCode = {
  404: 'Remote resource not found.',
  401: 'Failed to authenticate. Please check your access token.',
  403: 'You do not have permission to access the requested resource. Please contact your administrator.',
};

export const inject = (webdav) => function createDataClient(
  coreServiceUrl,
  token,
  tokenFile,
  retryCount,
) {
  const client = webdav(coreServiceUrl);
  createClient.setFetchMethod((url, options) => fetch(url, getWebdavFetchOptions(token, options)));

  const retryMessage = retryCount ? ` after ${retryCount} attempts` : '';

  const requestDefaults = {
    baseUrl: coreServiceUrl,
    strictSSL: false,
    jar: true,
    headers: {
      Authorization: `Bearer ${token}`,
    },
  };
  const req = request.defaults(requestDefaults);

  return {
    req,
    statRemote(filename, options) {
      const opts = merge({}, options, {
        headers: {
          Depth: 0,
        },
      });

      return requestHandler(
        () => client.stat(decodeURIComponent(filename), opts).catch(formatError),
        {},
        retryCount,
        defaultErrorHandler,
      );
    },
    listRemote(basename, options) {
      return Promise.all([
        this.statRemote(basename, options),
        requestHandler(
          () =>
            client.getDirectoryContents(
              decodeURIComponent(basename),
              options,
            ).catch(formatError),
          {},
          retryCount,
          defaultErrorHandler,
        ),
      ]).then(filterResponse(basename));
    },
    streamFile({ filePath, destination, isUploading }) {
      return new Promise((resolve, reject) => {
        const basename = path.basename(filePath);
        const fileStream = isUploading
          ? createReadStream(filePath)
          : createWriteStream(path.posix.join(destination, basename));
        fileStream.on('error', reject);

        const uri = isUploading ? `${destination}/${basename}` : filePath;

        const requestOptions = {
          method: isUploading ? 'PUT' : 'GET',
          uri: uri.split('/').map(encodeURIComponent).join('/'),
          json: true,
        };
        const reqStream = this.req(requestOptions)
          .on('error', (err) => reject(err))
          .on('response', (res) => {
            const { statusCode } = res;

            if (!(statusCode >= 200 && statusCode <= 299)) {
              const serverError = lookupStatusCode[res.statusCode];
              if (serverError) {
                return reject(new HttpError(statusCode, serverError));
              }
              if (typeof res.body === 'undefined') {
                reqStream.on('complete', () => reject(new HttpError(statusCode, res.body.message)));
                reqStream.readResponseBody(res);
                return;
              }
              return reject(new HttpError(statusCode, res.body.message));
            }

            res.on('error', (err) => {
              const prefix = isUploading ? 'Error on Upload: ' : 'Error on Download: ';
              err.message = prefix + err.message;
              reject(err);
            }).on('end', resolve);
          });

        return isUploading ? fileStream.pipe(reqStream) : reqStream.pipe(fileStream);
      });
    },
    get({ fileStat, recursive, destination }) {
      if (fileStat.type === 'file') {
        return this.getFile({
          file: fileStat.filename,
          destination,
          stat: fileStat,
        });
      }

      return this.getRemoteDirectoryContents({
        ...fileStat,
        recursive,
        destination,
      });
    },
    async getFile({ file, destination, stat }) {
      try {
        await requestHandler(
          () =>
            this.streamFile({
              filePath: file,
              destination,
              isUploading: false,
            }),
          {},
          retryCount,
          defaultErrorHandler,
        );

        log.success(`\t+ file: ${path.join(destination, path.basename(file))} - ${prettyBytes(stat.size || 0)}`);
        return stat.size;
      } catch (err) {
        log.error(`\t- file: ${path.join(destination, path.basename(file))} - FAILED${retryMessage}`);
        log.info(`Retry command => .gitto._cloud_download --access_token_file "${tokenFile}" --remote_source "${file}" --local_destination_folder "${destination}"`);
        throw err;
      }
    },
    async getRemoteDirectoryContents({ filename, basename, recursive, destination }) {
      const self = this;
      const dirRemote = filename;
      const destLocal = destination;
      const dirLocal = path.join(destLocal, basename);

      try {
        // Underlying call is handled for retries
        // CL: To avoid double-logging a success and failure entry back-to-back, perform the
        // propfind first before creating the directory its contents will go into.
        const contents = await self.listRemote(dirRemote);

        await ensureDir(dirLocal);
        log.success(`\t+ directory: ${dirLocal} - --`);

        return Promise.mapSeries(contents.files, (async (file) => {
          if (file.type === 'file') {
            // Underlying call is handled for retries
            return self.getFile({
              file: file.filename,
              destination: dirLocal,
              stat: file,
            }).catch(() => {
              // Swallow the exception here to keep the upload going
              // the getFile call will include log information
            });
          }
          if (recursive) {
            // Underlying calls are handled for retries
            await self.getRemoteDirectoryContents({
              ...file,
              recursive,
              destination: dirLocal,
            }).catch(() => {
              // Swallow the exception here to keep the download going
              // the getRemoteDirectoryContents function should log where necessary
            });
          }
        }));
      } catch (err) {
        log.error(`\t- directory: ${dirLocal} - FAILED, ${err.message}`);
        log.info(`Retry command => .gitto._cloud_download --access_token_file "${tokenFile}" --remote_source "${path.posix.join(destLocal, basename)}" --local_destination_folder "${dirLocal}"`);
        return Promise.reject(err);
      }
    },
    putFile({ file, stat, dest }) {
      return requestHandler(
        () =>
          this.streamFile({
            filePath: file,
            destination: dest,
            isUploading: true,
          }),
        {},
        retryCount,
        defaultErrorHandler,
      )
        .then(() => {
          log.success(`\t+ file: ${path.posix.join(dest, path.basename(file))} - ${prettyBytes(stat.size || 0)}`);
        })
        .catch((err) => {
          log.error(`\t- file: ${path.posix.join(dest, path.basename(file))} - FAILED${retryMessage}`);
          log.info(`Retry command => .gitto._cloud_upload --access_token_file "${tokenFile}" --local_source "${file}" --remote_destination_folder "${dest}"`);
          return Promise.reject(err);
        });
    },
    propfindDirectory(dirname) {
      const propfind = () =>
        new Promise((resolve, reject) =>
          req({
            method: 'PROPFIND',
            uri: dirname.split('/').map((component) => encodeURIComponent(component)).join('/'),
            headers: {
              Depth: '0',
            },
          }, (err, response, body) => {
            if (err) {
              return reject(err);
            }

            const { statusCode } = response;
            if (!(statusCode >= 200 && statusCode <= 299)) {
              return reject(new HttpError(statusCode, body));
            }
            return resolve();
          }));

      return requestHandler(propfind, null, retryCount, defaultErrorHandler);
    },
    async getLocalDirectoryContents(dirname, destDir, recursive) {
      const self = this;

      let files;
      try {
        files = await readdir(dirname);
      } catch (err) {
        log.error(`Unable to read local directory at "${dirname}". Has it been removed? Skipping.`);
        // Since we can't get the local file/directory stat return prematurely and move on.
        return;
      }

      return Promise.mapSeries(files, (async (file) => {
        const filePath = path.join(dirname, file);
        let stat;
        try {
          stat = await statAsync(filePath);
        } catch (err) {
          if (err.code === 'ENOENT') {
            log.error(`Unable to find local file or directory at "${filePath}". Has it been removed? Skipping.`);
            return;
          }
        }

        if (stat.isFile()) {
          return self.putFile({
            file: filePath,
            stat,
            dest: destDir,
          }).catch(() => {
            // Swallow the exception here to keep the upload going
            // the putFile call will include log information
          });
        }
        if (recursive) {
          const childDir = path.posix.join(destDir, file);

          let folderExists;
          try {
            await this.propfindDirectory(childDir);
            folderExists = true;
          } catch (e) {
            if (e.code === 404) {
              folderExists = false;
            } else {
              log.error(`Unable to find remote directory ${childDir}`);
              log.info(`Retry command => .gitto._cloud_upload --access_token_file "${tokenFile}" --local_source "${filePath}" --remote_destination_folder "${childDir}"`);
              // Since we can't get the remote directory properties return prematurely and move on.
              return;
            }
          }

          if (!folderExists) {
            try {
              await this.createRemoteDirectory(childDir);
            } catch (e) {
              if (e.code === 409) {
                log.error(`Unable to create remote directory "${childDir}" and its children as one or more parent folders do not exist`);
                log.info(`Retry command => .gitto._cloud_upload --access_token_file "${tokenFile}" --local_source "${filePath}" --remote_destination_folder "${childDir}" --recursive`);
                return;
              } else if (e.code === 405) {
                // The folder already exists (somehow), move along
                log.info(`Attempted to create remote directory "${childDir}" but it already exists. Check that there are no other uploads to the same directory to avoid overwriting files`);
              } else {
                // Unknown error
                log.error(`Unable to create remote directory "${childDir}" and its children: ${e.message}`);
                log.info(`Retry command => .gitto._cloud_upload --access_token_file "${tokenFile}" --local_source "${filePath}" --remote_destination_folder "${childDir}" --recursive`);
                return;
              }
            }
          }

          await self.getLocalDirectoryContents(
            filePath,
            childDir,
            recursive,
          );
        }
      }));
    },
    async put({ fileStat, filename, destination, recursive }) {
      if (fileStat.isFile()) {
        await this.putFile({
          file: filename,
          stat: fileStat,
          dest: destination,
        });
      } else {
        const folder = path.posix.join(destination, path.basename(filename));

        let folderExists;
        try {
          await this.propfindDirectory(folder);
          folderExists = true;
        } catch (e) {
          if (e.code === 404) {
            folderExists = false;
          } else {
            throw e;
          }
        }

        if (!folderExists) {
          try {
            await this.createRemoteDirectory(folder);
          } catch (e) {
            if (e.code === 409) {
              throw new Error(`Unable to create the remote directory "${folder}" as one or more parent folders do not exist`);
            } else if (e.code === 405) {
              // The folder already exists (somehow), move along
              log.info(`Attempted to create a remote directory at "${folder}" but it already exists. Check that there are no other uploads to the same directory to avoid overwriting files`);
            } else {
              throw e;
            }
          }
        }

        await this.getLocalDirectoryContents(filename, folder, recursive);
      }
    },
    createRemoteDirectory(dirname) {
      const mkcol = () =>
        new Promise((resolve, reject) =>
          req({
            method: 'MKCOL',
            uri: dirname.split('/').map((component) => encodeURIComponent(component)).join('/'),
          }, (error, response, body) => {
            if (error) {
              log.error(`\t- directory: ${dirname} - FAILED, ${error.message}`);
              return reject(error);
            }

            const { statusCode } = response;
            if (!(statusCode >= 200 && statusCode <= 299)) {
              log.error(`\t- directory: ${dirname} - FAILED`);
              return reject(new HttpError(statusCode, body));
            }
            log.success(`\t+ directory: ${dirname} - --`);
            resolve();
          }));

      return requestHandler(mkcol, null, retryCount, defaultErrorHandler);
    },
  };
};

export const createDataClient = inject(createClient);
