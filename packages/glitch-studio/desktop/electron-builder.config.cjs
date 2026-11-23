const { version } = require('../../../package.json');
const mediaFileTypes = require('./media-file-types.cjs');
const { Arch } = require('electron-builder');

const projectFileAssociation = { ext: 'gsproj', name: 'GlitchStudio.Project', description: 'Glitch Studio project', role: 'Editor' };

// エントリと実装だけを列挙する。実行時依存はelectron-builderに収集させ、開発依存は含めない。
const applicationFiles = [
	'main.mjs',
	'editor-windows.mjs',
	'mcp-http-server.mjs',
	'mcp-editor-bridge.mjs',
	'mcp-server-controller.mjs',
	'startup-splash.mjs',
	'resources/startup-splash.png',
	'voicevox.mjs',
	'preload.cjs',
	'app-protocol.mjs',
	'protocol-path.mjs',
	'project-files.mjs',
	'project-file-ipc.mjs',
	'file-dialog-directory-history.mjs',
	'file-dialogs.mjs',
	'project-close-guard.mjs',
	'edit-command-ipc.mjs',
	'clipboard-ipc.mjs',
	'external-assets.mjs',
	'recent-projects.mjs',
	'startup-files.mjs',
	'file-launch.mjs',
	'startup-file-ipc.mjs',
	'media-file-types.cjs',
	'export-files.mjs',
	'export-file-ipc.mjs',
	'portable-nodes-effect-ipc.mjs',
	'dist/portable-nodes-effect-worker.mjs',
	'desktop-update.mjs',
	'desktop-instances.mjs',
	'github-updates.mjs',
];

module.exports = {
	appId: 'io.github.syuilo.glitch-studio',
	productName: 'Glitch Studio',
	fileAssociations: [projectFileAssociation],
	publish: [{ provider: 'github', owner: 'syuilo', repo: 'glitch-studio', channel: 'latest' }],
	afterPack: async context => {
		// pnpmのworkspace探索で別パッケージが選ばれても、起動不能な配布物を公開しない。
		const { verifyPackagedApplication, verifyPackagedPortableNodesEffect } = await import('./release.mjs');
		const resourcesDirectory = context.packager.getResourcesDir(context.appOutDir);
		verifyPackagedApplication(require('node:path').join(resourcesDirectory, 'app.asar'), applicationFiles);
		await verifyPackagedPortableNodesEffect(resourcesDirectory, context.electronPlatformName, Arch[context.arch]);
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
		// esbuildのネイティブプロセスが読むため、ビルド資材はASAR外へ配置する。
		{ from: 'dist/portable-nodes-effect-catalog', to: 'portable-nodes-effect-catalog' },
		// OSがタスクバー用のアイコンを直接読み取れるよう、asarの外に配置する。
		{ from: 'resources/icon.ico', to: 'icon.ico' },
	],
	asar: true,
	asarUnpack: ['node_modules/@esbuild/**/*', 'node_modules/esbuild/bin/*'],
	// UIの対応言語に合わせ、Electronの言語リソースも日英だけを同梱して配布サイズを抑える。
	electronLanguages: ['en-US', 'ja'],
	npmRebuild: false,
	win: {
		target: [{ target: 'nsis', arch: ['x64'] }],
		icon: 'resources/icon.ico',
		artifactName: 'Glitch-Studio-${version}-${arch}-Setup.${ext}',
	},
	mac: {
		// 汎用の画像・動画は代替の編集アプリとして公開する。
		fileAssociations: mediaFileTypes.map(({ ext, type }) => ({
			ext, name: `Glitch Studio ${type}`, role: 'Editor', rank: 'Alternate',
		})),
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
		// 標準のfileAssociationsは拡張子の既定値も書くため、素材は専用の候補登録だけを行う。
		include: 'resources/installer.nsh',
		oneClick: false,
		perMachine: false,
		allowToChangeInstallationDirectory: true,
	},
};
