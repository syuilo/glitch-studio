/** GPUの行alignmentを外し、所有権のある小さな画素ブロックを上から順に返す。 */
export async function* readImageBlocks(device: GPUDevice, texture: GPUTexture, options: {
	bytesPerPixel: number;
	rowsPerBlock: number;
	signal: AbortSignal;
	isDisposed: () => boolean;
}): AsyncGenerator<Uint8Array<ArrayBuffer>> {
	const { bytesPerPixel, rowsPerBlock, signal, isDisposed } = options;
	if (!Number.isInteger(rowsPerBlock) || rowsPerBlock < 1) throw new Error('Invalid image block height.');
	signal.throwIfAborted();
	if (isDisposed()) throw new Error('Image readback is closed.');
	const { width, height } = texture;
	const rowBytes = width * bytesPerPixel;
	const bytesPerRow = Math.ceil(rowBytes / 256) * 256;
	// 画像全体のbufferはGPU上限を超え得る。複数の圧縮ブロックを一度に読み戻し、
	// 行ごとのGPU待機と、全画像のJavaScript配列の両方を避ける。
	const batchRows = Math.floor(Math.min(256, device.limits.maxBufferSize / bytesPerRow) / rowsPerBlock) * rowsPerBlock;
	if (batchRows < rowsPerBlock) throw new Error('GPU readback buffer limit is too small.');
	const buffer = device.createBuffer({ label: 'Image block readback', size: bytesPerRow * Math.min(batchRows, height),
		usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
	try {
		for (let start = 0; start < height; start += batchRows) {
			signal.throwIfAborted();
			if (isDisposed()) throw new Error('Image readback is closed.');
			const rows = Math.min(batchRows, height - start);
			const encoder = device.createCommandEncoder();
			encoder.copyTextureToBuffer({ texture, origin: [0, start] }, { buffer, bytesPerRow }, [width, rows]);
			device.queue.submit([encoder.finish()]);
			await buffer.mapAsync(GPUMapMode.READ);
			try {
				const padded = new Uint8Array(buffer.getMappedRange());
				for (let row = 0; row < rows; row += rowsPerBlock) {
					signal.throwIfAborted();
					if (isDisposed()) throw new Error('Image readback is closed.');
					const blockRows = Math.min(rowsPerBlock, rows - row);
					const pixels = new Uint8Array(rowBytes * blockRows);
					for (let index = 0; index < blockRows; index++) pixels.set(padded.subarray((row + index) * bytesPerRow,
						(row + index) * bytesPerRow + rowBytes), index * rowBytes);
					// mapされたviewを返すと、次のバッチのunmapで呼び出し元の画素も無効になる。
					// ブロックだけは独立させ、圧縮や非同期処理の後も有効な値として渡す。
					yield pixels;
				}
			} finally { buffer.unmap(); }
		}
	} finally { buffer.destroy(); }
}
