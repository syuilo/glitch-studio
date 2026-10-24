import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { getLaunchFileType, getStartupFilePaths } from '../startup-files.mjs';
import mediaFileTypes from '../media-file-types.cjs';

// 【関連付けから渡された日本語・空白を含むパスをそのまま読み込む】
// OSは引用符を解釈済みの引数を渡すため、空白で分割したり独自に引用符を除去しない。
test('accepts an associated project path with spaces, Unicode and an uppercase extension', () => {
	const file = path.resolve('作品 フォルダ', '試作.GSPROJ');
	assert.deepEqual(getStartupFilePaths(['Glitch Studio.exe', file]), [file]);
});

// 【開発起動のアプリ引数とスイッチを無視し、相対パスは起動元から解決する】
// 配布版とelectron .では引数の開始位置が異なる。未指定時には空の一覧を返す。
test('handles development arguments, relative paths and launches without a project', () => {
	const cwd = path.resolve('projects');
	assert.deepEqual(getStartupFilePaths(['electron', 'app.gsproj', '--inspect=9229', 'sample.gsproj'], { defaultApp: true, cwd }), [path.join(cwd, 'sample.gsproj')]);
	assert.deepEqual(getStartupFilePaths(['electron', 'app.gsproj'], { defaultApp: true }), []);
	assert.deepEqual(getStartupFilePaths(['Glitch Studio.exe', '--log-file=debug.gsproj', 'document.txt']), []);
	assert.deepEqual(getStartupFilePaths(['Glitch Studio.exe']), []);
});

// 【画像・動画・プロジェクトを同時に指定しても順序を保ち、公開した全拡張子を受け取る】
// 拡張子の登録だけ増やして実際の起動で無視されることや、先頭以外のファイルが失われることを防ぐ。
test('accepts all associated media types and keeps mixed launch arguments in order', () => {
	const files = mediaFileTypes.flatMap(({ ext, type }) => ext.map(extension => {
		const filePath = path.resolve('素材 フォルダ', `作品.${extension.toUpperCase()}`);
		assert.deepEqual(getLaunchFileType(filePath), { kind: 'media', type });
		return filePath;
	}));
	const projectPath = path.resolve('project.gsproj');
	assert.deepEqual(getStartupFilePaths(['Glitch Studio.exe', files[0], projectPath, '--log-file=debug.mp4', ...files.slice(1)]),
		[files[0], projectPath, ...files.slice(1)]);
	for (const invalid of [null, '', 'notes.txt', 'picture.png.exe', 'music.mp3']) assert.equal(getLaunchFileType(invalid), null);
});
