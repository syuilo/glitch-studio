// WGSLのRowStateと同じ順序の5個のf32。構造体はscalarだけなのでstrideは20 bytes。
export const ROW_STATE_FLOATS = 5;

export type RasterSettings = {
	columns: number;
	rows: number;
	rowWidthError: number;
	readOffset: number;
	startPosition: number;
	corruption: boolean;
	corruptionProbability: number;
	corruptionAmount: number;
	resynchronization: boolean;
	restartInterval: number;
	seed: number;
};

function random(row: number, seed: number, salt: number): number {
	let value = (row ^ seed ^ Math.imul(salt, 0x9e3779b9)) >>> 0;
	value ^= value >>> 16;
	value = Math.imul(value, 0x7feb352d);
	value ^= value >>> 15;
	value = Math.imul(value, 0x846ca68b);
	value ^= value >>> 16;
	return (value >>> 8) / 16777216;
}

export function writeRasterRows(values: Float32Array, settings: RasterSettings): void {
	const { columns, rows } = settings;
	const firstRow = Math.floor(Math.min(1, Math.max(0, settings.startPosition)) * rows);
	const restartInterval = Math.max(1, Math.round(settings.restartInterval));
	const rowWidthError = columns * settings.rowWidthError / 100;
	const probability = Math.min(1, Math.max(0, settings.corruptionProbability));
	const maximumJump = columns * Math.max(0, settings.corruptionAmount) / 100;
	let phase = columns * settings.readOffset / 100;

	// JSのf64で各行の位相を走査し、GPUへは整数の行番号と小さい列オフセットに分けて渡す。
	// 巨大な一次元アドレスをf32で扱うと、画像の下側ほど小数部が失われて細部がぼけるため。
	for (let row = 0; row < rows; row++) {
		const offset = row * ROW_STATE_FLOATS;
		if (row < firstRow) {
			values.set([row, 0, row, 0, columns], offset);
			continue;
		}
		if (settings.resynchronization && row > firstRow && (row - firstRow) % restartInterval === 0) {
			// 再同期地点では元の行頭へ戻す。初期オフセットは破損開始時にだけ適用する。
			phase = 0;
		}
		const beforeRowOffset = Math.floor(phase / columns);
		const beforeColumn = phase - beforeRowOffset * columns;
		let splitPosition = columns;
		if (settings.corruption && maximumJump > 0 && random(row, settings.seed, 1) < probability) {
			// 誤りは行頭に限定せず、行の途中から発生する。その後は同じずれを次の行へ持続させる。
			splitPosition = random(row, settings.seed, 2) * columns;
			phase += (random(row, settings.seed, 3) * 2 - 1) * maximumJump;
		}
		const afterRowOffset = Math.floor(phase / columns);
		const afterColumn = phase - afterRowOffset * columns;
		const beforeRow = row + beforeRowOffset;
		const afterRow = row + afterRowOffset;
		// 入力のwrap設定を尊重するため、負の行や画像外の行もここでは折り返さない。
		// f32で表現できない値をGPUへ渡す代わりに、調整可能な描画エラーとして通知する。
		if (!Number.isFinite(Math.fround(beforeRow)) || !Number.isFinite(Math.fround(afterRow))
			|| !Number.isFinite(beforeColumn) || !Number.isFinite(afterColumn)) {
			throw new Error('Raster desync: read offset exceeds the supported numeric range.');
		}
		values.set([beforeRow, beforeColumn, afterRow, afterColumn, splitPosition], offset);
		// 実際に読み進める幅と正しい行幅との差分だけを蓄積する。
		// 行の中は元画像を連続して読むため、行幅を変えても全体を縮小・拡大する処理にはならない。
		phase += rowWidthError;
	}
}
