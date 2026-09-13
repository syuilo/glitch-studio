// 音声スレッドではFFTや待機を行わない。転送バッファが尽きた場合は可視化だけを欠落させる。
class AudioCaptureProcessor extends AudioWorkletProcessor {
	constructor() {
		super();
		this.stream = null;
		this.pool = [];
		this.samples = null;
		this.offset = 0;
		this.startFrame = 0;
		this.channelCount = 0;
		this.generation = 0;
		this.active = false;
		this.disposed = false;
		this.meterFrames = 0;
		this.meterLeft = 0;
		this.meterRight = 0;
		this.meterPending = false;
		this.meterGeneration = 0;
		this.meterPort = null;
		this.port.onmessage = ({ data }) => {
			if (data.type === 'meterState') {
				this.meterGeneration = data.generation;
				this.meterFrames = 0;
				this.meterLeft = this.meterRight = 0;
			}
			if (data.type === 'meter') {
				this.meterPort = data.port;
				this.meterPort.onmessage = () => { this.meterPending = false; };
			}
			if (data.type === 'dispose') {
				this.disposed = true;
				this.stream?.close();
				this.meterPort?.close();
				this.samples = null;
				this.pool = [];
				return;
			}
			if (data.type === 'connect') {
				this.stream = data.port;
				this.stream.onmessage = ({ data: returned }) => {
					if (returned.type === 'recycle') this.pool.push(new Float32Array(returned.buffer));
				};
				for (let i = 0; i < 8; i++) this.pool.push(new Float32Array(2048));
			}
			if (data.type === 'state') {
				this.meterGeneration = data.meterGeneration;
				this.meterFrames = 0;
				this.meterLeft = this.meterRight = 0;
				this.active = data.active;
				this.offset = 0;
				if (this.samples) this.pool.push(this.samples);
				this.samples = null;
				if (this.generation !== data.generation) {
					this.generation = data.generation;
					this.stream?.postMessage({ type: 'reset', generation: this.generation });
				}
			}
		};
	}

	process(inputs, outputs) {
		if (this.disposed) return false;
		const channels = inputs[0];
		// PCM転送用バッファの空きに依存せず、音量調整前の入力ピークを計測する。
		if (this.active) {
			const frames = channels?.[0]?.length ?? outputs[0][0].length;
			for (let i = 0; i < (channels?.[0]?.length ?? 0); i++) {
				this.meterLeft = Math.max(this.meterLeft, Math.abs(channels[0][i]));
				this.meterRight = Math.max(this.meterRight, Math.abs(channels[1]?.[i] ?? 0));
			}
			this.meterFrames += frames;
			if (this.meterFrames >= sampleRate / 30) {
				// UIが停止していても通知を積み上げない。
				if (this.meterPort && !this.meterPending) {
					this.meterPending = true;
					this.meterPort.postMessage({ type: 'levels', generation: this.meterGeneration, left: this.meterLeft, right: this.meterRight });
					this.meterLeft = this.meterRight = 0;
				}
				this.meterFrames = 0;
			}
		}
		if (!this.active || !this.stream) {
			this.offset = 0;
			return true;
		}
		// 接続元が無音で入力配列が空になっても、プレビューの時間と無音波形を進める。
		const count = Math.min(2, channels?.length || this.channelCount || 1);
		if (count !== this.channelCount) {
			this.channelCount = count;
			this.offset = 0;
		}
		// レンダークォンタムの長さを128に固定しない。
		for (let i = 0; i < (channels?.[0]?.length ?? outputs[0][0].length); i++) {
			if (!this.samples) {
				this.samples = this.pool.pop();
				if (!this.samples) break;
			}
			if (this.offset === 0) this.startFrame = currentFrame + i;
			this.samples[this.offset] = channels?.[0]?.[i] ?? 0;
			this.samples[1024 + this.offset] = channels?.[1]?.[i] ?? 0;
			this.offset++;
			if (this.offset === 1024) {
				const buffer = this.samples.buffer;
				this.stream.postMessage({ type: 'samples', generation: this.generation,
					startFrame: this.startFrame, sampleRate, channelCount: count, frameCount: 1024, buffer }, [buffer]);
				this.samples = null;
				this.offset = 0;
			}
		}
		// 出力は無音。実際の再生経路はこのWorkletを経由させない。
		return true;
	}
}

registerProcessor('glitch-audio-capture', AudioCaptureProcessor);
