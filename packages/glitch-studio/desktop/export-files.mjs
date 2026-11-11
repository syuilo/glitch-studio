import path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';

// 保存ダイアログで選んだ書き出し先だけを、一回限りのIDでUIへ公開する。
export class ExportFiles {
	#targets = new Map();
	#writes = new Map();

	register(filePath) {
		if (typeof filePath !== 'string' || !path.isAbsolute(filePath)
			|| !['.mp4', '.webp', '.exr'].includes(path.extname(filePath).toLowerCase())) {
			throw new Error('Invalid export file path');
		}
		const id = randomUUID();
		this.#targets.set(id, filePath);
		return { id, name: path.basename(filePath) };
	}

	async clear() {
		this.#targets.clear();
		await Promise.all(Array.from(this.#writes.keys(), id => this.release(id)));
	}
	async release(id) {
		this.#targets.delete(id);
		const write = this.#writes.get(id);
		this.#writes.delete(id);
		await write?.abort();
	}

	async begin(id, totalBytes) {
		const destination = this.#targets.get(id);
		if (destination == null) throw new Error('Unknown export save target');
		if (totalBytes != null && (!Number.isSafeInteger(totalBytes) || totalBytes <= 0)) throw new Error('The export contains no save data');
		this.#targets.delete(id);
		const write = new ExportFileWriteSession(destination, totalBytes);
		this.#writes.set(id, write);
		try { await write.open(); }
		catch (error) { await this.release(id); throw error; }
	}

	async append(id, data, position = null) {
		const write = this.#writes.get(id);
		if (write == null) throw new Error('Unknown export save target');
		try { return await write.append(data, position); }
		catch (error) { await this.release(id); throw error; }
	}

	async finish(id, totalBytes = null) {
		const write = this.#writes.get(id);
		if (write == null) throw new Error('Unknown export save target');
		try { await write.finish(totalBytes); }
		finally { await this.release(id); }
	}

	async write(id, data, onProgress = () => {}) {
		if (!(data instanceof Uint8Array) || data.byteLength === 0) throw new Error('The export contains no save data');
		await this.begin(id, data.byteLength);
		try {
			onProgress({ completedBytes: 0, totalBytes: data.byteLength });
			const chunkSize = 4 * 1024 * 1024;
			for (let offset = 0; offset < data.byteLength; offset += chunkSize) {
				const end = Math.min(offset + chunkSize, data.byteLength);
				onProgress(await this.append(id, data.subarray(offset, end)));
			}
			await this.finish(id);
		} finally { await this.release(id); }
	}
}

/** 完成前の出力は一時ファイルだけへ保存し、明示的なfinishで一度だけ公開する。 */
class ExportFileWriteSession {
	#file = null;
	#pending = Promise.resolve();
	#busy = false;
	#closed = false;
	#completedBytes = 0;

	constructor(destination, totalBytes) {
		this.destination = destination;
		this.totalBytes = totalBytes ?? null;
		this.temporary = path.join(path.dirname(destination), `.glitch-studio-export-${randomUUID()}.tmp`);
	}

	open() {
		return this.#run(async () => {
			this.#file = await fs.open(this.temporary, 'wx');
			this.#checkOpen();
		});
	}

	append(data, position) {
		return this.#run(async () => {
			const start = position ?? this.#completedBytes;
			const end = start + data?.byteLength;
			if (!(data instanceof Uint8Array) || data.byteLength === 0 || data.byteLength > 4 * 1024 * 1024
				|| !Number.isSafeInteger(start) || start < 0 || start > this.#completedBytes || !Number.isSafeInteger(end)
				|| (this.totalBytes != null && end > this.totalBytes)) throw new Error('Invalid export data chunk');
			// EXRは長さが圧縮後に確定し、最後にoffset tableを書き戻す。穴を作る
			// 書き込みは拒否し、完成までの全データを一時ファイルだけへ反映する。
			let offset = 0;
			while (offset < data.byteLength) {
				const { bytesWritten } = await this.#file.write(data, offset, data.byteLength - offset, start + offset);
				if (bytesWritten === 0) throw new Error('Could not write the export data');
				offset += bytesWritten;
			}
			this.#checkOpen();
			this.#completedBytes = Math.max(this.#completedBytes, end);
			return { completedBytes: this.#completedBytes, totalBytes: this.totalBytes };
		});
	}

	finish(totalBytes) {
		return this.#run(async () => {
			const expectedBytes = totalBytes ?? this.totalBytes;
			if (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0 || this.#completedBytes !== expectedBytes
				|| (this.totalBytes != null && expectedBytes !== this.totalBytes)) throw new Error('The export is incomplete');
			await this.#file.sync();
			await this.#file.close();
			this.#file = null;
			this.#checkOpen();
			// 書き込みの中断・失敗で、以前の出力を切り詰めない。公開はfsync後の置換だけ。
			await fs.rename(this.temporary, this.destination);
			this.#closed = true;
		});
	}

	async abort() {
		this.#closed = true;
		await this.#pending.catch(() => {});
		const file = this.#file;
		this.#file = null;
		await file?.close().catch(() => {});
		await fs.unlink(this.temporary).catch(() => {});
	}

	#checkOpen() { if (this.#closed) throw new Error('Export save session is closed'); }

	async #run(action) {
		this.#checkOpen();
		if (this.#busy) throw new Error('An export write is already in progress');
		this.#busy = true;
		const pending = action();
		this.#pending = pending;
		try { return await pending; }
		finally { this.#busy = false; }
	}
}
