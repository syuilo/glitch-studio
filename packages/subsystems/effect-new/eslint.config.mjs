import sharedConfig from '../../../eslint.config.mjs';

export default [
	...sharedConfig,
	{
		files: ['**/*.ts'],
		languageOptions: {
			parserOptions: {
				project: ['./shared/tsconfig.json', './renderer/tsconfig.json'],
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
];
