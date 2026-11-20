export const maximumPredictionBlockSamples = 16;
export const maximumSubdivisionLevels = 4;

export type DecoderPartitionSettings = {
	packetColumns: number;
	packetRows: number;
	packetWidth: number;
	packetHeight: number;
	originAtCenter: boolean;
	subdivisions: number;
	splitProbability: number;
	seed: number;
};

function hash32(value: number): number {
	let result = value >>> 0;
	result ^= result >>> 16;
	result = Math.imul(result, 0x7feb352d);
	result ^= result >>> 15;
	result = Math.imul(result, 0x846ca68b);
	return (result ^ (result >>> 16)) >>> 0;
}

/** 画素やGPUを参照せず、独立した再同期区画と、その中を復号する順番だけを作る。 */
export function createDecoderPartition(settings: DecoderPartitionSettings): Uint32Array {
	const packetCount = settings.packetColumns * settings.packetRows;
	const blockIdentityOriginX = settings.originAtCenter ? (settings.packetColumns - 1) / 2 * settings.packetWidth * maximumPredictionBlockSamples : 0;
	const blockIdentityOriginY = settings.originAtCenter ? (settings.packetRows - 1) / 2 * settings.packetHeight * maximumPredictionBlockSamples : 0;
	// 先頭に各区画の開始位置・葉の個数を置き、その後に葉のx・y・一辺・識別子を並べる。
	// 中央原点では中央区画からの相対座標、左上原点では従来の絶対座標で識別子を作る。
	// 区画数が増減しても、それぞれの拡縮原点の周辺で葉の分割や破損位置を入れ替えないため。
	const descriptors: number[] = new Array<number>(packetCount * 4).fill(0);
	const appendBlock = (x: number, y: number, size: number, depth: number): void => {
		const identity = hash32(Math.imul(x - blockIdentityOriginX, 0x9e3779b9) ^ Math.imul(y - blockIdentityOriginY, 0x85ebca6b) ^ Math.imul(size, 0xc2b2ae35));
		const split = (hash32(identity ^ settings.seed ^ 0x68bc21eb) >>> 8) / 16777216;
		if (depth < settings.subdivisions && split < settings.splitProbability) {
			const halfSize = size / 2;
			// 左上→右上→左下→右下なら、どの葉も必要な上辺・左辺がすでに復号されている。
			// 大きさの違う葉が隣接しても、未処理の隣接ブロックを読むことはない。
			appendBlock(x, y, halfSize, depth + 1);
			appendBlock(x + halfSize, y, halfSize, depth + 1);
			appendBlock(x, y + halfSize, halfSize, depth + 1);
			appendBlock(x + halfSize, y + halfSize, halfSize, depth + 1);
			return;
		}
		descriptors.push(x, y, size, identity);
	};
	for (let packetY = 0; packetY < settings.packetRows; packetY++) {
		for (let packetX = 0; packetX < settings.packetColumns; packetX++) {
			const packetIndex = packetY * settings.packetColumns + packetX;
			const firstBlock = descriptors.length / 4;
			for (let blockY = 0; blockY < settings.packetHeight; blockY++) {
				for (let blockX = 0; blockX < settings.packetWidth; blockX++) {
					appendBlock(
						(packetX * settings.packetWidth + blockX) * maximumPredictionBlockSamples,
						(packetY * settings.packetHeight + blockY) * maximumPredictionBlockSamples,
						maximumPredictionBlockSamples,
						0,
					);
				}
			}
			descriptors[packetIndex * 4] = firstBlock;
			descriptors[packetIndex * 4 + 1] = descriptors.length / 4 - firstBlock;
		}
	}
	return new Uint32Array(descriptors);
}
