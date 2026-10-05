import type { DecodedPcmBlock, StereoPcm } from '@gs/subsystems_audio_shared/pcm.ts';

const lobes = 32;
const phases = 1024;
const rolloff = 0.94;

/** 前後の入力が必要な幅。シーク・窓の読み込み時もこの分を含める。 */
export function resamplingPaddingSeconds(inputRate: number, outputRate: number): number {
	return Math.ceil(lobes / (rolloff * Math.min(1, outputRate / inputRate))) / inputRate;
}

function createKernel(inputRate: number, outputRate: number) {
	// ナイキスト周波数直前に遷移帯域を確保する。単なる線形補間では、間引いたときに
	// 出力帯域外の音が可聴域へ折り返すため、Blackman窓付きsincで帯域を制限する。
	const cutoff = rolloff * Math.min(1, outputRate / inputRate);
	const radius = Math.ceil(lobes / cutoff);
	const width = radius * 2 + 1;
	const coefficients = new Float32Array((phases + 1) * width);
	for (let phase = 0; phase <= phases; phase++) {
		let sum = 0;
		for (let tap = 0; tap < width; tap++) {
			const distance = tap - radius - phase / phases;
			if (Math.abs(distance) >= radius) continue;
			const angle = Math.PI * distance * cutoff;
			const sinc = Math.abs(angle) < 1e-12 ? 1 : Math.sin(angle) / angle;
			const window = 0.42 + 0.5 * Math.cos(Math.PI * distance / radius) + 0.08 * Math.cos(2 * Math.PI * distance / radius);
			const weight = cutoff * sinc * window;
			coefficients[phase * width + tap] = weight;
			sum += weight;
		}
		// 位相ごとの丸めで、一定振幅の音量が変化しないようDC利得を揃える。
		for (let tap = 0; tap < width; tap++) coefficients[phase * width + tap] /= sum;
	}
	return { radius, width, coefficients };
}

/** デコード・再生状態を持たず、素材時刻から位相を決める。チャンク分割やシークで結果を変えない。 */
export class PcmResampler {
	private kernels = new Map<string, ReturnType<typeof createKernel>>();

	private kernel(inputRate: number, outputRate: number) {
		const key = `${inputRate}:${outputRate}`;
		let kernel = this.kernels.get(key);
		if (!kernel) {
			kernel = createKernel(inputRate, outputRate);
			// 通常は1種類。異なる素材・出力レートを渡しても係数表を無制限に保持しない。
			if (this.kernels.size >= 4) this.kernels.delete(this.kernels.keys().next().value!);
			this.kernels.set(key, kernel);
		}
		return kernel;
	}

	resample(blocks: readonly DecodedPcmBlock[], time: number, frames: number, rate: number): StereoPcm {
		const output: StereoPcm = [new Float32Array(frames), new Float32Array(frames)];
		let blockIndex = 0;
		for (let frame = 0; frame < frames; frame++) {
			const position = time + frame / rate;
			while (blockIndex < blocks.length && position >= blocks[blockIndex].time + blocks[blockIndex].channels[0].length / blocks[blockIndex].rate) blockIndex++;
			const block = blocks[blockIndex];
			if (!block || position < block.time) continue;
			const x = (position - block.time) * block.rate;
			// 同じレート・サンプル境界なら無加工で渡す。浮動小数点の秒変換誤差だけを許容する。
			const nearest = Math.round(x);
			if (block.rate === rate && Math.abs(x - nearest) < 1e-7 && nearest < block.channels[0].length) {
				output[0][frame] = block.channels[0][nearest];
				output[1][frame] = block.channels[1][nearest];
				continue;
			}
			const low = Math.floor(x);
			const { radius, width, coefficients } = this.kernel(block.rate, rate);
			const coefficientOffset = Math.round((x - low) * phases) * width;
			let left = 0;
			let right = 0;
			for (let tap = 0; tap < width; tap++) {
				const index = low + tap - radius;
				let source = block;
				let sourceIndex = index;
				if (index < 0 || index >= block.channels[0].length) {
					// デコードの区切りをまたぐタップは隣接ブロックへ読む。素材の外と実際の欠落は0。
					const sampleTime = block.time + index / block.rate;
					let neighbor = blockIndex;
					while (neighbor > 0 && sampleTime < blocks[neighbor].time) neighbor--;
					while (neighbor < blocks.length - 1 && sampleTime >= blocks[neighbor].time + blocks[neighbor].channels[0].length / blocks[neighbor].rate) neighbor++;
					source = blocks[neighbor];
					sourceIndex = Math.round((sampleTime - source.time) * source.rate);
					if (sourceIndex < 0 || sourceIndex >= source.channels[0].length) continue;
				}
				const weight = coefficients[coefficientOffset + tap];
				left += source.channels[0][sourceIndex] * weight;
				right += source.channels[1][sourceIndex] * weight;
			}
			output[0][frame] = left;
			output[1][frame] = right;
		}
		return output;
	}
}
