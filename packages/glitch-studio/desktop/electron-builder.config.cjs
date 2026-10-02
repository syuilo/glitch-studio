const { version } = require('../../package.json');

module.exports = {
	appId: 'io.github.syuilo.glitch-studio',
	productName: 'Glitch Studio',
	directories: { output: '../../release' },
	extraMetadata: {
		name: 'glitch-studio',
		version,
		description: 'Node-based image, video and audio editor',
		author: 'syuilo',
	},
	// 開発用スクリプトや依存パッケージを配布物に含めない。
	files: ['main.mjs', 'preload.cjs', 'protocol-path.mjs', '!node_modules/**/*'],
	extraResources: [{ from: '../ui/dist-electron', to: 'ui' }],
	asar: true,
	npmRebuild: false,
	win: {
		target: [{ target: 'nsis', arch: ['x64'] }],
		icon: '../ui/public/icon-512.png',
		artifactName: 'Glitch-Studio-${version}-${arch}-Setup.${ext}',
	},
	nsis: {
		oneClick: false,
		perMachine: false,
		allowToChangeInstallationDirectory: true,
	},
};
