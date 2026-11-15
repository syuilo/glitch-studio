/** HTMLとJSを一回のダウンロードで渡すための、非圧縮ZIP。外部ツール・複数ダウンロード許可を必要としない。 */
export function createPortableVisualModuleArchive(files: { html: string; javascript: string; readme: string }): Blob {
	const encoder = new TextEncoder();
	const entries = [['index.html', files.html], ['artwork.js', files.javascript], ['README.md', files.readme]];
	const parts: BlobPart[] = [];
	const directory: Uint8Array<ArrayBuffer>[] = [];
	const crcTable = Array.from({ length: 256 }, (_, index) => {
		let crc = index;
		for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb88320 : 0);
		return crc >>> 0;
	});
	let offset = 0;
	for (const [filename, contents] of entries) {
		const name = encoder.encode(filename);
		const data = encoder.encode(contents);
		if (data.length + offset + 1024 >= 0xffffffff) throw new Error('Portable ZIP exceeds the 4 GiB limit');
		let crc = 0xffffffff;
		for (const byte of data) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
		crc = (crc ^ 0xffffffff) >>> 0;
		const local = new Uint8Array(30 + name.length);
		const header = new DataView(local.buffer);
		header.setUint32(0, 0x04034b50, true);
		header.setUint16(4, 20, true);
		header.setUint16(6, 0x800, true);
		header.setUint16(12, 33, true); // ZIPの最小日付1980-01-01。成果物に実行環境の時刻を混ぜない。
		header.setUint32(14, crc, true);
		header.setUint32(18, data.length, true);
		header.setUint32(22, data.length, true);
		header.setUint16(26, name.length, true);
		local.set(name, 30);
		const central = new Uint8Array(46 + name.length);
		const centralHeader = new DataView(central.buffer);
		centralHeader.setUint32(0, 0x02014b50, true);
		centralHeader.setUint16(4, 20, true);
		central.set(local.subarray(4, 30), 6);
		centralHeader.setUint32(42, offset, true);
		central.set(name, 46);
		parts.push(local, data);
		directory.push(central);
		offset += local.length + data.length;
	}
	const end = new Uint8Array(22);
	const endHeader = new DataView(end.buffer);
	endHeader.setUint32(0, 0x06054b50, true);
	endHeader.setUint16(8, entries.length, true);
	endHeader.setUint16(10, entries.length, true);
	endHeader.setUint32(12, directory.reduce((size, entry) => size + entry.length, 0), true);
	endHeader.setUint32(16, offset, true);
	return new Blob([...parts, ...directory, end], { type: 'application/zip' });
}
