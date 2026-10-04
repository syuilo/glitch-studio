import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { getStartupProjectPath } from '../startup-project.mjs';

// 【関連付けから渡された日本語・空白を含むパスをそのまま読み込む】
// OSは引用符を解釈済みの引数を渡すため、空白で分割したり独自に引用符を除去しない。
test('accepts an associated project path with spaces, Unicode and an uppercase extension', () => {
	const file = path.resolve('作品 フォルダ', '試作.GSPROJ');
	assert.equal(getStartupProjectPath(['Glitch Studio.exe', file]), file);
});

// 【開発起動のアプリ引数とスイッチを無視し、相対パスは起動元から解決する】
// 配布版とelectron .では引数の開始位置が異なる。未指定時にダッシュボードへ戻せるようnullを返す。
test('handles development arguments, relative paths and launches without a project', () => {
	const cwd = path.resolve('projects');
	assert.equal(getStartupProjectPath(['electron', 'app.gsproj', '--inspect=9229', 'sample.gsproj'], { defaultApp: true, cwd }), path.join(cwd, 'sample.gsproj'));
	assert.equal(getStartupProjectPath(['electron', 'app.gsproj'], { defaultApp: true }), null);
	assert.equal(getStartupProjectPath(['Glitch Studio.exe', '--log-file=debug.gsproj', 'image.png']), null);
	assert.equal(getStartupProjectPath(['Glitch Studio.exe']), null);
});
