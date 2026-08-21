// @ts-check
import js from '@eslint/js'
import tseslint from 'typescript-eslint'

/**
 * Constitution Principle IV: identifiers, comments, log messages and error
 * templates must be English. User-facing copy must go through the i18n layer.
 * The rule below rejects CJK literals anywhere except i18n resource files.
 */
const NO_CJK = {
  selector: ':matches(Literal[value=/[\\u3400-\\u4DBF\\u4E00-\\u9FFF\\u3040-\\u30FF]/], TemplateElement[value.raw=/[\\u3400-\\u4DBF\\u4E00-\\u9FFF\\u3040-\\u30FF]/])',
  message: 'Non-English literal outside the i18n layer (Constitution Principle IV). Move user-facing copy to packages/*/src/i18n/.',
}

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/*.min.js',
      'fonts/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['packages/*/src/**/*.{ts,tsx}', 'packages/*/tests/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-restricted-syntax': ['error', NO_CJK],
      'no-empty': ['error', { allowEmptyCatch: false }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // Exempt from the CJK-literal rule. Principle IV targets user-facing copy
    // that must go through i18n; none of these produce any:
    //   - i18n resources are the translations themselves
    //   - tests need CJK literals precisely to prove CJK renders
    //   - fixtures are rendering probes, not messages
    files: [
      'packages/*/src/i18n/**/*.{ts,tsx}',
      'packages/*/src/fixtures/**/*.ts',
      'packages/*/tests/**/*.{ts,tsx}',
    ],
    rules: { 'no-restricted-syntax': 'off' },
  },
)
