const { version } = require('../../../package.json');

// エントリと実装だけを列挙する。実行時依存はelectron-builderに収集させ、開発依存は含めない。
const applicationFiles = [
	'main.mjs',
	'startup-splash.mjs',
	'resources/startup-splash.png',
	'voicevox.mjs',
	'preload.cjs',
	'app-protocol.mjs',
	'protocol-path.mjs',
	'project-files.mjs',
	'project-file-ipc.mjs',
	'project-close-guard.mjs',
	'edit-command-ipc.mjs',
	'external-assets.mjs',
	'recent-projects.mjs',
	'startup-project.mjs',
	'project-launch.mjs',
	'export-files.mjs',
	'export-file-ipc.mjs',
	'desktop-update.mjs',
	'desktop-instances.mjs',
	'github-updates.mjs',
];

module.exports = {
	appId: 'io.github.syuilo.glitch-studio',
	productName: 'Glitch Studio',
	// macOSのCFBundleDocumentTypesとWindowsの関連付けで、同じプロジェクト拡張子を扱う。
	fileAssociations: [{ ext: 'gsproj', name: 'GlitchStudio.Project', description: 'Glitch Studio project', role: 'Editor' }],
	publish: [{ provider: 'github', owner: 'syuilo', repo: 'glitch-studio', channel: 'latest' }],
	afterPack: async context => {
		// pnpmのworkspace探索で別パッケージが選ばれても、起動不能な配布物を公開しない。
		const { verifyPackagedApplication } = await import('./release.mjs');
		verifyPackagedApplication(require('node:path').join(context.packager.getResourcesDir(context.appOutDir), 'app.asar'), applicationFiles);
	},
	directories: { output: '../../../release' },
	extraMetadata: {
		version,
		description: 'Node-based image, video and audio editor',
		author: 'syuilo',
	},
	// electron-builderはこの配列をFileSetへ正規化するため、検証用の一覧とは配列を共有しない。
	files: [...applicationFiles],
	extraResources: [
		{ from: '../ui/dist-electron', to: 'ui' },
		// OSがタスクバー用のアイコンを直接読み取れるよう、asarの外に配置する。
		{ from: 'resources/icon.ico', to: 'icon.ico' },
	],
	asar: true,
	npmRebuild: false,
	win: {
		target: [{ target: 'nsis', arch: ['x64'] }],
		icon: 'resources/icon.ico',
		artifactName: 'Glitch-Studio-${version}-${arch}-Setup.${ext}',
	},
	mac: {
		target: [{ target: 'dmg', arch: ['arm64', 'x64'] }],
		icon: '../ui/public/icon-512.png',
		artifactName: 'Glitch-Studio-${version}-mac-${arch}.${ext}',
		// Apple Developer証明書を使わず、Apple Siliconでも実行できるad-hoc署名を付ける。
		// 発行元の証明や公証は行わないため、macOSの自動更新は引き続き無効とする。
		identity: '-',
		hardenedRuntime: false,
		notarize: false,
		publish: null,
		extendInfo: {
			NSCameraUsageDescription: 'Glitch Studio uses your camera as a live input.',
			NSMicrophoneUsageDescription: 'Glitch Studio uses your microphone as a live audio input.',
		},
	},
	dmg: {
		writeUpdateInfo: false,
	},
	nsis: {
		oneClick: false,
		perMachine: false,
		allowToChangeInstallationDirectory: true,
	},
};
