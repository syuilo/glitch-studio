import tsParser from '@typescript-eslint/parser';
import sharedConfig from '../../../../eslint.config.mjs';

// eslint-disable-next-line import/no-default-export
export default [
	...sharedConfig,
	{ ignores: ['**/node_modules', 'test'] },
	{
		files: ['**/*.ts'],
		languageOptions: {
			parserOptions: { parser: tsParser, project: ['./tsconfig.json'], tsconfigRootDir: import.meta.dirname },
		},
	},
];
