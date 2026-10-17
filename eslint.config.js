import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import globals from 'globals';

export default [
  {
    ignores: ['node_modules/**', 'dist/**', 'output/**'],
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    ...js.configs.recommended,
    plugins: {'@stylistic': stylistic},
    languageOptions: {
      ecmaVersion: 2022,
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['error', {ignoreRestSiblings: true}],
      eqeqeq: ['error', 'always', {null: 'ignore'}],
      'no-var': 'error',
      'prefer-const': 'error',
      curly: ['error', 'all'],
      'one-var': ['error', 'never'],
      '@stylistic/indent': [
        'error',
        2,
        {
          VariableDeclarator: 2,
          MemberExpression: 2,
          FunctionDeclaration: {parameters: 2, body: 1},
          FunctionExpression: {parameters: 2, body: 1},
          CallExpression: {arguments: 2},
          SwitchCase: 1,
        },
      ],
      '@stylistic/brace-style': ['error', '1tbs'],
      '@stylistic/indent-binary-ops': ['error', 4],
      '@stylistic/semi': ['error', 'always'],
      '@stylistic/quotes': ['error', 'single'],
      '@stylistic/object-curly-spacing': ['error', 'never'],
      '@stylistic/array-bracket-spacing': ['error', 'never'],
      '@stylistic/comma-dangle': ['error', 'always-multiline'],
      '@stylistic/comma-spacing': 'error',
      '@stylistic/key-spacing': 'error',
      '@stylistic/keyword-spacing': 'error',
      '@stylistic/space-infix-ops': 'error',
      '@stylistic/space-before-blocks': 'error',
      '@stylistic/arrow-spacing': 'error',
      '@stylistic/space-in-parens': ['error', 'never'],
      '@stylistic/no-tabs': 'error',
      '@stylistic/no-trailing-spaces': 'error',
      '@stylistic/eol-last': ['error', 'always'],
      '@stylistic/max-statements-per-line': ['error', {max: 1}],
      '@stylistic/max-len': [
        'error',
        {
          code: 80,
          ignoreUrls: true,
          ignorePattern: '^(import\\s|export\\s.*\\sfrom\\s)',
        },
      ],
    },
  },
  {
    files: [
      'eslint.config.js',
      'bin/**/*.js',
      'src/**/*.js',
      'scripts/**/*.js',
      'test/**/*.js',
    ],
    ignores: ['src/geometry.js'],
    languageOptions: {
      globals: globals.nodeBuiltin,
    },
  },
  {
    files: ['viewer/**/*.js'],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    // These callbacks run inside Playwright's browser page.
    files: ['scripts/browser-check.js'],
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        requestAnimationFrame: 'readonly',
      },
    },
  },
];
