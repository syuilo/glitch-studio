import { i18n } from '@/i18n.ts';
import * as api from '../api.ts';
import { progress } from '../ui.ts';
import type { OpenedMediaFile, OpenMediaFileOptions } from '../api.ts';

type ImportMediaFilesOptions = OpenMediaFileOptions & {
	/** 素材のプロジェクト反映までダイアログを維持する。 */
	onImported?: (files: OpenedMediaFile[], dialog: ReturnType<typeof progress>) => void | Promise<void>;
};

export async function importMediaFiles(files: readonly File[], options: ImportMediaFilesOptions = {}): Promise<OpenedMediaFile[]> {
	if (files.length === 0) return [];
	const dialog = progress({ text: i18n.ts._Assets.Importing });
	try {
		const results = await api.openMediaFile({ ...options, files, multiple: true, onReadProgress: value => {
			const { file, fileIndex, completedFiles, totalFiles, fileProgress } = value;
			if (totalFiles > 1) {
				// 全体は完了件数で測る。読み込み時間を予測できない段階も割合を偽らない。
				dialog.setProgress(completedFiles / totalFiles);
				dialog.setSubProgress(fileProgress);
			} else {
				dialog.setProgress(fileProgress);
			}
			const stage = completedFiles > fileIndex ? i18n.ts._Assets.Processed : fileProgress == null ? i18n.ts._Assets.Reading : i18n.ts._Assets.GeneratingThumbnails;
			dialog.setText(`${stage}: ${file.name} (${fileIndex + 1}/${totalFiles})`);
			options.onReadProgress?.(value);
		} });
		const imported = results ?? [];
		if (options.onImported != null) {
			dialog.setText(i18n.ts._Assets.Adding);
			if (files.length > 1) dialog.setSubProgress(null);
			else dialog.setProgress(null);
			await options.onImported(imported, dialog);
		}
		return imported;
	} finally {
		// 成否によらず終了し、ファイル読み込みからプロジェクト反映まで操作を止める。
		dialog.done();
	}
}

export function openMediaFile(options: OpenMediaFileOptions & { multiple: true }): Promise<OpenedMediaFile[] | null>;
export function openMediaFile(options?: OpenMediaFileOptions & { multiple?: false }): Promise<OpenedMediaFile | null>;
export function openMediaFile(options: OpenMediaFileOptions): Promise<OpenedMediaFile | OpenedMediaFile[] | null>;
export async function openMediaFile(options: OpenMediaFileOptions = {}): Promise<OpenedMediaFile | OpenedMediaFile[] | null> {
	const selected = await api.selectMediaFiles(options);
	if (selected == null || selected.length === 0) return null;
	const files = options.multiple === true ? selected : selected.slice(0, 1);
	const results = await importMediaFiles(files, options);
	return options.multiple === true ? results : results[0] ?? null;
}
