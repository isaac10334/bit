module.exports = {
  parser: '@typescript-eslint/parser',
  settings: {
    react: {
      version: 'detect',
    },
    'import/resolver': {
      node: {
        extensions: ['.js', '.jsx', '.ts', '.tsx'],
      },
    },
  },
  parserOptions: {
    project: require.resolve('./tsconfig.json'),
    // createDefaultProgram: true,
    ecmaFeatures: {
      jsx: true, // Allows for the parsing of JSX
    },
  },
  extends: [
    'airbnb-base',
    'airbnb-typescript/base',
    'plugin:@typescript-eslint/recommended',
    'plugin:promise/recommended',
    'plugin:react/recommended',
    'prettier',
  ],
  plugins: ['@typescript-eslint', 'promise'],
  rules: {
    complexity: ['error', { max: 25 }],
    'no-console': ['error'],
    '@typescript-eslint/no-unused-vars': ['error', { args: 'after-used' }],
    '@typescript-eslint/no-use-before-define': [
      'error',
      { functions: false, classes: true, variables: true, typedefs: true },
    ],
    '@typescript-eslint/return-await': 'error',
    'no-return-await': 'off',
    '@typescript-eslint/no-misused-promises': 'error',
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/ban-ts-comment': 'off',
    '@typescript-eslint/ban-types': 'off',
    'no-shadow': 'off',
    '@typescript-eslint/no-shadow': ['error'],
    // ERRORS OF plugin:@typescript-eslint/recommended
    '@typescript-eslint/no-var-requires': 'off',
    '@typescript-eslint/ban-ts-ignore': 'off',
    '@typescript-eslint/camelcase': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    // END ERRORS OF plugin:@typescript-eslint/recommended

    // ERRORS OF 'plugin:promise/recommended'
    'promise/always-return': 'off',
    'promise/no-nesting': 'off',
    // END ERRORS OF 'plugin:promise/recommended'
    'import/prefer-default-export': 'off', // typescript works better without default export
    'import/export': 'off', // typescript does allow multiple export default when overloading. not sure why it's enabled here. rule source: https://github.com/benmosher/eslint-plugin-import/blob/master/docs/rules/export.md
    'prefer-object-spread': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    'import/no-cycle': 'off',
    'import/no-useless-path-segments': 'off',
    'lines-between-class-members': 'off',
    radix: 'off',
    'no-underscore-dangle': 'off',
    'no-param-reassign': 'off',
    'no-return-assign': [0, 'except-parens'],
    'class-methods-use-this': 'off',
    // 'simple-import-sort/sort': 'error',
    // 'sort-imports': 'off',
    // 'import/first': 'error',
    // 'import/newline-after-import': 'error',
    'no-duplicate-imports': 'error',
    'prefer-destructuring': 'off',
    'import/no-extraneous-dependencies': 'off',
    'no-restricted-syntax': [2, 'ForInStatement', 'LabeledStatement', 'WithStatement'],
    'no-unused-expressions': 'off',
    'max-len': [
      2,
      120,
      2,
      {
        ignoreUrls: true,
        ignoreComments: true,
        ignoreRegExpLiterals: true,
        ignoreStrings: true,
        ignoreTemplateLiterals: true,
      },
    ],
    'max-lines': [2, 1800],
    'func-names': [0],

    // ERRORS OF plugin:react/recommended
    'react/no-unescaped-entities': 'off',

    // The following rules started failing once upgraded eslint to v8 and airbnb-base to v15 (from v5).
    '@typescript-eslint/default-param-last': 'off', // TODO: temporarily ignore. please fix this later
    '@typescript-eslint/lines-between-class-members': 'off', // TODO: temporarily ignore. please fix this later
    '@typescript-eslint/no-unused-expressions': 'off', // TODO: temporarily ignore. please fix this later
    '@typescript-eslint/naming-convention': 'off', // TODO: temporarily ignore. please fix this later
    'arrow-body-style': 'off', // TODO: temporarily ignore. please fix this later
    'prefer-arrow-callback': 'off', // TODO: temporarily ignore. please fix this later
    'import/no-import-module-export': 'off', // TODO: temporarily ignore. please fix this later
    'prefer-regex-literals': 'off', // TODO: temporarily ignore. please fix this later
    'no-restricted-exports': 'off', // TODO: temporarily ignore. please fix this later
    'import/no-import-module-exports': 'off', // TODO: temporarily ignore. please fix this later
    'no-promise-executor-return': 'off', // TODO: temporarily ignore. please fix this later
    'no-duplicate-imports': 'off', // TODO: temporarily ignore. please fix this later
    'import/no-relative-packages': 'off', // TODO: temporarily ignore. please fix this later
  },
  env: {
    browser: true,
    node: true,
    mocha: true,
  },
};
