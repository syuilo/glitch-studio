// 525/59.94の1フィールドを、現在の入力が走査中は一定として処理する。
// 末尾の半ラインを覆うため263行を確保するが、時計・テープ位置は262.5Hで進める。
export const VHS_SIGNAL = {
	fieldRate: 60000 / 1001,
	linePeriod: 1001 / 15750000,
	lineCount: 263,
	fieldLineCount: 262.5,
	lineStateFloats: 16,
	activeLineStart: 20,
	activeLineCount: 240,
	activeStart: 10.5e-6,
	activeDuration: 51.5e-6,
	basebandSamples: 512,
	rfSamples: 2048,
	fmBlackFrequency: 3.4e6 + 0.4 / 1.4 * 1e6,
	fmDeviation: 1e6 / 1.4,
	fmReferenceFrequency: 3.9e6,
	chromaFrequency: 40.5 * 15750000 / 1001,
	emphasis: 1,
} as const;

const tapeTrackAngle = (5 + 58 / 60 + 9.9 / 3600) * Math.PI / 180;
const tapeSpeedMetersPerSecond = 0.03335;
const tapeRecordedWidthMeters = 0.01007;
const tapeScanLongitudinalLengthMeters = tapeRecordedWidthMeters / Math.tan(tapeTrackAngle);
const tapeScanLengthMeters = Math.hypot(tapeScanLongitudinalLengthMeters, tapeRecordedWidthMeters);

// NTSC SPの有効映像幅と走行速度。1フィールドごとのテープ送りをトラック法線へ
// 射影してピッチを求め、斜めの走査軌跡とTracking Offsetの単位を整合させる。
export const VHS_TAPE = {
	speedMetersPerSecond: tapeSpeedMetersPerSecond,
	recordedWidthMeters: tapeRecordedWidthMeters,
	scanLongitudinalLengthMeters: tapeScanLongitudinalLengthMeters,
	relativeSpeedMetersPerSecond: tapeScanLengthMeters * VHS_SIGNAL.fieldRate,
	trackTangent: [tapeScanLongitudinalLengthMeters / tapeScanLengthMeters, -tapeRecordedWidthMeters / tapeScanLengthMeters],
	trackPitchMeters: tapeSpeedMetersPerSecond / VHS_SIGNAL.fieldRate * Math.sin(tapeTrackAngle),
	trackNormal: [Math.sin(tapeTrackAngle), Math.cos(tapeTrackAngle)],
} as const;

export function createVhsTapeSurfaceMapping(settings: {
	fieldTime: number;
	lengthSeconds: number;
	offsetSeconds: number;
	horizontalInputScale: number;
	wrapPeriod: number | null;
}): [number, number, number, number] {
	const { fieldTime, lengthSeconds, offsetSeconds, horizontalInputScale, wrapPeriod } = settings;
	let textureOffset = (fieldTime - offsetSeconds) / lengthSeconds * horizontalInputScale;
	if (wrapPeriod != null) {
		// Fitを適用した後のUVで周期を折り返す。画面の縦横比やFitによって
		// repeatの周期を変えず、長時間のTimeもf32の巨大な座標へ変換しない。
		textureOffset -= Math.floor(textureOffset / wrapPeriod) * wrapPeriod;
	} else {
		// clamp/transparentは周期化しない。走査軌跡全体が画像の外にあるときだけ
		// 十分遠い座標へ制限し、長時間再生でも小さな局所変位の精度を保つ。
		const maximumLocalOffset = horizontalInputScale * (VHS_TAPE.scanLongitudinalLengthMeters + 4 * VHS_TAPE.trackPitchMeters) / (VHS_TAPE.speedMetersPerSecond * lengthSeconds);
		const limit = 2 + maximumLocalOffset;
		textureOffset = Math.min(limit, Math.max(-limit, textureOffset));
	}
	return [2 * textureOffset / horizontalInputScale, 2 / (VHS_TAPE.speedMetersPerSecond * lengthSeconds), 2 / VHS_TAPE.recordedWidthMeters, 0];
}

export type VhsTransportSettings = {
	time: number;
	seed: number;
	trackingOffset: number;
	trackAlignmentError: number;
	timeBaseError: number;
	scanTimingDrift: number;
	headContact: number;
	headSwitching: boolean;
	headTimingDifference: number;
};

function hash(value: number): number {
	let result = value >>> 0;
	result = Math.imul(result ^ (result >>> 16), 0x7feb352d);
	result = Math.imul(result ^ (result >>> 15), 0x846ca68b);
	return (result ^ (result >>> 16)) >>> 0;
}

function numberSeed(value: number): number {
	const bytes = new Float64Array([value]);
	const words = new Uint32Array(bytes.buffer);
	return hash(words[0] ^ hash(words[1]));
}

function smoothNoise(position: number, seed: number): number {
	const cell = Math.floor(position);
	const fraction = position - cell;
	const weight = fraction * fraction * (3 - 2 * fraction);
	const left = hash((cell >>> 0) ^ seed) / 4294967296;
	const right = hash(((cell + 1) >>> 0) ^ seed) / 4294967296;
	return (left * (1 - weight) + right * weight) * 2 - 1;
}

export function createVhsTransport(settings: VhsTransportSettings) {
	if (!Object.values(settings).every(value => typeof value === 'boolean' || Number.isFinite(value))) {
		throw new Error('VHS Playback: transport parameters must be finite.');
	}
	const field = Math.floor(settings.time * VHS_SIGNAL.fieldRate);
	// 倍精度でもフィールド番号を識別できなくなる時刻は受け付けない。
	if (!Number.isSafeInteger(field) || Math.abs(field) > Number.MAX_SAFE_INTEGER / 263) throw new Error('VHS Playback: Time exceeds the supported tape position.');
	const tapeLinePosition = field * VHS_SIGNAL.fieldLineCount;
	const tapeCell = Math.floor(tapeLinePosition);
	const tapeFraction = tapeLinePosition - tapeCell;
	const seed = numberSeed(settings.seed);
	const fieldSeed = hash(numberSeed(field) ^ seed);
	const fieldParity = ((field % 2) + 2) % 2;
	const sampleRate = VHS_SIGNAL.rfSamples / VHS_SIGNAL.linePeriod;
	const lineStates = new Float32Array(VHS_SIGNAL.lineCount * VHS_SIGNAL.lineStateFloats);
	const stateAt = (line: number) => {
		const progress = line / VHS_SIGNAL.fieldLineCount;
		const absoluteLine = tapeLinePosition + line;
		const jitter = smoothNoise(absoluteLine / 18, seed) + 0.15 * smoothNoise(absoluteLine / 1.7, seed ^ 0x326ab951);
		const headBlend = Math.min(1, Math.max(0, line - 255.5));
		const headOffset = settings.headSwitching ? (fieldParity === 0 ? headBlend : 1 - headBlend) * settings.headTimingDifference : 0;
		const delay = (jitter * settings.timeBaseError + (progress - 0.5) * settings.scanTimingDrift + headOffset) * 1e-6;
		// 幅が等しい記録トラックとヘッドの重なり。アライメント誤差は走査中に横断量を変える。
		const trackingDisplacement = settings.trackingOffset + settings.trackAlignmentError * (progress - 0.5);
		const overlap = Math.max(0, 1 - Math.abs(trackingDisplacement));
		const switchingContact = settings.headSwitching ? 1 - 0.9 * Math.exp(-(((line - 256) / 0.35) ** 2)) : 1;
		// 傷は記録された信号ではなく媒体の表面に固定される。時間軸誤差は軌跡に沿う移動、
		// トラッキングは軌跡に直交する移動として同じテープ面へ写し、両者を混同しない。
		// 長手方向の絶対位置はfieldTimeから別途加算し、GPUにはフィールド内の局所位置だけを渡す。
		const readProgress = progress + delay * VHS_SIGNAL.fieldRate;
		const trackingMeters = trackingDisplacement * VHS_TAPE.trackPitchMeters;
		return {
			delaySamples: delay * sampleRate,
			gain: overlap * Math.min(1, Math.max(0, settings.headContact)) * switchingContact,
			contact: Math.min(1, Math.max(0, settings.headContact)) * switchingContact,
			trackingDisplacement,
			tapePosition: [
				(readProgress - 0.5) * VHS_TAPE.scanLongitudinalLengthMeters + trackingMeters * VHS_TAPE.trackNormal[0],
				(0.5 - readProgress) * VHS_TAPE.recordedWidthMeters + trackingMeters * VHS_TAPE.trackNormal[1],
			],
		};
	};
	for (let line = 0; line < VHS_SIGNAL.lineCount; line++) {
		const start = stateAt(line);
		const end = stateAt(line + 1);
		// FMの画像依存の積分はGPUで別途加算する。搬送波の位相はCPUで周期へ折り返して
		// 渡し、長時間の再生でもf32の絶対時刻から細かな位相を計算しない。
		const carrierCycles = VHS_SIGNAL.fmBlackFrequency * VHS_SIGNAL.linePeriod * line;
		const chromaCycles = (40.5 + (fieldParity === 0 ? 0.25 : -0.25)) * line;
		lineStates.set([
			start.delaySamples, end.delaySamples, start.gain, end.gain,
			carrierCycles - Math.floor(carrierCycles), chromaCycles - Math.floor(chromaCycles), 0, 0,
			...start.tapePosition, ...end.tapePosition,
			start.contact, end.contact, start.trackingDisplacement, end.trackingDisplacement,
		], line * VHS_SIGNAL.lineStateFloats);
	}
	return { lineStates, seed, fieldSeed, tapeCell: tapeCell >>> 0, tapeFraction, fieldTime: field / VHS_SIGNAL.fieldRate };
}

/** 同じ係数を全GPU invocationで使う。搬送波を複素数へ抽出するFIRもここで生成する。 */
export function createVhsFilterCoefficients(): Float32Array {
	const values = new Float32Array(65 * 4);
	const sampleRate = VHS_SIGNAL.rfSamples / VHS_SIGNAL.linePeriod;
	const lowpass = (offset: number, cutoff: number) => {
		const normalized = 2 * cutoff / sampleRate;
		const sinc = offset === 0 ? normalized : Math.sin(Math.PI * normalized * offset) / (Math.PI * offset);
		return sinc * (0.54 + 0.46 * Math.cos(Math.PI * offset / 32));
	};
	let luminanceSum = 0;
	let chromaSum = 0;
	for (let offset = -32; offset <= 32; offset++) {
		luminanceSum += lowpass(offset, 2e6);
		chromaSum += lowpass(offset, 0.45e6);
	}
	for (let offset = -32; offset <= 32; offset++) {
		const luminancePhase = -2 * Math.PI * VHS_SIGNAL.fmReferenceFrequency * offset / sampleRate;
		const chromaPhase = -2 * Math.PI * VHS_SIGNAL.chromaFrequency * offset / sampleRate;
		const luminanceWeight = 2 * lowpass(offset, 2e6) / luminanceSum;
		const chromaWeight = 2 * lowpass(offset, 0.45e6) / chromaSum;
		values.set([luminanceWeight * Math.cos(luminancePhase), luminanceWeight * Math.sin(luminancePhase), chromaWeight * Math.cos(chromaPhase), chromaWeight * Math.sin(chromaPhase)], (offset + 32) * 4);
	}
	return values;
}
