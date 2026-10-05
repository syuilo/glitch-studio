/** 周期窓を適用した実数列から片側振幅スペクトラムを得る。取得元や更新履歴は扱わない。 */
export class WindowedFft {
	private real: Float64Array;
	private imaginary: Float64Array;
	private window: Float64Array;
	private reverse: Uint32Array;
	private cosine: Float64Array;
	private sine: Float64Array;
	private windowSum = 0;

	constructor(public readonly size: number, public readonly windowName: string) {
		this.real = new Float64Array(size);
		this.imaginary = new Float64Array(size);
		this.window = new Float64Array(size);
		this.reverse = new Uint32Array(size);
		this.cosine = new Float64Array(size / 2);
		this.sine = new Float64Array(size / 2);
		const bits = Math.log2(size);
		for (let i = 0; i < size; i++) {
			let reversed = 0;
			for (let bit = 0; bit < bits; bit++) reversed = (reversed << 1) | ((i >> bit) & 1);
			this.reverse[i] = reversed;
			// FFT区間の周期窓。窓の総和で振幅を正規化する。
			const phase = 2 * Math.PI * i / size;
			const weight = windowName === 'hann' ? 0.5 - 0.5 * Math.cos(phase)
				: windowName === 'hamming' ? 0.54 - 0.46 * Math.cos(phase)
				: windowName === 'blackman' ? 0.42 - 0.5 * Math.cos(phase) + 0.08 * Math.cos(2 * phase) : 1;
			this.window[i] = weight;
			this.windowSum += weight;
			if (i < size / 2) {
				this.cosine[i] = Math.cos(phase);
				this.sine[i] = -Math.sin(phase);
			}
		}
	}

	public transform(sample: (index: number) => number, output: Float64Array) {
		const n = this.size;
		for (let i = 0; i < n; i++) {
			this.real[this.reverse[i]] = sample(i) * this.window[i];
			this.imaginary[i] = 0;
		}
		// in-place radix-2 FFT。作業領域は左右チャンネルで使い回す。
		for (let length = 2; length <= n; length *= 2) {
			const half = length / 2;
			const stride = n / length;
			for (let start = 0; start < n; start += length) {
				for (let j = 0; j < half; j++) {
					const even = start + j;
					const odd = even + half;
					const cosine = this.cosine[j * stride];
					const sine = this.sine[j * stride];
					const real = this.real[odd] * cosine - this.imaginary[odd] * sine;
					const imaginary = this.real[odd] * sine + this.imaginary[odd] * cosine;
					this.real[odd] = this.real[even] - real;
					this.imaginary[odd] = this.imaginary[even] - imaginary;
					this.real[even] += real;
					this.imaginary[even] += imaginary;
				}
			}
		}
		for (let i = 0; i < output.length; i++) {
			// 片側振幅スペクトラム。DCとNyquistは二倍にしない。
			const scale = (i === 0 || i === n / 2 ? 1 : 2) / this.windowSum;
			output[i] = Math.hypot(this.real[i], this.imaginary[i]) * scale;
		}
	}
}
