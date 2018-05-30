#!/usr/bin/env node

import { yellow, red, green } from 'chalk';
import clear from 'clear';
import { Spinner } from 'clui';
import { textSync } from 'figlet';
import { prompt } from 'inquirer';
import Preferences from 'preferences';
import touch from 'touch';
import GitHubApi from 'github';
import { extend, without } from 'lodash';
import { readdirSync, writeFileSync } from 'fs';
import { directoryExists, getCurrentDirectoryBase } from './lib/files';

const git = require('simple-git')();

clear();
// eslint-disable-next-line
console.log(yellow(textSync('Gitto', {
  horizontalLayout: 'full',
})));

if (directoryExists('.git')) {
  // eslint-disable-next-line
  console.log(red('Already a git repository!'));
  process.exit();
}

const github = new GitHubApi({
  version: '3.0.0',
});

function getGithubCredentials(callback) {
  const questions = [{
    name: 'username',
    type: 'input',
    message: 'Enter your Github username or e-mail address:',
    validate(value) {
      if (value.length) {
        return true;
      }
      return 'Please enter your username or e-mail address';
    },
  }, {
    name: 'password',
    type: 'password',
    message: 'Enter your password:',
    validate(value) {
      if (value.length) {
        return true;
      }
      return 'Please enter your password';
    },
  }];

  prompt(questions).then(callback);
}

function getGithubToken(callback) {
  const prefs = new Preferences('gitto');

  if (prefs.github && prefs.github.token) {
    return callback(null, prefs.github.token);
  }

  getGithubCredentials((credentials) => {
    const status = new Spinner('Authenticating you, please wait...');
    status.start();

    github.authenticate(extend({ type: 'basic' }, credentials));

    github.authorization.create({
      scopes: ['user', 'public_repo', 'repo', 'repo:status'],
      note: 'gitto, the command-line tool for initalizing Git repos',
    }, (err, res) => {
      status.stop();
      if (err) {
        return callback(err);
      }
      if (res.token) {
        prefs.github = {
          token: res.token,
        };
        return callback(null, res.token);
      }
      return callback();
    });
  });
}

function createRepo(callback) {
  const argv = require('minimist')(process.argv.slice(2));

  const questions = [{
    type: 'input',
    name: 'name',
    message: 'Enter a name for the repository:',
    default: argv._[0] || getCurrentDirectoryBase(),
    validate(value) {
      if (value.length) {
        return true;
      }
      return 'Please enter a name for the repository';
    },
  }, {
    type: 'input',
    name: 'description',
    default: argv._[1] || null,
    message: 'Optionally enter a description of the repository:',
  }, {
    type: 'list',
    name: 'visibility',
    message: 'Public or private:',
    choices: ['public', 'private'],
    default: 'public',
  }];

  prompt(questions).then((answers) => {
    const status = new Spinner('Creating repository...');
    status.start();

    const data = {
      name: answers.name,
      description: answers.description,
      private: (answers.visibility === 'private'),
    };

    github.repos.create(
      data,
      (err, res) => {
        status.stop();
        if (err) {
          return callback(err);
        }
        return callback(null, res.ssh_url);
      },
    )
  });
}

function createGitignore(callback) {
  const filelist = without(readdirSync('.'), '.git', '.gitignore');

  if (filelist.length) {
    prompt([{
      type: 'checkbox',
      name: 'ignore',
      message: 'Select the files and/or folders you wish to ignore:',
      choices: filelist,
      default: ['node_modules', 'bower_components'],
    }]).then((answers) => {
      if (answers.ignore.length) {
        writeFileSync('.gitignore', answers.ignore.join('\n'));
      } else {
        touch('.gitignore');
      }
      return callback();
    });
  } else {
    touch('.gitignore');
    return callback();
  }
}

function setupRepo(url, callback) {
  const status = new Spinner('Setting up the repository...');
  status.start();

  git
    .init()
    .add('.gitignore')
    .add('./*')
    .commit('Initial commit')
    .addRemote('origin', url)
    .push('origin', 'master')
    .then(() => {
      status.stop();
      return callback();
    });
}

function githubAuth(callback) {
  getGithubToken((err, token) => {
    if (err) {
      return callback(err);
    }
    github.authenticate({
      type: 'oauth',
      token,
    });
    return callback(null, token);
  });
}

githubAuth((err, authed) => {
  if (err) {
    // eslint-disable default-case
    switch (err.code) {
      case 401:
        // eslint-disable-next-line
	  	console.log(red('Couldn\'t log you in. Please try again.'));
        break;
      case 422:
        // eslint-disable-next-line
	  	console.log(red('You already have an access token.'));
        break;
    }
  }
  if (authed) {
    // eslint-disable-next-line
	console.log(green('Sucessfully authenticated!'));
    createRepo((err, url) => {
      if (err) {
        // eslint-disable-next-line
		console.log('An error has occured');
      }
      if (url) {
        createGitignore(() => {
          setupRepo(url, (err) => {
            if (!err) {
              // eslint-disable-next-line
			  console.log(green('All done!'));
            }
          });
        });
      }
    });
  }
});
