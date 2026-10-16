import semver from 'semver';

export const UPDATE_REPOSITORY = 'syuilo/glitch-studio';

export function selectGitHubUpdate(releases, currentVersion) {
	const includePrereleases = semver.prerelease(currentVersion) != null;
	return releases.flatMap(release => {
		const version = typeof release.tag_name === 'string' ? release.tag_name.slice(1) : null;
		if (release.draft === true || version == null || release.tag_name !== `v${version}` || semver.valid(version) !== version) return [];
		if (!semver.gt(version, currentVersion) || (!includePrereleases && (release.prerelease === true || semver.prerelease(version) != null))) return [];
		return [{ version, url: `https://github.com/${UPDATE_REPOSITORY}/releases/download/v${version}/` }];
	}).sort((left, right) => semver.rcompare(left.version, right.version))[0] ?? null;
}

export async function findGitHubUpdate(currentVersion, request = fetch) {
	const releases = [];
	// GitHubProviderはalpha/beta以外の開発段階を別チャンネルとして扱い、公開日時順で候補を選ぶ。
	// Glitch Studioの「開発版はすべてのより新しいSemVerへ更新する」方針はここで解決し、
	// メタデータ取得・ハッシュ検証・差分ダウンロード・インストールはelectron-updaterへ委ねる。
	for (let page = 1; page <= 10; page++) {
		const response = await request(`https://api.github.com/repos/${UPDATE_REPOSITORY}/releases?per_page=100&page=${page}`, {
			headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Glitch-Studio' },
			signal: AbortSignal.timeout(15000),
		});
		if (!response.ok) throw new Error(`GitHub update check failed (${response.status}). Please try again later.`);
		const batch = await response.json();
		if (!Array.isArray(batch)) throw new Error('Invalid GitHub releases response');
		releases.push(...batch);
		if (!(response.headers.get('link') ?? '').includes('rel="next"')) return selectGitHubUpdate(releases, currentVersion);
	}
	throw new Error('Too many GitHub releases to check safely');
}
