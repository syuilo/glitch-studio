import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import yaml from 'js-yaml';
import asar from '@electron/asar';
import { validateReleaseVersion, resolveReleaseVersion, formatReleaseDate, updateReleaseDownloadLinks, updateReleaseDownloadPage, verifyPreparedDownloadPage, verifyReleaseArtifacts, verifyPackagedApplication } from '../release.mjs';

const downloadPagePath = new URL('../../../../docs-site/guide/download.md', import.meta.url);

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

// 【ダウンロードページのマーカー内だけを、実際に配布する3種類のバイナリへのリンクに更新する】
// 実ページを読み込むことで、マーカーの編集やファイル名の変更がリリース時に破綻しないか検出する。
// frontmatter・説明・表の構造など、マーカー外の内容を自動更新が壊さないことも保証する。
test('updates the real download page for Windows and both macOS architectures without changing other content', async () => {
	const markdown = await fs.readFile(downloadPagePath, 'utf8');
	const updated = updateReleaseDownloadLinks(markdown, '2.0.0-alpha.42');
	const releaseUrl = 'https://github.com/syuilo/glitch-studio/releases/download/v2.0.0-alpha.42/';
	const downloadUrls = [...updated.matchAll(/<a href="([^"]+)">/g)].map(match => match[1]).filter(url => url.startsWith(releaseUrl));
	assert.deepEqual(downloadUrls, [
		`${releaseUrl}Glitch-Studio-2.0.0-alpha.42-x64-Setup.exe`,
		`${releaseUrl}Glitch-Studio-2.0.0-alpha.42-mac-arm64.dmg`,
		`${releaseUrl}Glitch-Studio-2.0.0-alpha.42-mac-x64.dmg`,
	]);
	assert.ok(updated.includes('Apple Silicon（arm64）'));
	assert.ok(updated.includes('Intel（x64）'));
	const windowsOpening = '<!--[DOWNLOAD_LINK_MARKER: windows]-->';
	const windowsClosing = '<!--[/DOWNLOAD_LINK_MARKER: windows]-->';
	const macosOpening = '<!--[DOWNLOAD_LINK_MARKER: macos]-->';
	const macosClosing = '<!--[/DOWNLOAD_LINK_MARKER: macos]-->';
	assert.equal(updated.slice(0, updated.indexOf(windowsOpening)), markdown.slice(0, markdown.indexOf(windowsOpening)));
	assert.equal(updated.slice(updated.indexOf(windowsClosing), updated.indexOf(macosOpening)), markdown.slice(markdown.indexOf(windowsClosing), markdown.indexOf(macosOpening)));
	assert.equal(updated.slice(updated.indexOf(macosClosing)), markdown.slice(markdown.indexOf(macosClosing)));
});

// 【更新処理はLF・CRLFを保ち、再実行や次のリリースでも同じ結果になる】
// Windowsランナーの改行変換や失敗後の再実行によって、無関係な差分や古いリンクを残さない。
test('preserves line endings and replaces all links consistently on repeated updates', async () => {
	const template = await fs.readFile(downloadPagePath, 'utf8');
	for (const newline of ['\n', '\r\n']) {
		const markdown = template.replace(/\r?\n/g, newline);
		const updated = updateReleaseDownloadLinks(markdown, '2.0.0-alpha.42');
		assert.equal(updateReleaseDownloadLinks(updated, '2.0.0-alpha.42'), updated);
		assert.equal(updateReleaseDownloadLinks(updated, '2.0.0'), updateReleaseDownloadLinks(markdown, '2.0.0'));
		if (newline === '\r\n') assert.equal(updated.replaceAll('\r\n', '').includes('\n'), false);
		else assert.equal(updated.includes('\r'), false);
	}
});

// 【欠落・重複・順序違い・入れ子のマーカーは、本文を書き換える前に拒否する】
// マーカーが壊れたまま処理を続けると、ページの本文を消したり一部OSのリンクが欠落したりする。
test('rejects malformed download sections and invalid release versions', async () => {
	const markdown = await fs.readFile(downloadPagePath, 'utf8');
	const windowsOpening = '<!--[DOWNLOAD_LINK_MARKER: windows]-->';
	const windowsClosing = '<!--[/DOWNLOAD_LINK_MARKER: windows]-->';
	const macosOpening = '<!--[DOWNLOAD_LINK_MARKER: macos]-->';
	const macosClosing = '<!--[/DOWNLOAD_LINK_MARKER: macos]-->';
	const invalidPages = [
		markdown.replace(windowsOpening, ''),
		markdown.replace(windowsClosing, ''),
		markdown.replace(macosOpening, ''),
		markdown.replace(macosClosing, ''),
		markdown + windowsOpening,
		markdown + macosClosing,
		`${windowsClosing}\n${windowsOpening}\n${macosOpening}\n${macosClosing}`,
		`${windowsOpening}\n${macosOpening}\n${macosClosing}\n${windowsClosing}`,
		`${macosOpening}\n${windowsOpening}\n${windowsClosing}\n${macosClosing}`,
		markdown.replace(windowsOpening, `text ${windowsOpening}`),
	];
	for (const invalidPage of invalidPages) {
		assert.throws(() => updateReleaseDownloadLinks(invalidPage, '2.0.0'), /download page markers/);
	}
	assert.throws(() => updateReleaseDownloadLinks(markdown, '2.0.0" onclick="invalid'), /canonical SemVer/);
});

// 【Workflowの開始日時を日本時間の暦日に変換する】
// UTCと日本時間の日付境界・年境界でも、最初のWorkflow開始日を正しく記録する。
test('formats workflow timestamps as Japanese calendar dates and rejects missing timestamps', () => {
	assert.equal(formatReleaseDate('2026-10-19T14:59:59Z'), '2026-10-19');
	assert.equal(formatReleaseDate('2026-10-19T15:00:00Z'), '2026-10-20');
	assert.equal(formatReleaseDate('2026-12-31T15:00:00Z'), '2027-01-01');
	assert.equal(formatReleaseDate('2026-10-20T00:30:00+09:00'), '2026-10-20');
	for (const releaseTimestamp of [null, '', 'invalid', 0]) {
		assert.throws(() => formatReleaseDate(releaseTimestamp), /release timestamp/);
	}
});

// 【バージョン・公開日・リンクを準備段階でまとめて更新する】
// v接頭辞は本文が所有する。日付を空欄にせず、1つのリリースコミットへすべての更新を含める。
test('updates version, release date and links together while preparing the release', async () => {
	const markdown = await fs.readFile(downloadPagePath, 'utf8');
	for (const newline of ['\n', '\r\n']) {
		const template = markdown.replace(/\r?\n/g, newline);
		const published = updateReleaseDownloadPage(template, '2.0.0-alpha.42', '2026-10-19T15:30:00Z');
		assert.ok(published.includes('現在のバージョン: v<!--[CURRENT_VERSION_MARKER]-->2.0.0-alpha.42<!--[/CURRENT_VERSION_MARKER]-->'));
		assert.ok(published.includes('公開日: <!--[CURRENT_VERSION_RELEASE_DATE_MARKER]-->2026-10-20<!--[/CURRENT_VERSION_RELEASE_DATE_MARKER]-->'));
		assert.ok(published.includes('/v2.0.0-alpha.42/Glitch-Studio-2.0.0-alpha.42-x64-Setup.exe'));
		assert.equal(updateReleaseDownloadPage(published, '2.0.0-alpha.42', '2026-10-19T15:30:00Z'), published);
		const preparing = updateReleaseDownloadPage(published, '2.0.0-alpha.43', '2026-10-20T15:30:00Z');
		assert.ok(preparing.includes('<!--[CURRENT_VERSION_MARKER]-->2.0.0-alpha.43<!--[/CURRENT_VERSION_MARKER]-->'));
		assert.ok(preparing.includes('<!--[CURRENT_VERSION_RELEASE_DATE_MARKER]-->2026-10-21<!--[/CURRENT_VERSION_RELEASE_DATE_MARKER]-->'));
		assert.throws(() => updateReleaseDownloadPage(template, '2.0.0-alpha.43'), /release timestamp/);
		if (newline === '\r\n') assert.equal(published.replaceAll('\r\n', '').includes('\n'), false);
		else assert.equal(published.includes('\r'), false);
	}
});

// 【既存の未公開タグを再利用するときは、コミット済みの日付を変えない】
// 新しい実行を別の日に開始しても、既存タグの書き換えや公開後の追加コミットを必要としない。
// 日付やバージョンが壊れている既存ページは、そのままリリースせず検出する。
test('verifies prepared pages using their committed dates and rejects invalid dates or versions', async () => {
	const markdown = await fs.readFile(downloadPagePath, 'utf8');
	const prepared = updateReleaseDownloadPage(markdown, '2.0.0-alpha.42', '2026-10-19T15:30:00Z');
	assert.equal(verifyPreparedDownloadPage(prepared, '2.0.0-alpha.42'), '2026-10-20');
	assert.throws(() => verifyPreparedDownloadPage(prepared, '2.0.0-alpha.43'), /different download page/);
	for (const releaseDate of ['', '2026-2-1', '2026-02-30', 'invalid']) {
		const invalid = prepared.replace('2026-10-20', releaseDate);
		assert.throws(() => verifyPreparedDownloadPage(invalid, '2.0.0-alpha.42'), /invalid release date/);
	}
});

// 【バージョン・公開日のマーカーも欠落や重複を許可しない】
// 一部の表示だけが前リリースのまま残った状態でPagesへ公開することを防ぐ。
test('rejects missing, duplicate and nested version or publication date markers', async () => {
	const markdown = await fs.readFile(downloadPagePath, 'utf8');
	for (const marker of ['CURRENT_VERSION_MARKER', 'CURRENT_VERSION_RELEASE_DATE_MARKER']) {
		const opening = `<!--[${marker}]-->`;
		const closing = `<!--[/${marker}]-->`;
		for (const invalidPage of [markdown.replace(opening, ''), markdown.replace(closing, ''), markdown + opening, markdown + closing]) {
			assert.throws(() => updateReleaseDownloadPage(invalidPage, '2.0.0', '2026-10-19T00:00:00Z'), /download page markers/);
		}
	}
	const nested = markdown.replace('<!--[/CURRENT_VERSION_MARKER]-->', '').replace('<!--[CURRENT_VERSION_RELEASE_DATE_MARKER]-->', '<!--[CURRENT_VERSION_RELEASE_DATE_MARKER]--><!--[/CURRENT_VERSION_MARKER]-->');
	assert.throws(() => updateReleaseDownloadPage(nested, '2.0.0', '2026-10-19T00:00:00Z'), /download page markers/);
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

// 【配布対象の実ソースをASARに詰め、起動時の相対importをすべて解決できることを確認する】
// main.mjsに実装を追加しても配布対象への追加を忘れると、開発環境だけ起動できて配布版が起動不能になる。
// 実際のelectron-builder設定とソースを使い、別の手書きファイル一覧との比較では見逃す追加漏れを検出する。
test('packages every local module required by the actual application and preload', async t => {
	const temporaryRoot = path.resolve(os.tmpdir());
	const directory = await fs.mkdtemp(path.join(temporaryRoot, 'glitch-runtime-package-test-'));
	t.after(async () => {
		assert.equal(path.dirname(directory), temporaryRoot);
		assert.ok(path.basename(directory).startsWith('glitch-runtime-package-test-'));
		await fs.rm(directory, { recursive: true, force: true });
	});
	const desktopDirectory = fileURLToPath(new URL('../', import.meta.url));
	const configuration = createRequire(import.meta.url)('../electron-builder.config.cjs');
	const manifest = JSON.parse(await fs.readFile(path.join(desktopDirectory, 'package.json'), 'utf8'));
	const source = path.join(directory, 'app');
	await fs.mkdir(source);
	// npmの依存収集は既存のテストで検証し、ここではアプリ自身のファイル選択を検証する。
	await fs.writeFile(path.join(source, 'package.json'), JSON.stringify({ main: manifest.main }));
	for (const file of configuration.files) await fs.copyFile(path.join(desktopDirectory, file), path.join(source, file));
	const archive = path.join(directory, 'app.asar');
	await asar.createPackage(source, archive);
	assert.doesNotThrow(() => verifyPackagedApplication(archive, configuration.files));
});

// 【ASAR内のエントリ・推移的なimport・動的import・preloadのrequireの欠落を検出する】
// 必須ファイル一覧だけでは、まだ一覧に追加されていない新しいモジュールの梱包漏れを防げない。
// コードを実行せず依存先をたどり、循環importがあっても検証を終えられる必要がある。
test('rejects missing application modules recursively without executing packaged code', async t => {
	const temporaryRoot = path.resolve(os.tmpdir());
	const directory = await fs.mkdtemp(path.join(temporaryRoot, 'glitch-local-module-test-'));
	t.after(async () => {
		assert.equal(path.dirname(directory), temporaryRoot);
		assert.ok(path.basename(directory).startsWith('glitch-local-module-test-'));
		await fs.rm(directory, { recursive: true, force: true });
	});
	const source = path.join(directory, 'app');
	const archive = path.join(directory, 'app.asar');
	await fs.mkdir(source);
	await fs.writeFile(path.join(source, 'package.json'), JSON.stringify({ main: 'main.mjs' }));
	async function pack() { await asar.createPackage(source, archive); asar.uncache(archive); }
	await pack();
	assert.throws(() => verifyPackagedApplication(archive), /Missing packaged application file: main\.mjs/);
	await fs.writeFile(path.join(source, 'main.mjs'), "import './edit-command-ipc.mjs'; throw new Error('Must not execute');");
	await pack();
	assert.throws(() => verifyPackagedApplication(archive), /edit-command-ipc\.mjs \(required by main\.mjs\)/);
	await fs.writeFile(path.join(source, 'edit-command-ipc.mjs'), "export * from './helper.mjs';");
	await pack();
	assert.throws(() => verifyPackagedApplication(archive), /helper\.mjs \(required by edit-command-ipc\.mjs\)/);
	await fs.writeFile(path.join(source, 'helper.mjs'), "import './main.mjs'; import('./late.mjs');");
	await pack();
	assert.throws(() => verifyPackagedApplication(archive), /late\.mjs \(required by helper\.mjs\)/);
	await fs.writeFile(path.join(source, 'late.mjs'), 'export const value = 1;');
	await pack();
	assert.throws(() => verifyPackagedApplication(archive, ['preload.cjs']), /preload\.cjs/);
	await fs.writeFile(path.join(source, 'preload.cjs'), "require('./preload-helper.cjs');");
	await pack();
	assert.throws(() => verifyPackagedApplication(archive, ['preload.cjs']), /preload-helper\.cjs \(required by preload\.cjs\)/);
	await fs.writeFile(path.join(source, 'preload-helper.cjs'), 'module.exports = {};');
	await pack();
	assert.doesNotThrow(() => verifyPackagedApplication(archive, ['preload.cjs']));
});
