import type { PortableCustomNodeGraphEffectAssetFile } from './export.ts';

/** HTML・JS・素材を一回のダウンロードで渡すための非圧縮ZIP。 */
export async function createPortableCustomNodeGraphEffectArchive(files: { html: string; javascript: string; readme: string; assetFiles: readonly PortableCustomNodeGraphEffectAssetFile[] }, signal?: AbortSignal): Promise<Blob> {
	const encoder = new TextEncoder();
	const entries: PortableCustomNodeGraphEffectAssetFile[] = [
		{ path: 'index.html', contents: new Blob([files.html]) },
		{ path: 'artwork.js', contents: new Blob([files.javascript]) },
		{ path: 'README.md', contents: new Blob([files.readme]) },
		...files.assetFiles,
	];
	if (entries.length >= 0xffff) throw new Error('Portable ZIP has too many files');
	const parts: BlobPart[] = [];
	const directory: Uint8Array<ArrayBuffer>[] = [];
	const crcTable = Array.from({ length: 256 }, (_, index) => {
		let crc = index;
		for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb88320 : 0);
		return crc >>> 0;
	});
	let offset = 0;
	let directorySize = 0;
	const end = new Uint8Array(22);
	for (const { path, contents } of entries) {
		signal?.throwIfAborted();
		const name = encoder.encode(path);
		const local = new Uint8Array(30 + name.length);
		const central = new Uint8Array(46 + name.length);
		directorySize += central.length;
		if (offset + local.length + contents.size + directorySize + end.length >= 0xffffffff) throw new Error('Portable ZIP exceeds the 4 GiB limit');
		// CRCの計算に必要な範囲だけを順に読み、動画などの原本を丸ごと別のバッファにコピーしない。
		let crc = 0xffffffff;
		for await (const chunk of contents.stream()) {
			signal?.throwIfAborted();
			for (const byte of chunk) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
		}
		crc = (crc ^ 0xffffffff) >>> 0;
		const header = new DataView(local.buffer);
		header.setUint32(0, 0x04034b50, true);
		header.setUint16(4, 20, true);
		header.setUint16(6, 0x800, true);
		header.setUint16(12, 33, true); // ZIPの最小日付1980-01-01。成果物に実行環境の時刻を混ぜない。
		header.setUint32(14, crc, true);
		header.setUint32(18, contents.size, true);
		header.setUint32(22, contents.size, true);
		header.setUint16(26, name.length, true);
		local.set(name, 30);
		const centralHeader = new DataView(central.buffer);
		centralHeader.setUint32(0, 0x02014b50, true);
		centralHeader.setUint16(4, 20, true);
		central.set(local.subarray(4, 30), 6);
		centralHeader.setUint32(42, offset, true);
		central.set(name, 46);
		parts.push(local, contents);
		directory.push(central);
		offset += local.length + contents.size;
	}
	signal?.throwIfAborted();
	const endHeader = new DataView(end.buffer);
	endHeader.setUint32(0, 0x06054b50, true);
	endHeader.setUint16(8, entries.length, true);
	endHeader.setUint16(10, entries.length, true);
	endHeader.setUint32(12, directorySize, true);
	endHeader.setUint32(16, offset, true);
	return new Blob([...parts, ...directory, end], { type: 'application/zip' });
}
