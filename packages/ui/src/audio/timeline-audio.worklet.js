// デコード・式評価はWorkerへ任せ、ここでは準備済みPCMの消費だけを行う。
class TimelineAudioProcessor extends AudioWorkletProcessor {
	constructor() {
		super();
		this.queue = [];
		this.offset = 0;
		this.played = 0;
		this.buffered = 0;
		this.waiting = true;
		this.disposed = false;
		this.lastClockFrame = -Infinity;
		this.wasWaiting = null;
		this.port.onmessage = ({ data }) => {
			if (data.type === 'dispose') { this.disposed = true; this.queue = []; }
			if (data.type === 'pcm') {
				this.queue.push(data.channels);
				this.buffered += data.channels[0].length;
			}
		};
	}

	process(inputs, outputs) {
		if (this.disposed) return false;
		const output = outputs[0];
		const count = output[0].length;
		// 欠損時に時計だけ進めない。再開時も一定量を先読みして連続した音声を届ける。
		if (this.waiting && this.buffered >= sampleRate / 4) this.waiting = false;
		if (this.buffered < count) this.waiting = true;
		if (this.wasWaiting !== this.waiting || currentFrame - this.lastClockFrame >= sampleRate / 50) {
			this.port.postMessage({ type: 'clock', contextFrame: currentFrame, playedFrames: this.played, running: !this.waiting });
			this.lastClockFrame = currentFrame;
			this.wasWaiting = this.waiting;
		}
		if (this.waiting) return true;
		for (let frame = 0; frame < count; frame++) {
			const channels = this.queue[0];
			output[0][frame] = channels[0][this.offset];
			output[1][frame] = channels[1][this.offset];
			this.offset++;
			if (this.offset === channels[0].length) {
				this.queue.shift();
				this.offset = 0;
				this.port.postMessage({ type: 'pull' });
			}
		}
		this.played += count;
		this.buffered -= count;
		return true;
	}
}

registerProcessor('glitch-timeline-audio', TimelineAudioProcessor);
