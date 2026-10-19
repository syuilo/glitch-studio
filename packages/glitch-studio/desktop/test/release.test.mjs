import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import yaml from 'js-yaml';
import asar from '@electron/asar';
import { validateReleaseVersion, resolveReleaseVersion, verifyReleaseArtifacts, verifyPackagedApplication } from '../release.mjs';

// 【入力は表記の揃ったSemVerに限定し、同一バージョンの別配布物を作らない】
// v接頭辞・空白・build metadataを受け付けると、タグやWindows版のバージョンが曖昧になる。
test('accepts canonical versions and rejects ambiguous or executable input', () => {
	for (const version of ['2.0.0', '2.0.0-alpha.2', '2.0.0-beta.1', '2.0.0-rc.1']) assert.equal(validateReleaseVersion(version), version);
	for (const version of ['', 'v2.0.0', '2.0', '02.0.0', '2.0.0 ', '2.0.0+build.1', '2.0.0; echo bad', null]) assert.throws(() => validateReleaseVersion(version));
});

// 【明示指定では従来のバージョン検証とダウングレード禁止を維持する】
// インクリメントの追加によって、不正なタグや古い配布物を作れるようにしない。
// 現在と同じ番号は、まだ公開していないバージョンをリリースする既存の運用で使用する。
test('resolves explicit versions and rejects missing, invalid or older versions', () => {
	assert.equal(resolveReleaseVersion('2.0.0-alpha.4', 'explicit', '2.0.0-beta.1'), '2.0.0-beta.1');
	assert.equal(resolveReleaseVersion('2.0.0', 'explicit', '2.0.0'), '2.0.0');
	for (const version of ['', null, 'v2.0.0', '2.0.0+build.1']) {
		assert.throws(() => resolveReleaseVersion('2.0.0-alpha.4', 'explicit', version), /canonical SemVer/);
	}
	assert.throws(() => resolveReleaseVersion('2.0.0', 'explicit', '2.0.0-alpha.4'), /must not be older/);
});

// 【正式版からpatch・minor・majorを選んで次のバージョンを生成する】
// 上位の番号を増やすときは下位の番号をリセットし、手入力の計算ミスを避ける。
test('increments stable patch, minor and major versions', () => {
	assert.equal(resolveReleaseVersion('1.2.3', 'patch'), '1.2.4');
	assert.equal(resolveReleaseVersion('1.2.3', 'minor', ''), '1.3.0');
	assert.equal(resolveReleaseVersion('1.2.3', 'major'), '2.0.0');
});

// 【開発版番号のインクリメントは既存のalpha・beta・rcなどの段階を維持する】
// 開発版を続けて公開するとき、意図せず正式版や別の開発段階へ切り替わらないようにする。
test('increments prereleases while preserving their existing identifiers', () => {
	for (const identifier of ['alpha', 'beta', 'rc']) {
		assert.equal(resolveReleaseVersion(`2.0.0-${identifier}.4`, 'prerelease'), `2.0.0-${identifier}.5`);
	}
	assert.equal(resolveReleaseVersion('2.0.0-alpha', 'prerelease'), '2.0.0-alpha.0');
	assert.equal(resolveReleaseVersion('2.0.0-4', 'prerelease'), '2.0.0-5');
});

// 【開発版からのpatch・minor・majorはnode-semverと同じ正式版への昇格規則を使う】
// 例えば2.0.0-alpha.4のpatchは2.0.0になるため、配布時の意図に関わる挙動として固定する。
test('promotes prereleases according to semver increment rules', () => {
	for (const mode of ['patch', 'minor', 'major']) {
		assert.equal(resolveReleaseVersion('2.0.0-alpha.4', mode), '2.0.0');
	}
	assert.equal(resolveReleaseVersion('2.1.3-beta.2', 'minor'), '2.2.0');
	assert.equal(resolveReleaseVersion('2.1.3-beta.2', 'major'), '3.0.0');
});

// 【曖昧な入力と未指定の開発段階を、コミットやReleaseの作成前に拒否する】
// 選択と手入力が競合した場合に一方を黙って無視せず、正式版から「次のpatch-0」も自動生成しない。
// 基準バージョンや増分後の値がSemVerの範囲外になる場合も公開を止める。
test('rejects conflicting inputs, unsupported modes and invalid increment bases', () => {
	assert.throws(() => resolveReleaseVersion('1.2.3', 'patch', '1.2.4'), /Leave version empty/);
	for (const mode of ['', null, 'premajor', 'unsupported']) {
		assert.throws(() => resolveReleaseVersion('1.2.3', mode), /version mode/);
	}
	assert.throws(() => resolveReleaseVersion('1.2.3', 'prerelease'), /requires a current development version/);
	assert.throws(() => resolveReleaseVersion('invalid', 'patch'), /canonical SemVer/);
	assert.throws(() => resolveReleaseVersion('9007199254740991.0.0', 'major'));
});

// 【配布する最終インストーラーと更新メタデータのハッシュ・バージョン・名前を照合する】
// 異なるビルドのymlや署名前のハッシュを公開すると、利用者の更新が必ず失敗する。
// 公開時の既定の検証ではmacOSの両アーキテクチャも必須とし、一部のOSだけを公開しない。
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
	const windowsFiles = [installerName, `${installerName}.blockmap`, 'latest.yml'];
	assert.deepEqual(await verifyReleaseArtifacts(directory, version, 'windows'), windowsFiles);
	await assert.rejects(verifyReleaseArtifacts(directory, version), /mac-arm64\.dmg/);
	const macosFiles = ['arm64', 'x64'].map(architecture => `Glitch-Studio-${version}-mac-${architecture}.dmg`);
	for (const name of macosFiles) await fs.writeFile(path.join(directory, name), 'disk image');
	assert.deepEqual(await verifyReleaseArtifacts(directory, version), [...windowsFiles, ...macosFiles]);
	await assert.rejects(verifyReleaseArtifacts(directory, '2.0.0-alpha.3'), /version/);
	await fs.writeFile(path.join(directory, installerName), 'altered');
	await assert.rejects(verifyReleaseArtifacts(directory, version), /does not match/);
});

// 【macOS単独のビルドでも両アーキテクチャの空でないDMGを要求する】
// Windowsの成果物を持たないmacOSジョブで検証でき、Intel版の欠落や空のDMGを公開前に検出する。
test('verifies both macOS architectures independently of Windows artifacts', async t => {
	const temporaryRoot = path.resolve(os.tmpdir());
	const directory = await fs.mkdtemp(path.join(temporaryRoot, 'glitch-release-test-'));
	t.after(async () => {
		assert.equal(path.dirname(directory), temporaryRoot);
		assert.ok(path.basename(directory).startsWith('glitch-release-test-'));
		await fs.rm(directory, { recursive: true, force: true });
	});
	const version = '2.0.0-alpha.2';
	const macosFiles = ['arm64', 'x64'].map(architecture => `Glitch-Studio-${version}-mac-${architecture}.dmg`);
	await fs.writeFile(path.join(directory, macosFiles[0]), 'Apple Silicon disk image');
	await assert.rejects(verifyReleaseArtifacts(directory, version, 'macos'), /mac-x64\.dmg/);
	await fs.writeFile(path.join(directory, macosFiles[1]), '');
	await assert.rejects(verifyReleaseArtifacts(directory, version, 'macos'), /Empty or invalid release artifact/);
	await fs.writeFile(path.join(directory, macosFiles[1]), 'Intel disk image');
	assert.deepEqual(await verifyReleaseArtifacts(directory, version, 'macos'), macosFiles);
	await assert.rejects(verifyReleaseArtifacts(directory, version, 'unsupported'), /Expected all, windows or macos/);
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
