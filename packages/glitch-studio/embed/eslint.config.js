import tsParser from '@typescript-eslint/parser';
import sharedConfig from '../../../eslint.config.mjs';

export default [
	...sharedConfig,
	{ ignores: ['**/node_modules', 'test'] },
	{
		files: ['src/**/*.ts'],
		languageOptions: {
			parserOptions: {
				parser: tsParser,
				project: ['./tsconfig.json'],
				sourceType: 'module',
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
];
