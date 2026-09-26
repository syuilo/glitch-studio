import * as msgpack from '@msgpack/msgpack';
import type { Asset, Player } from '@glitch/shared/types.js';
import type { VisualModule } from '@glitch/shared/visual-module/types.ts';
import type { Timeline } from '@glitch/shared/timeline/types.ts';

export const DEFAULT_PROJECT_NAME = 'Untitled Project';

export type ProjectInfo = {
	name: string;
	description: string;
	author: string;
};

export type Project = ProjectInfo & {
	id: string;
	gsVersion: string;
	visualModules: VisualModule[];
	assets: Asset[];
	players: Player[];
	timeline: Timeline;
	resolution: { width: number; height: number; };
};

// BlobはMessagePackで直接保存できないため、フォントを含む素材の原本をバイト列にする。
type StoredProject = Omit<Project, 'assets'> & {
	assets: (Omit<Asset, 'fileData'> & { fileData: Uint8Array })[];
};

export async function encodeProjectFile(project: Project): Promise<Uint8Array> {
	const assets = await Promise.all(project.assets.map(async asset => ({
		...asset,
		fileData: new Uint8Array(await asset.fileData.arrayBuffer()),
	})));
	return msgpack.encode({ ...project, assets } satisfies StoredProject);
}

export function decodeProjectFile(bin: Uint8Array): Project {
	const project = msgpack.decode(bin) as StoredProject;
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

export async function saveProjectFile(project: Project, name: string, handle: FileSystemFileHandle | null = null): Promise<FileSystemFileHandle | null> {
	// ユーザー操作の権限が失効しないよう、素材のエンコードより前に保存先・書込権限を得る。
	if (handle == null) {
		try {
			handle = await window.showSaveFilePicker({
				...projectFilePickerOptions,
				suggestedName: name.toLowerCase().endsWith('.gsproj') ? name : `${name}.gsproj`,
			});
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') return null;
			throw error;
		}
	} else if (await handle.requestPermission({ mode: 'readwrite' }) !== 'granted') {
		throw new Error('Write permission was not granted. Use Save as... to choose another file.');
	}

	const data = await encodeProjectFile(project);
	const writable = await handle.createWritable();
	try {
		await writable.write(new Uint8Array(data));
		await writable.close();
	} catch (error) {
		// closeが成功するまでは元ファイルへ反映されない。失敗した書き込みを破棄する。
		await writable.abort().catch(() => {});
		throw error;
	}
	return handle;
}

export async function loadProjectFile(file?: File, handle?: FileSystemFileHandle): Promise<{ project: Project; name: string; handle?: FileSystemFileHandle } | null> {
	if (file != null) {
		return { project: decodeProjectFile(new Uint8Array(await file.arrayBuffer())), name: file.name, handle };
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
				const project = decodeProjectFile(new Uint8Array(await file.arrayBuffer()));
				resolve({ project, name: file.name });
			} catch (error) {
				reject(error);
			}
		}, { once: true });
		input.click();
	});
}

