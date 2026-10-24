import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import mediaFileTypes from '../media-file-types.cjs';

const configuration = createRequire(import.meta.url)('../electron-builder.config.cjs');

// 【OSに公開した素材形式を、両OSで同じ起動処理へ渡せるようにする】
// Windowsの標準関連付けは既定値を書き換えるため、素材には使わない。
// macOSは代替Editorとして公開し、独自形式gsprojの既存登録も維持する。
test('declares media as alternate macOS editors and keeps Windows media out of default associations', async () => {
	assert.deepEqual(configuration.fileAssociations.map(({ ext }) => ext), ['gsproj']);
	assert.equal(configuration.nsis.include, 'resources/installer.nsh');
	assert.equal(configuration.nsis.perMachine, false);
	assert.deepEqual(configuration.mac.fileAssociations.flatMap(({ ext }) => ext), mediaFileTypes.flatMap(({ ext }) => ext));
	assert.ok(configuration.mac.fileAssociations.every(({ role, rank }) => role === 'Editor' && rank === 'Alternate'));
	const script = await readFile(new URL(`../${configuration.nsis.include}`, import.meta.url), 'utf8');
	const extensions = Array.from(script.matchAll(/!insertmacro \$\{ACTION\} "([a-z0-9]+)"/g), match => match[1]);
	assert.deepEqual(extensions, mediaFileTypes.flatMap(({ ext }) => ext));
});
