import js from '@eslint/js';
import eslintPluginAstro from 'eslint-plugin-astro';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['**/dist/', '**/.astro/', '**/node_modules/', 'data/'] },
  js.configs.recommended,
  ...eslintPluginAstro.configs.recommended,
  ...tseslint.configs.recommended.map((config) => ({ ...config, files: ['**/*.ts'] })),
  {
    files: ['pipeline/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['site/**/*.{astro,ts,js,mjs}'],
    languageOptions: { globals: { ...globals.browser } },
  },
);
