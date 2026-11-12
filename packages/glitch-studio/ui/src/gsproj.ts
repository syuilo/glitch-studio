import { getReferencedGeneratedSpeech } from '@gs/glitch-studio_shared/voicevox.ts';
import * as msgpack from '@msgpack/msgpack';
import semverGt from 'semver/functions/gt.js';
import { readFileSource } from '@gs/shared/file-source.ts';
import { migrateProjectFile } from './project-file-migration.ts';
import { writeFileSystemFile } from './utility/write-file-system-file.ts';
import type { AutomationGraph } from '@gs/shared/automation-graph/automation-graph.ts';
import type { GeneratedSpeech } from '@gs/glitch-studio_shared/voicevox.ts';
import type { TimelineMotionBlurSettings } from '@gs/subsystems_timeline_shared/motion-blur.ts';
import type { Player } from '@gs/shared/types.js';
import type { ProjectCustomShaderEffect, ProjectVisualModule } from '@gs/glitch-studio_shared/project/types.ts';
import type { ProjectAsset } from './Project.ts';
import type { AssetThumbnailSequence } from './asset-thumbnail.ts';
import type { TimelineScene } from '@gs/subsystems_timeline_shared/types.ts';
import type { ExportDialogSettings } from './export/export-settings.ts';

export const DEFAULT_PROJECT_NAME = 'Untitled Project';

// OSのファイル参照とブラウザのハンドルを区別し、ブラウザ側に実パスを要求しない。
export type DesktopProjectFile = {
	kind: 'desktop-project-file';
	id: string;
	name: string;
};
export type ProjectFileHandle = FileSystemFileHandle | DesktopProjectFile;

/** プロジェクトIDではなく保存先を比較する。Save as前のコピーも別ファイルとして開ける。 */
export async function isSameProjectFile(first: ProjectFileHandle | null, second: ProjectFileHandle): Promise<boolean> {
	if (first == null) return false;
	if (first === second) return true;
	if (first.kind === 'desktop-project-file' || second.kind === 'desktop-project-file') {
		return first.kind === 'desktop-project-file' && second.kind === 'desktop-project-file' && first.id === second.id;
	}
	return first.isSameEntry(second);
}

export function desktopProjectFile(descriptor: { id: string; name: string }): DesktopProjectFile {
	return {
		...descriptor,
		kind: 'desktop-project-file',
	};
}

export type ProjectInfo = {
	name: string;
	description: string;
	author: string;
};

export type Project = ProjectInfo & {
	customShaderEffects: ProjectCustomShaderEffect[];
	automationGraphs: AutomationGraph[];
	exportSettings: ExportDialogSettings | null;
	timelineFps: number;
	timelineMotionBlur: TimelineMotionBlurSettings;
	gsVersion: string;
	visualModules: ProjectVisualModule[];
	assets: ProjectAsset[];
	generatedSpeech: GeneratedSpeech[];
	players: Player[];
	timelineScenes: TimelineScene[];
	resolution: { width: number; height: number; };
};

// BlobはMessagePackで直接保存できないため、フォントを含む素材の原本をバイト列にする。
type StoredThumbnailSequence = Omit<AssetThumbnailSequence, 'frames'> & {
	frames: { timestampSeconds: number; fileData: Uint8Array; fileDataType: string }[];
};

type StoredProject = Omit<Project, 'assets' | 'generatedSpeech'> & {
	generatedSpeech: (Omit<GeneratedSpeech, 'fileData'> & { fileData: Uint8Array })[];
	assets: (Omit<ProjectAsset, 'fileData' | 'thumbnailSequence'> & { fileData: Uint8Array | null; thumbnailSequence: StoredThumbnailSequence | null })[];
};

export async function encodeProjectFile(project: Project, handle: ProjectFileHandle | null = null): Promise<Uint8Array> {
	project = await mapProjectAssetPaths(project, handle, true);
	const assets = await Promise.all(project.assets.map(async asset => {
		try {
			const sequence = asset.thumbnailSequence;
			return {
				...asset,
				fileData: asset.isExternalReference === true ? null : new Uint8Array(await (await readFileSource(asset.fileData)).arrayBuffer()),
				thumbnailSequence: sequence == null ? null : {
					...sequence,
					frames: await Promise.all(sequence.frames.map(async frame => ({
						timestampSeconds: frame.timestampSeconds,
						fileDataType: frame.fileData.type,
						fileData: new Uint8Array(await frame.fileData.arrayBuffer()),
					}))),
				},
			};
		} catch (cause) {
			throw new Error(`Could not read asset "${asset.name}". Replace it with the source file and try saving again.`, { cause });
		}
	}));
	const generatedSpeech = await Promise.all(getReferencedGeneratedSpeech(project.timelineScenes, project.generatedSpeech)
		.map(async speech => ({ ...speech, fileData: new Uint8Array(await speech.fileData.arrayBuffer()) })));
	return msgpack.encode({ ...project, assets, generatedSpeech } satisfies StoredProject);
}

export function decodeProjectFile(bin: Uint8Array, currentVersion?: string): Project {
	const project = msgpack.decode(bin) as StoredProject;
	// 未来の形式は素材の構造も変わり得るため、復元処理に入る前にバージョンを確認する。
	if (currentVersion != null && semverGt(project.gsVersion, currentVersion)) {
		throw new Error(`未来のバージョンのプロジェクトファイルの読み込みはサポートしていません。（ファイル: ${project.gsVersion} / 現在: ${currentVersion}）`);
	}
	migrateProjectFile(project);
	return {
		...project,
		generatedSpeech: project.generatedSpeech.map(speech => ({ ...speech, fileData: new Blob([new Uint8Array(speech.fileData)], { type: 'audio/wav' }) })),
		assets: project.assets.map(asset => ({
			...asset,
			fileData: asset.isExternalReference === true
				? { url: null, size: 0, error: 'External reference is not resolved.' }
				: new Blob([new Uint8Array(asset.fileData!)], { type: asset.fileDataType }),
			thumbnailSequence: asset.thumbnailSequence == null ? null : {
				width: asset.thumbnailSequence.width,
				height: asset.thumbnailSequence.height,
				frames: asset.thumbnailSequence.frames.map(frame => ({
					timestampSeconds: frame.timestampSeconds,
					fileData: new Blob([new Uint8Array(frame.fileData)], { type: frame.fileDataType }),
				})),
			},
		})),
	};
}

/** 実行中とUndo履歴は絶対パスのままにし、保存先ごとに独立したコピーだけを相対化する。 */
export async function mapProjectAssetPaths(project: Project, handle: ProjectFileHandle | null, storing: boolean): Promise<Project> {
	if (typeof window === 'undefined' || window.desktop?.assetProjectPaths == null || handle?.kind !== 'desktop-project-file') return project;
	const paths = await window.desktop.assetProjectPaths(project.assets.map(asset => asset.sourceFilePath), handle.id, storing);
	return { ...project, assets: project.assets.map((asset, index) => ({ ...asset, sourceFilePath: paths[index] })) };
}

const projectFilePickerOptions = {
	// 保存先のフォルダ選択とは別のIDにし、プロジェクトを開く場所だけを記憶する。
	id: 'glitch-studio-open-project',
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
export async function saveProjectFile(data: Uint8Array, handle: ProjectFileHandle, sessionId: string): Promise<void> {
	// 有効なMessagePackプロジェクトは空にならない。空のデータで既存ファイルを確定させない。
	if (data.byteLength === 0) throw new Error('The project contains no save data.');
	if (handle.kind === 'desktop-project-file') {
		await window.desktop!.writeProjectFile(handle.id, data, sessionId);
		return;
	}
	await writeFileSystemFile(handle, data);
}

export type SelectedProjectFile = {
	name: string;
	handle: ProjectFileHandle | null;
	loadProject: () => Promise<Project>;
};

function createProjectFileSelection(name: string, handle: ProjectFileHandle | null, readBytes: () => Promise<Uint8Array>): SelectedProjectFile {
	return {
		name,
		handle,
		async loadProject() {
			return mapProjectAssetPaths(decodeProjectFile(await readBytes(), _VERSION_), handle, false);
		},
	};
}

/** 保存先の同一性を先に照合できるよう、選択時にはファイルの内容を読み込まない。 */
export async function selectProjectFile({ file = null, handle = null, reservationId }: {
	file?: File | null;
	handle?: ProjectFileHandle | null;
	reservationId: string;
}): Promise<SelectedProjectFile | null> {
	if (file == null && handle != null) {
		const selectedHandle = handle;
		return createProjectFileSelection(selectedHandle.name, selectedHandle, async () => {
			if (selectedHandle.kind === 'file') return new Uint8Array(await (await selectedHandle.getFile()).arrayBuffer());
			// ElectronではIPCのバイト列をそのまま使い、大きなプロジェクトをFile経由で複製しない。
			const data = await window.desktop!.readProjectFile(selectedHandle.id);
			if (data == null) throw new Error(`Project file not found: ${selectedHandle.name}`);
			return data;
		});
	}
	if (file != null) {
		if (window.desktop?.registerProjectFile != null && handle?.kind !== 'desktop-project-file') {
			const descriptor = await window.desktop.registerProjectFile(file, reservationId);
			if (descriptor == null) return null;
			handle = desktopProjectFile(descriptor);
		}
		const selectedFile = file;
		return createProjectFileSelection(selectedFile.name, handle, async () => new Uint8Array(await selectedFile.arrayBuffer()));
	}
	if (window.desktop?.chooseProjectFile != null) {
		const descriptor = await window.desktop.chooseProjectFile(reservationId);
		if (descriptor == null) return null;
		return selectProjectFile({ handle: desktopProjectFile(descriptor), reservationId });
	}
	if (typeof window.showOpenFilePicker === 'function') {
		let selectedHandle: FileSystemFileHandle | null = null;
		try {
			[selectedHandle] = await window.showOpenFilePicker({ ...projectFilePickerOptions, multiple: false });
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') return null;
			throw error;
		}
		if (selectedHandle == null) return null;
		return selectProjectFile({ handle: selectedHandle, reservationId });
	}
	return new Promise(resolve => {
		const input = window.document.createElement('input');
		input.type = 'file';
		input.accept = '.gsproj';
		input.addEventListener('cancel', () => resolve(null), { once: true });
		input.addEventListener('change', () => {
			const file = input.files?.[0];
			if (file == null) { resolve(null); return; }
			resolve(createProjectFileSelection(file.name, null, async () => new Uint8Array(await file.arrayBuffer())));
		}, { once: true });
		input.click();
	});
}
