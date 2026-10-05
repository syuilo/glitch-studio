import { createAudioWindow } from '@gs/subsystems_audio_shared/audio-window.ts';
import type { AudioWindow, AudioSampleChannel } from '@gs/subsystems_audio_shared/audio-window.ts';
import type { AudioChunk } from '@gs/subsystems_audio_shared/audio-capture.ts';

type AudioBlock = { readonly startFrame: number; readonly endFrame: number; readonly window: AudioWindow };

// 連続走査では現在または次のブロックだけを調べる。FFTの巻き戻し等だけ二分探索する。
function findBlock(blocks: readonly AudioBlock[], frame: number, current: number): number {
	const block = blocks[current];
	if (block && frame >= block.startFrame && frame < block.endFrame) return current;
	const next = blocks[current + 1];
	if (next && frame >= next.startFrame && frame < next.endFrame) return current + 1;
	let low = 0;
	let high = blocks.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (blocks[middle].endFrame <= frame) low = middle + 1;
		else high = middle;
	}
	return low;
}

// 選択済みブロックだけを受け取る。短い窓が元のスナップショット全体を保持しないため。
function createBlockWindow(sampleRate: number, startFrame: number, endFrame: number, availableStart: number, blocks: readonly AudioBlock[]): AudioWindow {
	let current = 0;
	return {
		sampleRate,
		frameCount: endFrame - startFrame,
		sample(frame, channel) {
			const absoluteFrame = startFrame + frame;
			if (frame < 0 || absoluteFrame < availableStart || absoluteFrame >= endFrame) return 0;
			current = findBlock(blocks, absoluteFrame, current);
			const block = blocks[current];
			return block?.window.sample(absoluteFrame - block.startFrame, channel) ?? 0;
		},
	};
}

/** PCMは共有し、区間とブロック参照だけを固定する。履歴の追記・破棄・リセット後も有効。 */
export class AudioHistorySnapshot {
	constructor(
		public readonly sampleRate: number,
		public readonly startFrame: number,
		public readonly endFrame: number,
		private readonly blocks: readonly AudioBlock[],
	) {}

	readWindow(frameCount: number): AudioWindow {
		if (!Number.isSafeInteger(frameCount) || frameCount < 0) throw new Error('Invalid audio window frame count');
		const startFrame = this.endFrame - frameCount;
		return createBlockWindow(this.sampleRate, startFrame, this.endFrame, this.startFrame,
			this.blocks.filter(block => block.endFrame > startFrame && block.startFrame < this.endFrame));
	}
}

export class AudioHistory {
	public sampleRate = 48000;
	public channelCount = 0;
	public generation = 0;
	public revision = 0;
	public startFrame = 0;
	public endFrame = 0;
	private blocks: AudioBlock[] = [];
	private currentBlock = 0;

	public reset(generation = this.generation) {
		this.generation = generation;
		this.revision++;
		this.startFrame = this.endFrame = 0;
		this.channelCount = 0;
		this.blocks = [];
		this.currentBlock = 0;
	}

	public append(chunk: AudioChunk) {
		if (chunk.generation < this.generation) return;
		if (chunk.generation !== this.generation || chunk.startFrame !== this.endFrame
			|| chunk.sampleRate !== this.sampleRate || chunk.channelCount !== this.channelCount) {
			this.reset(chunk.generation);
			this.startFrame = this.endFrame = chunk.startFrame;
		}
		this.sampleRate = chunk.sampleRate;
		this.channelCount = chunk.channelCount;
		// 保持区間は従来どおり。境界にかかる1ブロックだけは、先頭の範囲外PCMも保持する。
		const capacity = Math.max(65536, Math.ceil(this.sampleRate * 2));
		this.endFrame = chunk.startFrame + chunk.frameCount;
		this.startFrame = Math.max(this.startFrame, this.endFrame - capacity);
		const retainedFrames = Math.min(chunk.frameCount, capacity);
		if (retainedFrames > 0) {
			// 受信bufferは呼び出し側が返却・再利用するため、取り込み時だけコピーする。
			// 以後は配列を公開も上書きもせず、モノラルの左右も同じ配列を参照する。
			const skip = chunk.frameCount - retainedFrames;
			const left = new Float32Array(chunk.buffer, skip * 4, retainedFrames).slice();
			const right = chunk.channelCount === 1 ? left
				: new Float32Array(chunk.buffer, (chunk.frameCount + skip) * 4, retainedFrames).slice();
			this.blocks.push({ startFrame: this.endFrame - retainedFrames, endFrame: this.endFrame,
				window: createAudioWindow(this.sampleRate, [left, right]) });
		}
		let expired = 0;
		while (expired < this.blocks.length && this.blocks[expired].endFrame <= this.startFrame) expired++;
		if (expired > 0) {
			this.blocks.splice(0, expired);
			this.currentBlock = Math.max(0, this.currentBlock - expired);
		}
	}

	public snapshot(): AudioHistorySnapshot {
		return new AudioHistorySnapshot(this.sampleRate, this.startFrame, this.endFrame, this.blocks.slice());
	}

	public sample(frame: number, channel: AudioSampleChannel): number {
		if (frame < this.startFrame || frame >= this.endFrame || !this.channelCount) return 0;
		// 既存のPlayerプレビュー/Spectrogramは、モノラルの右側を無音として扱う。
		// 描画用AudioInputの窓は、取得元によらずモノラルを左右へ複製する契約。
		if (channel === 'right' && this.channelCount === 1) return 0;
		this.currentBlock = findBlock(this.blocks, frame, this.currentBlock);
		const block = this.blocks[this.currentBlock];
		return block?.window.sample(frame - block.startFrame, channel) ?? 0;
	}
}
