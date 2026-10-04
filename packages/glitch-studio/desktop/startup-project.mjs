import path from 'node:path';

export function getStartupProjectPath(argv, { defaultApp = false, cwd = process.cwd() } = {}) {
	// 開発起動では実行ファイルの次にアプリのパスが入る。スイッチを
	// プロジェクトと誤認しないよう、.gsprojの位置引数だけを読み込む。
	const filePath = argv.slice(defaultApp ? 2 : 1).find(argument =>
		!argument.startsWith('-') && path.extname(argument).toLowerCase() === '.gsproj');
	return filePath ? path.resolve(cwd, filePath) : null;
}
