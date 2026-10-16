const { version } = require('../../../package.json');

module.exports = {
	appId: 'io.github.syuilo.glitch-studio',
	productName: 'Glitch Studio',
	publish: [{ provider: 'github', owner: 'syuilo', repo: 'glitch-studio', channel: 'latest' }],
	afterPack: async context => {
		// pnpmのworkspace探索で別パッケージが選ばれても、起動不能な配布物を公開しない。
		const { verifyPackagedApplication } = await import('./release.mjs');
		verifyPackagedApplication(require('node:path').join(context.appOutDir, 'resources', 'app.asar'));
	},
	directories: { output: '../../../release' },
	extraMetadata: {
		version,
		description: 'Node-based image, video and audio editor',
		author: 'syuilo',
	},
	// エントリと実装だけを列挙する。実行時依存はelectron-builderに収集させ、開発依存は含めない。
	files: ['main.mjs', 'voicevox.mjs', 'preload.cjs', 'protocol-path.mjs', 'project-files.mjs', 'project-file-ipc.mjs', 'recent-projects.mjs', 'startup-project.mjs', 'export-files.mjs', 'export-file-ipc.mjs', 'desktop-update.mjs', 'desktop-instances.mjs', 'github-updates.mjs'],
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
