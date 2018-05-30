module.exports = {
    extends: 'airbnb-base',
    plugins: ['standard', 'import'],
    env: {
      node: true,
      es6: true
    },
    rules: {
      camelcase: 'off',
      curly: ['error', 'all'],
      indent: [
        'error',
        2,
        {
          MemberExpression: 1,
          SwitchCase: 1,
        }
      ],
      'consistent-return': 'off',
      'arrow-parens': ['error', 'always'],
      'func-names': 'off',
      'global-require': 'off',
      'import/no-extraneous-dependencies': 'off',
      'import/no-named-as-default-member': 'off',
      'no-bitwise': 'off',
      'no-case-declarations': 'off',
      'no-multi-assign': 'off',
      'no-tabs': ['off'],
      'no-param-reassign': 'off',
      'no-shadow': 'off',
      'no-return-assign': 'off',
      'no-unused-expressions': 'off',
      'no-underscore-dangle': 'off',
      'prefer-promise-reject-errors': 'off',
      'object-curly-newline': ['error', { consistent: true }],
      'standard/object-curly-even-spacing': [2, 'either'],
      'standard/array-bracket-even-spacing': [2, 'either'],
      'standard/computed-property-even-spacing': [2, 'even']
    },
    globals: {
      fetch: true,
      sinon: true,
      expect: true,
      request: true,
      rmdirAsync: true,
      mkdirAsync: true,
      createRandomString: true
    },
  };
