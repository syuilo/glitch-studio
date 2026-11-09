import path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';

// 保存ダイアログで選んだ書き出し先だけを、一回限りのIDでUIへ公開する。
export class ExportFiles {
	#targets = new Map();

	register(filePath) {
		if (typeof filePath !== 'string' || !path.isAbsolute(filePath)
			|| !['.mp4', '.webp', '.exr'].includes(path.extname(filePath).toLowerCase())) {
			throw new Error('Invalid export file path');
		}
		const id = randomUUID();
		this.#targets.set(id, filePath);
		return { id, name: path.basename(filePath) };
	}

	clear() { this.#targets.clear(); }
	release(id) { this.#targets.delete(id); }

	async write(id, data, onProgress = () => {}) {
		const destination = this.#targets.get(id);
		if (destination == null) throw new Error('Unknown export save target');
		if (!(data instanceof Uint8Array) || data.byteLength === 0) throw new Error('The export contains no save data');
		// 同じ保存先IDを使った並行書き込みや、完了後の再利用を許可しない。
		this.#targets.delete(id);
		const temporary = path.join(path.dirname(destination), `.glitch-studio-export-${randomUUID()}.tmp`);
		let file = null;
		try {
			file = await fs.open(temporary, 'wx');
			onProgress({ completedBytes: 0, totalBytes: data.byteLength });
			// 大きなEXRも一時ファイルへ順次書き込み、完了したバイト数を通知する。
			// 宛先への置換はfsync後なので、失敗しても以前のファイルを失わない。
			const chunkSize = 4 * 1024 * 1024;
			for (let offset = 0; offset < data.byteLength; offset += chunkSize) {
				const end = Math.min(offset + chunkSize, data.byteLength);
				await file.writeFile(data.subarray(offset, end));
				onProgress({ completedBytes: end, totalBytes: data.byteLength });
			}
			await file.sync();
			await file.close();
			file = null;
			// 選択時や描画中は保存先に触らず、書き込みも完成した一時ファイルで置き換える。
			// エクスポートの失敗やディスク書き込みの失敗で、既存ファイルを空にしない。
			await fs.rename(temporary, destination);
		} finally {
			await file?.close().catch(() => {});
			await fs.unlink(temporary).catch(() => {});
		}
	}
}
