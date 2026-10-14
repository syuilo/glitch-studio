const { version } = require('../../../package.json');

module.exports = {
	appId: 'io.github.syuilo.glitch-studio',
	productName: 'Glitch Studio',
	directories: { output: '../../../release' },
	extraMetadata: {
		name: 'glitch-studio',
		version,
		description: 'Node-based image, video and audio editor',
		author: 'syuilo',
	},
	// 開発用スクリプトや依存パッケージを配布物に含めない。
	files: ['main.mjs', 'voicevox.mjs', 'preload.cjs', 'protocol-path.mjs', 'project-files.mjs', 'project-file-ipc.mjs', 'startup-project.mjs', 'export-files.mjs', 'export-file-ipc.mjs', '!node_modules/**/*'],
	extraResources: [
		{ from: '../ui/dist-electron', to: 'ui' },
		// OSがタスクバー用のアイコンを直接読み取れるよう、asarの外に配置する。
		{ from: 'resources/icon.ico', to: 'icon.ico' },
	],
	asar: true,
	npmRebuild: false,
	win: {
		// 専用アイコンを指定しない場合は、実行ファイルのGlitch Studioアイコンを使う。
		fileAssociations: [{ ext: 'gsproj', name: 'GlitchStudio.Project', description: 'Glitch Studio project' }],
		target: [{ target: 'nsis', arch: ['x64'] }],
		icon: 'resources/icon.ico',
		artifactName: 'Glitch-Studio-${version}-${arch}-Setup.${ext}',
	},
	nsis: {
		oneClick: false,
		perMachine: false,
		allowToChangeInstallationDirectory: true,
	},
};
