module.exports = {
  extends: '../.eslintrc.js',
  env: {
    mocha: true,
  },
  plugins: [
    'mocha',
  ],
  rules: {
    'no-underscore-dangle': ['off'],
    'function-paren-newline': ['off'],
    'mocha/no-exclusive-tests': 'error',
    'mocha/no-identical-title': 'error',
    'mocha/no-nested-tests': 'error',
  },
};
