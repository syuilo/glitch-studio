import path from 'node:path';
import mediaFileTypes from './media-file-types.cjs';

export function getLaunchFileType(filePath) {
	if (typeof filePath !== 'string') return null;
	const extension = path.extname(filePath).slice(1).toLowerCase();
	if (extension === 'gsproj') return { kind: 'project' };
	const mediaFileType = mediaFileTypes.find(fileType => fileType.ext.includes(extension));
	return mediaFileType == null ? null : { kind: 'media', type: mediaFileType.type };
}

export function getStartupFilePaths(argv, { defaultApp = false, cwd = process.cwd() } = {}) {
	// 開発起動では実行ファイルの次にアプリのパスが入る。スイッチはファイル扱いせず、
	// 複数の位置引数は選択順のまま個別の編集ウィンドウへ割り当てる。
	return argv.slice(defaultApp ? 2 : 1)
		.filter(argument => !argument.startsWith('-') && getLaunchFileType(argument) != null)
		.map(filePath => path.resolve(cwd, filePath));
}
