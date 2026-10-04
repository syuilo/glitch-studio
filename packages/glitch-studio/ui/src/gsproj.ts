import { validateTimelineFps, validateTimelineMotionBlur } from '@gs/subsystems_timeline_shared/motion-blur.ts';
import { validateTimelineScenes } from '@gs/subsystems_timeline_shared/scenes.ts';
import * as msgpack from '@msgpack/msgpack';
import semverGt from 'semver/functions/gt.js';
import type { TimelineMotionBlurSettings } from '@gs/subsystems_timeline_shared/motion-blur.ts';
import type { Asset, Player } from '@gs/shared/types.js';
import type { ProjectVisualModule } from '@gs/glitch-studio_shared/project/types.ts';
import type { TimelineScene } from '@gs/subsystems_timeline_shared/types.ts';

export const DEFAULT_PROJECT_NAME = 'Untitled Project';

export type ProjectInfo = {
	name: string;
	description: string;
	author: string;
};

export type Project = ProjectInfo & {
	timelineFps: number;
	timelineMotionBlur: TimelineMotionBlurSettings;
	id: string;
	gsVersion: string;
	visualModules: ProjectVisualModule[];
	assets: Asset[];
	players: Player[];
	timelineScenes: TimelineScene[];
	resolution: { width: number; height: number; };
};

// BlobはMessagePackで直接保存できないため、フォントを含む素材の原本をバイト列にする。
type StoredProject = Omit<Project, 'assets'> & {
	assets: (Omit<Asset, 'fileData'> & { fileData: Uint8Array })[];
};

export async function encodeProjectFile(project: Project): Promise<Uint8Array> {
	const assets = await Promise.all(project.assets.map(async asset => {
		try {
			return { ...asset, fileData: new Uint8Array(await asset.fileData.arrayBuffer()) };
		} catch (cause) {
			throw new Error(`Could not read asset "${asset.name}". Replace it with the source file and try saving again.`, { cause });
		}
	}));
	return msgpack.encode({ ...project, assets } satisfies StoredProject);
}

export function decodeProjectFile(bin: Uint8Array, currentVersion?: string): Project {
	const project = msgpack.decode(bin) as StoredProject;
	// 未来の形式は素材の構造も変わり得るため、復元処理に入る前にバージョンを確認する。
	if (currentVersion != null && semverGt(project.gsVersion, currentVersion)) {
		throw new Error(`未来のバージョンのプロジェクトファイルの読み込みはサポートしていません。（ファイル: ${project.gsVersion} / 現在: ${currentVersion}）`);
	}
	validateTimelineScenes(project.timelineScenes);
	validateTimelineFps(project.timelineFps);
	validateTimelineMotionBlur(project.timelineMotionBlur);
	return {
		...project,
		assets: project.assets.map(asset => ({
			...asset,
			fileData: new Blob([new Uint8Array(asset.fileData)], { type: asset.fileDataType }),
		})),
	};
}

const projectFilePickerOptions = {
	id: 'glitch-studio-project',
	types: [{ description: 'Glitch Studio project', accept: { 'application/octet-stream': ['.gsproj'] } }],
	excludeAcceptAllOption: true,
};

export function getProjectFileName(name: string): string {
	const trimmed = name.trim();
	if (!trimmed || trimmed === '.' || trimmed === '..' || /[/\\]/.test(trimmed)) {
		throw new Error('Enter a file name without a folder path.');
	}
	return trimmed.toLowerCase().endsWith('.gsproj') ? trimmed : `${trimmed}.gsproj`;
}

export async function getProjectSaveFileHandle(
	directory: FileSystemDirectoryHandle,
	name: string,
	confirmOverwrite: (name: string) => Promise<boolean>,
): Promise<FileSystemFileHandle | null> {
	const fileName = getProjectFileName(name);
	let handle: FileSystemFileHandle;
	try {
		// showSaveFilePickerは選択した既存ファイルをその場で空にしてしまう。
		// フォルダから取得すれば内容を維持したまま上書き確認・書き込みを行える。
		handle = await directory.getFileHandle(fileName);
	} catch (error) {
		if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
		// 呼び出し元は先に保存データを準備する。素材の読込失敗で空ファイルを作らない。
		return directory.getFileHandle(fileName, { create: true });
	}
	return await confirmOverwrite(fileName) ? handle : null;
}

// エンコードと保存先選択は呼び出し元で済ませ、ここでは確定したバイト列だけを書き込む。
export async function saveProjectFile(data: Uint8Array, handle: FileSystemFileHandle): Promise<void> {
	// 有効なMessagePackプロジェクトは空にならない。空のデータで既存ファイルを確定させない。
	if (data.byteLength === 0) throw new Error('The project contains no save data.');
	const writable = await handle.createWritable();
	try {
		await writable.write(new Uint8Array(data));
		await writable.close();
	} catch (error) {
		// closeが成功するまでは元ファイルへ反映されない。失敗した書き込みを破棄する。
		await writable.abort().catch(() => {});
		throw error;
	}
}

export async function loadProjectFile(file?: File, handle?: FileSystemFileHandle): Promise<{ project: Project; name: string; handle?: FileSystemFileHandle } | null> {
	if (file != null) {
		return { project: decodeProjectFile(new Uint8Array(await file.arrayBuffer()), _VERSION_), name: file.name, handle };
	}
	if (typeof window.showOpenFilePicker === 'function') {
		let selectedHandle: FileSystemFileHandle | undefined;
		try {
			[selectedHandle] = await window.showOpenFilePicker({ ...projectFilePickerOptions, multiple: false });
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') return null;
			throw error;
		}
		if (selectedHandle == null) return null;
		return loadProjectFile(await selectedHandle.getFile(), selectedHandle);
	}
	return new Promise((resolve, reject) => {
		const input = window.document.createElement('input');
		input.type = 'file';
		input.accept = '.gsproj';
		input.addEventListener('cancel', () => resolve(null), { once: true });
		input.addEventListener('change', async () => {
			const file = input.files?.[0];
			if (file == null) { resolve(null); return; }
			try {
				const project = decodeProjectFile(new Uint8Array(await file.arrayBuffer()), _VERSION_);
				resolve({ project, name: file.name });
			} catch (error) {
				reject(error);
			}
		}, { once: true });
		input.click();
	});
}
