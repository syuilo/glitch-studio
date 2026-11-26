import { accessSync, constants, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';

export function findChromeExecutable() {
	const configuredPath = process.env.CHROME_PATH;
	if (configuredPath != null && configuredPath.trim().length > 0) return configuredPath;

	const installationPaths = [];
	if (process.platform === 'win32') {
		for (const directory of [process.env.ProgramW6432, process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA]) {
			if (directory != null && isAbsolute(directory)) installationPaths.push(join(directory, 'Google', 'Chrome', 'Application', 'chrome.exe'));
		}
	} else if (process.platform === 'darwin') {
		for (const directory of ['/Applications', join(homedir(), 'Applications')]) {
			installationPaths.push(join(directory, 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome'));
		}
	}

	const executableNames = process.platform === 'win32' ? ['chrome.exe'] : ['google-chrome', 'google-chrome-stable', 'chrome'];
	// 空のPATH項目や相対パスを除外し、作業ディレクトリの同名ファイルを自動起動しない。
	const pathCandidates = (process.env.PATH ?? '').split(delimiter).filter(isAbsolute)
		.flatMap(directory => executableNames.map(name => join(directory, name)));
	return [...installationPaths, ...pathCandidates].find(candidate => {
		try {
			accessSync(candidate, constants.X_OK);
			return statSync(candidate).isFile();
		} catch {
			return false;
		}
	}) ?? null;
}
