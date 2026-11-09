import tsParser from '@typescript-eslint/parser';
import sharedConfig from '../../../eslint.config.mjs';

// eslint-disable-next-line import/no-default-export
export default [
	...sharedConfig,
	{
		files: ['src/**/*.ts'],
		languageOptions: {
			parser: tsParser,
			parserOptions: { project: ['./tsconfig.json'], tsconfigRootDir: import.meta.dirname },
		},
	},
];
