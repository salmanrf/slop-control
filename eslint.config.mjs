import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dist-e2e/**',
      '**/test-results/**',
      '**/playwright-report/**',
      'docs-site/**',
      'public-docs/**',
      'supabase/**',
      '**/coverage/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: { globals: { module: 'writable', require: 'readonly', process: 'readonly' } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
);
