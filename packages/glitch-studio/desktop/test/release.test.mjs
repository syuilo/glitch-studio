import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import yaml from 'js-yaml';
import asar from '@electron/asar';
import { validateReleaseVersion, verifyReleaseArtifacts, verifyPackagedApplication } from '../release.mjs';

// 【入力は表記の揃ったSemVerに限定し、同一バージョンの別配布物を作らない】
// v接頭辞・空白・build metadataを受け付けると、タグやWindows版のバージョンが曖昧になる。
test('accepts canonical versions and rejects ambiguous or executable input', () => {
	for (const version of ['2.0.0', '2.0.0-alpha.2', '2.0.0-beta.1', '2.0.0-rc.1']) assert.equal(validateReleaseVersion(version), version);
	for (const version of ['', 'v2.0.0', '2.0', '02.0.0', '2.0.0 ', '2.0.0+build.1', '2.0.0; echo bad', null]) assert.throws(() => validateReleaseVersion(version));
});

// 【配布する最終インストーラーと更新メタデータのハッシュ・バージョン・名前を照合する】
// 異なるビルドのymlや署名前のハッシュを公開すると、利用者の更新が必ず失敗する。
test('verifies release artifacts and rejects altered installers or mismatched metadata', async t => {
	const temporaryRoot = path.resolve(os.tmpdir());
	const directory = await fs.mkdtemp(path.join(temporaryRoot, 'glitch-release-test-'));
	t.after(async () => {
		assert.equal(path.dirname(directory), temporaryRoot);
		assert.ok(path.basename(directory).startsWith('glitch-release-test-'));
		await fs.rm(directory, { recursive: true, force: true });
	});
	const version = '2.0.0-alpha.2';
	const installerName = `Glitch-Studio-${version}-x64-Setup.exe`;
	const installer = Buffer.from('installer contents');
	const sha512 = createHash('sha512').update(installer).digest('base64');
	const metadata = { version, path: installerName, sha512, files: [{ url: installerName, sha512 }] };
	await fs.writeFile(path.join(directory, installerName), installer);
	await fs.writeFile(path.join(directory, `${installerName}.blockmap`), 'blockmap');
	await fs.writeFile(path.join(directory, 'latest.yml'), yaml.dump(metadata));
	assert.deepEqual(await verifyReleaseArtifacts(directory, version), [installerName, `${installerName}.blockmap`, 'latest.yml']);
	await assert.rejects(verifyReleaseArtifacts(directory, '2.0.0-alpha.3'), /version/);
	await fs.writeFile(path.join(directory, installerName), 'altered');
	await assert.rejects(verifyReleaseArtifacts(directory, version), /does not match/);
});

// 【配布物の実際のASARから実行時依存の欠落を検出する】
// モノリポのルートを誤って依存収集すると、ビルドは成功してもelectron-updaterのimportで起動できなくなる。
// ASAR内のパスはOSごとに区切り文字が異なるため、Windowsでも実ファイルを読んで検証する。
test('rejects missing direct and transitive dependencies in a packaged application', async t => {
	const temporaryRoot = path.resolve(os.tmpdir());
	const directory = await fs.mkdtemp(path.join(temporaryRoot, 'glitch-package-test-'));
	t.after(async () => {
		assert.equal(path.dirname(directory), temporaryRoot);
		assert.ok(path.basename(directory).startsWith('glitch-package-test-'));
		await fs.rm(directory, { recursive: true, force: true });
	});
	const source = path.join(directory, 'app');
	const archive = path.join(directory, 'app.asar');
	await fs.mkdir(source);
	await fs.writeFile(path.join(source, 'package.json'), JSON.stringify({ dependencies: { updater: '1.0.0' } }));
	await asar.createPackage(source, archive);
	assert.throws(() => verifyPackagedApplication(archive), /Missing packaged runtime dependency: updater/);
	await fs.mkdir(path.join(source, 'node_modules/updater'), { recursive: true });
	await fs.writeFile(path.join(source, 'node_modules/updater/package.json'), JSON.stringify({ dependencies: { helper: '1.0.0' } }));
	await asar.createPackage(source, archive);
	asar.uncache(archive);
	assert.throws(() => verifyPackagedApplication(archive), /Missing packaged runtime dependency: helper/);
	await fs.mkdir(path.join(source, 'node_modules/helper'), { recursive: true });
	await fs.writeFile(path.join(source, 'node_modules/helper/package.json'), '{}');
	await asar.createPackage(source, archive);
	asar.uncache(archive);
	assert.doesNotThrow(() => verifyPackagedApplication(archive));
});
