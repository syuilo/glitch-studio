import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import type { SizeReference } from '@gs/shared/size-reference.ts';

export type FourierImageLayoutParameters = {
	processing: 'global' | 'blocks';
	boundary: 'repeat' | 'mirror';
	analysisResolution: number;
	blockResolution: number;
	blockSize: number;
	sizeReference: SizeReference;
};
export type FourierResourceLimits = { maxStorageBufferBindingSize: number; maxBufferSize: number; maxComputeWorkgroupsPerDimension: number };

export function createFourierImageLayout(params: FourierImageLayoutParameters, resolution: { width: number; height: number }, limits: FourierResourceLimits) {
	const referenceLength = getSizeReferenceLength(params.sizeReference, resolution);
	let width: number;
	let height: number;
	let blockColumns = 1;
	let blockRows = 1;
	let tileSize: [number, number];
	if (params.processing === 'blocks') {
		if (!Number.isFinite(params.blockSize) || params.blockSize <= 0) throw new Error('Block Size must be a positive finite number.');
		width = height = params.blockResolution;
		const blockPixels = params.blockSize * 0.01 * referenceLength;
		tileSize = [blockPixels / resolution.width, blockPixels / resolution.height];
		// 半ブロック外側から50%ずつ重ね、端も四つの合成窓で覆う。
		blockColumns = Math.ceil(2 / tileSize[0]) + 1;
		blockRows = Math.ceil(2 / tileSize[1]) + 1;
	} else {
		const longSide = Math.max(resolution.width, resolution.height);
		const extension = params.boundary === 'mirror' ? 2 : 1;
		width = 2 ** Math.ceil(Math.log2(Math.max(16, params.analysisResolution * resolution.width / longSide))) * extension;
		height = 2 ** Math.ceil(Math.log2(Math.max(16, params.analysisResolution * resolution.height / longSide))) * extension;
		tileSize = [extension, extension];
	}
	const blockCount = blockColumns * blockRows;
	const sampleCount = width * height * blockCount;
	const bufferBytes = sampleCount * 32;
	const dispatchLimit = limits.maxComputeWorkgroupsPerDimension;
	if (!Number.isSafeInteger(sampleCount) || sampleCount < 1 || bufferBytes > Math.min(limits.maxStorageBufferBindingSize, limits.maxBufferSize)
		|| Math.ceil(width / 8) > dispatchLimit || Math.ceil(height / 8) > dispatchLimit || blockCount > dispatchLimit) {
		throw new Error('analysis exceeds GPU resource limits. Reduce analysis resolution or increase Block Size.');
	}
	return {
		width, height, blockColumns, blockRows, blockCount, bufferBytes, tileSize,
		logSize: [Math.log2(width), Math.log2(height)],
		frequencyScale: [referenceLength / (resolution.width * tileSize[0]), referenceLength / (resolution.height * tileSize[1])],
	};
}

export type FourierImageLayout = ReturnType<typeof createFourierImageLayout>;
