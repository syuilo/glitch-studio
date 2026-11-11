export type BrowserExportFileTarget = {
	directory: FileSystemDirectoryHandle;
	name: string;
	handle: FileSystemFileHandle | null;
};

export function getOpenExrFileName(name: string): string {
	const trimmed = name.trim();
	if (trimmed.length === 0 || trimmed === '.' || trimmed === '..' || /[/\\]/.test(trimmed)) throw new Error('Enter a file name without a folder path.');
	return trimmed.toLowerCase().endsWith('.exr') ? trimmed : trimmed + '.exr';
}

export async function selectOpenExrSaveTarget(directory: FileSystemDirectoryHandle, name: string,
	confirmOverwrite: (name: string) => Promise<boolean>): Promise<BrowserExportFileTarget | null> {
	const fileName = getOpenExrFileName(name);
	let handle: FileSystemFileHandle | null = null;
	try { handle = await directory.getFileHandle(fileName); } catch (error) { if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error; }
	if (handle != null && !await confirmOverwrite(fileName)) return null;
	// 描画前の選択では新しい空ファイルも作らない。書き込み開始までフォルダーと名前だけを持つ。
	return { directory, name: fileName, handle };
}

/** createWritableの一時出力へ位置指定で書き込み、成功したfinishだけで保存先へ確定する。 */
export class BrowserExportFile {
	private stream: FileSystemWritableFileStream | null = null;
	private handle: FileSystemFileHandle | null = null;
	private created = false;
	private committed = false;
	private pending: Promise<void> | null = null;
	private closed = false;
	private size = 0;
	private readonly target: BrowserExportFileTarget;

	constructor(target: BrowserExportFileTarget) { this.target = target; }

	public async write(chunk: Uint8Array<ArrayBuffer>, position: number): Promise<void> {
		if (this.closed || this.pending != null) throw new Error('Export save session is not writable.');
		if (!Number.isSafeInteger(position) || position < 0 || position > this.size || chunk.byteLength === 0
			|| !Number.isSafeInteger(position + chunk.byteLength)) throw new Error('Invalid export chunk position.');
		const writing = async () => {
			if (this.stream == null) {
				this.handle = this.target.handle;
				if (this.handle == null) {
					// 選択から描画終了までに他の処理が同名ファイルを作った場合は、無断で上書きしない。
					try { await this.target.directory.getFileHandle(this.target.name); } catch (error) {
						if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
						this.handle = await this.target.directory.getFileHandle(this.target.name, { create: true });
						this.created = true;
					}
					if (this.handle == null) throw new Error('The selected export file was created by another operation.');
				}
				this.stream = await this.handle.createWritable();
			}
			await this.stream.write({ type: 'write', position, data: chunk });
			this.size = Math.max(this.size, position + chunk.byteLength);
		};
		this.pending = writing();
		try { await this.pending; } finally { this.pending = null; }
	}

	public async finish(totalBytes: number): Promise<void> {
		if (this.closed || this.pending != null || this.stream == null || !Number.isSafeInteger(totalBytes) || totalBytes <= 0 || totalBytes !== this.size) throw new Error('The export is incomplete.');
		this.closed = true;
		await this.stream.close();
		this.committed = true;
		this.stream = null;
	}

	public async abort(): Promise<void> {
		this.closed = true;
		await this.pending?.catch(() => {});
		await this.stream?.abort().catch(() => {});
		this.stream = null;
		if (this.created && !this.committed && this.handle != null) {
			// 新規作成した空の宛先だけを片付ける。別の操作で内容が入ったものは残す。
			const current = await this.target.directory.getFileHandle(this.target.name);
			if (await current.isSameEntry(this.handle) && (await current.getFile()).size === 0) await this.target.directory.removeEntry(this.target.name);
			this.created = false;
		}
	}
}
