import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import semver from 'semver';
import yaml from 'js-yaml';
import asar from '@electron/asar';
import { UPDATE_REPOSITORY } from './github-updates.mjs';

const executeFile = promisify(execFile);
const rootDirectory = path.resolve(import.meta.dirname, '../../..');

async function command(executable, args) {
	const { stdout } = await executeFile(executable, args, { cwd: rootDirectory, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
	return stdout.trim();
}
async function exists(executable, args) {
	try { return await command(executable, args); }
	catch (error) { if (error.code === 1 || error.code === 128) return null; throw error; }
}

export function validateReleaseVersion(version) {
	// +buildはSemVerの大小関係に含まれず、同じ更新バージョンの別配布物になってしまう。
	if (typeof version !== 'string' || semver.valid(version) !== version || version.includes('+')) {
		throw new Error('Specify a canonical SemVer without a v prefix or build metadata (for example 2.0.0-alpha.2).');
	}
	return version;
}

export function resolveReleaseVersion(currentVersion, mode, explicitVersion = null) {
	validateReleaseVersion(currentVersion);
	if (mode === 'explicit') {
		const version = validateReleaseVersion(explicitVersion);
		if (semver.lt(version, currentVersion)) throw new Error('The release must not be older than the version in master.');
		return version;
	}
	if (!['prerelease', 'patch', 'minor', 'major'].includes(mode)) {
		throw new Error('Select explicit, prerelease, patch, minor or major as the version mode.');
	}
	if (explicitVersion != null && explicitVersion !== '') throw new Error('Leave version empty when incrementing the current version.');
	// 正式版から開発版を作る場合は、alpha/betaなどの識別子を明示指定してもらう。
	// 自動では既存の開発段階だけを引き継ぎ、意図せず「次のpatch-0」を公開しない。
	if (mode === 'prerelease' && semver.prerelease(currentVersion) == null) {
		throw new Error('prerelease mode requires a current development version. Specify the first development version explicitly.');
	}
	const version = semver.inc(currentVersion, mode);
	if (version == null) throw new Error('Could not increment the current version.');
	return validateReleaseVersion(version);
}

function getDownloadPageSection(markdown, marker) {
	const openingMarker = `<!--[${marker}]-->`;
	const closingMarker = `<!--[/${marker}]-->`;
	// マーカーが壊れたときに本文を巻き込んだり、一部の項目だけ古い値を残したりしない。
	if (markdown.split(openingMarker).length !== 2 || markdown.split(closingMarker).length !== 2) {
		throw new Error(`Expected exactly one pair of download page markers for ${marker}.`);
	}
	const openingIndex = markdown.indexOf(openingMarker);
	const contentIndex = openingIndex + openingMarker.length;
	const closingIndex = markdown.indexOf(closingMarker);
	const content = markdown.slice(contentIndex, closingIndex);
	if (closingIndex < contentIndex || content.includes('<!--[')) {
		throw new Error(`Invalid download page markers for ${marker}.`);
	}
	return { openingIndex, contentIndex, closingIndex, content };
}

function replaceDownloadPageSection(markdown, marker, content) {
	const { openingIndex, contentIndex, closingIndex } = getDownloadPageSection(markdown, marker);
	if (Array.isArray(content)) {
		const newline = markdown.includes('\r\n') ? '\r\n' : '\n';
		const indentation = markdown.slice(markdown.lastIndexOf('\n', openingIndex) + 1, openingIndex);
		if (!/^[\t ]*$/.test(indentation)) throw new Error(`Invalid download page markers for ${marker}.`);
		content = `${newline}${indentation}${content.join(`<br>${newline}${indentation}`)}${newline}${indentation}`;
	}
	return `${markdown.slice(0, contentIndex)}${content}${markdown.slice(closingIndex)}`;
}

export function formatReleaseDate(releaseTimestamp) {
	const date = typeof releaseTimestamp === 'string' ? new Date(releaseTimestamp) : null;
	if (date == null || Number.isNaN(date.getTime())) throw new Error('Missing or invalid release timestamp.');
	const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
		timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
	}).formatToParts(date).map(part => [part.type, part.value]));
	return `${parts.year}-${parts.month}-${parts.day}`;
}

export function updateReleaseDownloadLinks(markdown, version) {
	validateReleaseVersion(version);
	const releaseUrl = `https://github.com/${UPDATE_REPOSITORY}/releases/download/v${version}/`;
	const downloads = {
		windows: [`<a href="${releaseUrl}Glitch-Studio-${version}-x64-Setup.exe">ダウンロード</a>`],
		macos: [
			`<a href="${releaseUrl}Glitch-Studio-${version}-mac-arm64.dmg">Apple Silicon（arm64）</a>`,
			`<a href="${releaseUrl}Glitch-Studio-${version}-mac-x64.dmg">Intel（x64）</a>`,
		],
	};
	for (const [platform, links] of Object.entries(downloads)) {
		markdown = replaceDownloadPageSection(markdown, `DOWNLOAD_LINK_MARKER: ${platform}`, links);
	}
	return markdown;
}

export function updateReleaseDownloadPage(markdown, version, releaseTimestamp) {
	const releaseDate = formatReleaseDate(releaseTimestamp);
	markdown = updateReleaseDownloadLinks(markdown, version);
	markdown = replaceDownloadPageSection(markdown, 'CURRENT_VERSION_MARKER', version);
	return replaceDownloadPageSection(markdown, 'CURRENT_VERSION_RELEASE_DATE_MARKER', releaseDate);
}

export function verifyPreparedDownloadPage(markdown, version) {
	const releaseDate = getDownloadPageSection(markdown, 'CURRENT_VERSION_RELEASE_DATE_MARKER').content;
	const releaseTimestamp = `${releaseDate}T00:00:00+09:00`;
	if (!/^\d{4}-\d{2}-\d{2}$/.test(releaseDate) || formatReleaseDate(releaseTimestamp) !== releaseDate) {
		throw new Error('The prepared download page has an invalid release date.');
	}
	// 未公開タグを再利用する場合は、最初のコミットに記録した日付を維持する。
	if (updateReleaseDownloadPage(markdown, version, releaseTimestamp) !== markdown) {
		throw new Error('The existing release tag has a different download page. Use a new version.');
	}
	return releaseDate;
}

export async function verifyReleaseArtifacts(directory, version, platform = 'all') {
	validateReleaseVersion(version);
	if (!['all', 'windows', 'macos'].includes(platform)) throw new Error('Expected all, windows or macos artifacts');
	const files = [];
	if (platform !== 'macos') {
		const installerName = `Glitch-Studio-${version}-x64-Setup.exe`;
		files.push(installerName, `${installerName}.blockmap`, 'latest.yml');
		const metadata = yaml.load(await fs.readFile(path.join(directory, 'latest.yml'), 'utf8'));
		if (metadata?.version !== version || metadata.files?.length !== 1) throw new Error('Unexpected update metadata version or files');
		const installer = await fs.readFile(path.join(directory, installerName));
		const digest = createHash('sha512').update(installer).digest('base64');
		if (metadata.files[0].url !== installerName || metadata.files[0].sha512 !== digest || metadata.path !== installerName || metadata.sha512 !== digest) {
			throw new Error('The installer does not match its update metadata');
		}
	}
	if (platform !== 'windows') {
		files.push(...['arm64', 'x64'].map(architecture => `Glitch-Studio-${version}-mac-${architecture}.dmg`));
	}
	for (const name of files) {
		const artifact = await fs.stat(path.join(directory, name));
		if (!artifact.isFile() || artifact.size === 0) throw new Error(`Empty or invalid release artifact: ${name}`);
	}
	return files;
}

export function verifyPackagedApplication(archive) {
	const files = new Set(asar.listPackage(archive).map(file => file.replaceAll('\\', '/').replace(/^\//, '')));
	const metadata = file => JSON.parse(asar.extractFile(archive, path.normalize(file)).toString());
	const checked = new Set();
	const checkDependencies = packageFile => {
		if (checked.has(packageFile)) return;
		checked.add(packageFile);
		const manifest = metadata(packageFile);
		for (const name of Object.keys(manifest.dependencies ?? {})) {
			let directory = path.posix.dirname(packageFile);
			let dependencyFile = null;
			while (true) {
				const candidate = path.posix.join(directory, 'node_modules', name, 'package.json');
				if (files.has(candidate)) { dependencyFile = candidate; break; }
				if (directory === '.') break;
				directory = path.posix.dirname(directory);
			}
			if (dependencyFile == null) throw new Error(`Missing packaged runtime dependency: ${name} (required by ${packageFile})`);
			checkDependencies(dependencyFile);
		}
	};
	checkDependencies('package.json');
}

async function getRelease(tag) {
	const value = await exists('gh', ['release', 'view', tag, '--json', 'isDraft,tagName']);
	return value == null ? null : JSON.parse(value);
}

async function prepareRelease() {
	if (process.env.GITHUB_REF !== 'refs/heads/master') throw new Error('Run this workflow on master.');
	const sourceSha = process.env.GITHUB_SHA;
	if (!/^[a-f0-9]{40}$/.test(sourceSha ?? '')) throw new Error('Missing source commit');
	const filePath = path.join(rootDirectory, 'package.json');
	// dispatch時のコミットから毎回計算する。タグ作成後の再実行でも二重に増分しない。
	const source = await command('git', ['show', `${sourceSha}:package.json`]);
	const metadata = JSON.parse(source);
	const version = resolveReleaseVersion(metadata.version, process.env.RELEASE_VERSION_MODE ?? 'explicit', process.env.RELEASE_VERSION);
	console.log(`Release version: ${metadata.version} -> ${version}`);
	const tag = `v${version}`;
	const release = await getRelease(tag);
	if (release != null && !release.isDraft) throw new Error('This version has already been published. Use a new version.');
	const existingSha = await exists('git', ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`]);
	if (existingSha != null) {
		// 公開前の再実行だけを許可する。別のソースを同名タグへ付け替えない。
		const parentSha = await command('git', ['rev-parse', `${existingSha}^`]);
		if (existingSha !== sourceSha && parentSha !== sourceSha) throw new Error('The existing release tag belongs to a different source commit.');
		await command('git', ['checkout', '--detach', existingSha]);
		const committed = JSON.parse(await fs.readFile(path.join(rootDirectory, 'package.json'), 'utf8'));
		if (committed.version !== version) throw new Error('The existing release tag has a different version.');
		const downloadPage = await fs.readFile(path.join(rootDirectory, 'docs-site/guide/download.md'), 'utf8');
		console.log(`Release date: ${verifyPreparedDownloadPage(downloadPage, version)}`);
	} else {
		const runId = process.env.GITHUB_RUN_ID;
		if (!/^\d+$/.test(runId ?? '')) throw new Error('Missing workflow run ID.');
		// createdAtは再実行でも変わらない。日をまたいだ再実行で別の日付にしない。
		const releaseTimestamp = await command('gh', ['run', 'view', runId, '--json', 'createdAt', '--jq', '.createdAt']);
		const downloadPagePath = path.join(rootDirectory, 'docs-site/guide/download.md');
		const downloadPage = await fs.readFile(downloadPagePath, 'utf8');
		const updatedDownloadPage = updateReleaseDownloadPage(downloadPage, version, releaseTimestamp);
		console.log(`Release date: ${formatReleaseDate(releaseTimestamp)}`);
		metadata.version = version;
		await fs.writeFile(filePath, `${JSON.stringify(metadata, null, '\t')}\n`);
		// リンクも同じコミットに含め、失敗したビルドのためにmasterだけを先に更新しない。
		await fs.writeFile(downloadPagePath, updatedDownloadPage);
		await command('git', ['config', 'user.name', 'github-actions[bot]']);
		await command('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
		await command('git', ['add', 'package.json', 'docs-site/guide/download.md']);
		await command('git', ['commit', '--allow-empty', '-m', `chore: release ${version}`]);
	}
	const releaseSha = await command('git', ['rev-parse', 'HEAD']);
	await fs.appendFile(process.env.GITHUB_OUTPUT, `version=${version}\ntag=${tag}\nsource_sha=${sourceSha}\nrelease_sha=${releaseSha}\n`);
}

async function publishRelease() {
	const version = validateReleaseVersion(process.env.RELEASE_VERSION);
	const tag = `v${version}`;
	const sourceSha = process.env.RELEASE_SOURCE_SHA;
	const releaseSha = process.env.RELEASE_COMMIT_SHA;
	if (await command('git', ['rev-parse', 'HEAD']) !== releaseSha) throw new Error('The checkout does not match the built release commit.');
	const directory = path.join(rootDirectory, 'release');
	const files = await verifyReleaseArtifacts(directory, version);
	const release = await getRelease(tag);
	if (release != null && !release.isDraft) throw new Error('This release has already been published.');
	const remoteTag = await command('git', ['ls-remote', 'origin', `refs/tags/${tag}`]);
	if (remoteTag === '') {
		await command('git', ['fetch', 'origin', 'master']);
		if (await command('git', ['rev-parse', 'FETCH_HEAD']) !== sourceSha) throw new Error('master changed during the build. Run the workflow again.');
		await command('git', ['tag', tag, releaseSha]);
		// masterだけ進んだりタグだけ作られたりしないよう、同時に公開する。force pushは使わない。
		await command('git', ['push', '--atomic', 'origin', `${releaseSha}:refs/heads/master`, `refs/tags/${tag}`]);
	} else if (remoteTag.split(/\s/)[0] !== releaseSha) {
		throw new Error('The remote tag does not match the built commit.');
	}
	const prerelease = semver.prerelease(version) != null;
	if (release == null) {
		await command('gh', ['release', 'create', tag, '--verify-tag', '--draft', '--title', `Glitch Studio ${version}`, '--generate-notes', ...(prerelease ? ['--prerelease'] : [])]);
	}
	await command('gh', ['release', 'upload', tag, ...files.map(name => path.join(directory, name)), '--clobber']);
	const uploadedDirectory = await fs.mkdtemp(path.join(directory, 'uploaded-'));
	try {
		await command('gh', ['release', 'download', tag, '--dir', uploadedDirectory, ...files.flatMap(name => ['--pattern', name])]);
		await verifyReleaseArtifacts(uploadedDirectory, version);
		for (const name of files) {
			if (!(await fs.readFile(path.join(directory, name))).equals(await fs.readFile(path.join(uploadedDirectory, name)))) {
				throw new Error(`The uploaded artifact differs from the build: ${name}`);
			}
		}
	} finally {
		// mkdtempがrelease配下に作った一時ディレクトリだけを削除する。
		if (path.dirname(uploadedDirectory) !== directory || !path.basename(uploadedDirectory).startsWith('uploaded-')) throw new Error('Unexpected upload verification directory');
		await fs.rm(uploadedDirectory, { recursive: true, force: true });
	}
	await command('gh', ['release', 'edit', tag, '--draft=false', `--prerelease=${prerelease}`, `--latest=${!prerelease}`]);
}

if (process.argv[1] != null && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const actions = {
		prepare: prepareRelease,
		publish: publishRelease,
		verify: () => verifyReleaseArtifacts(path.join(rootDirectory, 'release'), process.env.RELEASE_VERSION, process.argv[3] ?? 'all'),
	};
	const action = actions[process.argv[2]];
	if (action == null) throw new Error('Expected prepare, verify or publish');
	await action();
}
