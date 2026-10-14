import * as api from '../api.ts';
import { progress } from '../ui.ts';
import type { OpenedMediaFile, OpenMediaFileOptions } from '../api.ts';

export function openMediaFile(options: OpenMediaFileOptions & { multiple: true }): Promise<OpenedMediaFile[] | null>;
export function openMediaFile(options?: OpenMediaFileOptions & { multiple?: false }): Promise<OpenedMediaFile | null>;
export function openMediaFile(options: OpenMediaFileOptions): Promise<OpenedMediaFile | OpenedMediaFile[] | null>;
export async function openMediaFile(options: OpenMediaFileOptions = {}): Promise<OpenedMediaFile | OpenedMediaFile[] | null> {
	const status: { dialog: ReturnType<typeof progress> | null } = { dialog: null };
	try {
		return await api.openMediaFile({ ...options, onThumbnailProgress: value => {
			// ファイル選択が終わり、実際に動画を処理するときだけ表示する。
			status.dialog ??= progress({ text: 'Generating video thumbnails' });
			status.dialog.setProgress(value);
			options.onThumbnailProgress?.(value);
		} });
	} finally {
		// 生成・取り込みの失敗時もinertとダイアログを残さない。
		status.dialog?.done();
	}
}
