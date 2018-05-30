import program from 'commander';
import { dirname } from 'path';
import { pathExists, readJson } from 'fs-extra';
import {
  compose,
  isNumber,
  isUndefined,
  join,
  map,
  split,
} from 'lodash/fp';

export const required = (requiredFlags) => {
  const missingKeys = requiredFlags.filter((option) =>
    isUndefined(program[option]) ||
    (!isUndefined(program[option]) && program[option] === true));

  const formatRow = (row) =>
    (missingKeys.some((key) => row.includes(`--${key}`)) ? row : row);

  if (missingKeys.length) {
    program.help(compose(join('\n'), map(formatRow), split('\n')));
  }
};

export const validateRetryCount = (retryCount = 0) =>
  new Promise((resolve, reject) => {
    if (retryCount) {
      retryCount = retryCount === true ? 3 : retryCount;
    }

    if (typeof retryCount === 'string') {
      retryCount = parseInt(retryCount, 10);
    }

    if (!isNumber(retryCount)) {
      return reject('Retry count must be a number');
    }

    if (retryCount < 0 || retryCount > 5) {
      return reject('Out of range');
    }

    resolve(retryCount);
  });

export async function validateLogfile(logFile) {
  if (typeof logFile !== 'string') {
    throw new Error('You must specify a path to a log file.');
  }
  if (!await pathExists(dirname(logFile))) {
    throw new Error('No such path exists to log output to. Please specify a valid path.');
  }
}

export const parseAccessTokenFile = async (accessTokenFile) => {
  if (!(await pathExists(accessTokenFile))) {
    throw new Error(`The access token file provided, ${accessTokenFile}, can't be found.`);
  }
  try {
    return await readJson(accessTokenFile);
  } catch (e) {
    throw new Error(`The access token file provided, ${accessTokenFile}, can't be read.`);
  }
};
