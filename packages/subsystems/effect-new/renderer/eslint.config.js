import sharedConfig from '../../../../eslint.config.mjs';

// eslint-disable-next-line import/no-default-export
export default [
	...sharedConfig,
	{
		files: ['**/*.ts'],
		languageOptions: {
			parserOptions: {
				project: ['./tsconfig.json'],
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
];
