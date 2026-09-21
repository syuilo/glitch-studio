
import { decodeProjectFile } from './gsproj.ts';
import type { Project } from './gsproj.ts';

export function loadProjectFile(): Promise<{ project: Project; name: string } | null> {
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

export function openMediaFile(options: { multiple?: boolean; file?: File } = {}): Promise<{
	width: number;
	height: number;
	data: Uint8Array | null;
	name: string;
	type: string;
	fileData: Blob;
	hash?: string;
} | null> {
	return new Promise((resolve, reject) => {
		const input = window.document.createElement('input');
		input.type = 'file';
		input.accept = 'image/*,video/*,audio/*';
		input.multiple = options.multiple ?? false;
		input.addEventListener('cancel', () => resolve(null), { once: true });
		const loadFile = (file: File | undefined) => {
			if (file == null) { resolve(null); return; }
			if (file.type.startsWith('audio/') || file.type.startsWith('video/')) {
				const media = window.document.createElement(file.type.startsWith('audio/') ? 'audio' : 'video');
				const url = URL.createObjectURL(file);
				const cleanup = () => {
					media.onloadedmetadata = null;
					media.onerror = null;
					media.removeAttribute('src');
					media.load();
					URL.revokeObjectURL(url);
				};
				media.preload = 'metadata';
				media.onloadedmetadata = () => {
					resolve({
						width: media instanceof HTMLVideoElement ? media.videoWidth : 0,
						height: media instanceof HTMLVideoElement ? media.videoHeight : 0,
						data: null,
						name: file.name,
						type: file.type,
						fileData: file,
					});
					cleanup();
				};
				media.onerror = () => { const error = media.error; cleanup(); reject(error ?? new Error('Could not decode media')); };
				media.src = url;
				return;
			}
			if (!file.type.startsWith('image/')) { reject(new Error('Unsupported media type')); return; }
			const reader = new FileReader();
			reader.onerror = () => reject(reader.error ?? new Error('Could not read file'));
			reader.onload = () => {
				if (file.type.startsWith('image/')) {
					const img = new Image();
					img.onerror = () => reject(new Error('Could not decode image'));
					img.onload = async () => {
						const canvas = window.document.createElement('canvas');
						canvas.width = img.width;
						canvas.height = img.height;
						const ctx = canvas.getContext('2d');
						if (!ctx) {
							reject(new Error('Could not create a 2D canvas context'));
							return;
						}
						ctx.drawImage(img, 0, 0);
						const data = ctx.getImageData(0, 0, img.width, img.height).data;
						console.log(file.type + ' ' + file.name);
						resolve({
							width: img.width,
							height: img.height,
							data: new Uint8Array(data),
							name: file.name,
							type: file.type,
							fileData: file,
						});
					};
					img.src = reader.result as string;
				}
			};
			reader.readAsDataURL(file);
		};
		if (options.file != null) {
			loadFile(options.file);
		} else {
			input.onchange = () => loadFile(input.files?.[0]);
			input.click();
		}
	});
}
