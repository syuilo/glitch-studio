import { FULL_PREVIEW_IMAGE_ANALYSIS_VIEWPORT } from '@gs/glitch-studio_shared/preview-image-analysis-viewport.ts';
import { createImageValueAxisTicks } from '@/utility/image-analysis-axis.ts';
import { selectImageAnalysisViewport } from '@/utility/image-analysis-viewport.ts';
import type { SpectrogramViewport } from '@gs/subsystems_audio_spectrogram-renderer/spectrogram-renderer.ts';
import type { SpectrogramSettings } from '@gs/subsystems_audio_spectrogram-renderer/spectrogram-settings.ts';
import type { ImageAnalysisAxisTick } from '@/utility/image-analysis-axis.ts';

function getTimeAxis(settings: SpectrogramSettings) {
	const isHorizontal = settings.orientation === 'horizontal';
	const isReversed = settings.direction === 'reverse';
	return { isHorizontal, latestAtStart: isHorizontal ? isReversed : !isReversed };
}

export function followLatestSpectrogramTime(viewport: SpectrogramViewport, settings: SpectrogramSettings): SpectrogramViewport {
	const { isHorizontal, latestAtStart } = getTimeAxis(settings);
	return isHorizontal ? { ...viewport, x: latestAtStart ? 0 : 1 - viewport.width }
		: { ...viewport, y: latestAtStart ? 0 : 1 - viewport.height };
}

function getFrequencyAxis(settings: SpectrogramSettings, viewport: SpectrogramViewport) {
	const { minFrequency, maxFrequency, logarithmic } = settings;
	const isHorizontal = settings.orientation !== 'horizontal';
	const highAtStart = isHorizontal ? settings.flipFrequency : !settings.flipFrequency;
	const start = isHorizontal ? viewport.x : viewport.y;
	const span = isHorizontal ? viewport.width : viewport.height;
	const lanes = settings.channel === 'stereo' ? 2 : 1;
	const logRatio = logarithmic ? Math.log(maxFrequency / minFrequency) : 0;

	// シェーダーと同様に、表示範囲の座標を各チャンネルの周波数へ換算する。
	function frequencyAt(position: number, lane: number) {
		const lanePosition = Math.max(0, Math.min(1, position * lanes - lane));
		const ratio = highAtStart ? 1 - lanePosition : lanePosition;
		return logarithmic ? minFrequency * Math.exp(logRatio * ratio) : minFrequency + (maxFrequency - minFrequency) * ratio;
	}

	function positionOf(frequency: number, lane: number) {
		const ratio = logarithmic ? Math.log(frequency / minFrequency) / logRatio : (frequency - minFrequency) / (maxFrequency - minFrequency);
		const clamped = Math.max(0, Math.min(1, ratio));
		return (lane + (highAtStart ? 1 - clamped : clamped)) / lanes;
	}

	// 境界では横向きの上または縦向きの右を選び、シェーダーが表示している値を返す。
	const laneAt = (position: number) => Math.max(0, Math.min(lanes - 1, isHorizontal ? Math.floor(position * lanes) : Math.ceil(position * lanes) - 1));
	return { isHorizontal, start, span, lanes, laneAt, frequencyAt, positionOf };
}

export function reprojectSpectrogramFrequencyViewport(viewport: SpectrogramViewport, settings: SpectrogramSettings, nextSettings: SpectrogramSettings): SpectrogramViewport {
	const axis = getFrequencyAxis(settings, viewport);
	if (axis.span === 1) return viewport;
	const nextAxis = getFrequencyAxis(nextSettings, viewport);
	const reproject = (position: number) => {
		const lane = axis.laneAt(position);
		return nextAxis.positionOf(axis.frequencyAt(position, lane), lane);
	};
	const start = reproject(axis.start);
	const span = reproject(axis.start + axis.span) - start;
	const selection = axis.isHorizontal ? { ...viewport, x: start, width: span } : { ...viewport, y: start, height: span };
	return selectImageAnalysisViewport(FULL_PREVIEW_IMAGE_ANALYSIS_VIEWPORT, selection);
}

function frequencyLabel(value: number): string {
	return value >= 1000 ? `${Number((value / 1000).toPrecision(4))} kHz` : `${Number(value.toPrecision(4))} Hz`;
}

function timeLabel(value: number): string {
	const seconds = Number(Math.abs(value).toFixed(3));
	return `${value < 0 && seconds > 0 ? '−' : ''}${seconds} s`;
}

function logarithmicTicks(minimum: number, maximum: number): number[] {
	const values: number[] = [];
	for (let exponent = Math.floor(Math.log10(minimum)); exponent <= Math.floor(Math.log10(maximum)); exponent++) {
		for (const unit of [1, 2, 5]) {
			const frequency = unit * 10 ** exponent;
			if (frequency > minimum && frequency < maximum) values.push(frequency);
		}
	}
	return values;
}

function createFrequencyTicks(settings: SpectrogramSettings, axis: ReturnType<typeof getFrequencyAxis>): ImageAnalysisAxisTick[] {
	const ticks: ImageAnalysisAxisTick[] = [];
	for (let lane = 0; lane < axis.lanes; lane++) {
		const start = Math.max(axis.start, lane / axis.lanes);
		const end = Math.min(axis.start + axis.span, (lane + 1) / axis.lanes);
		if (end <= start) continue;
		const first = axis.frequencyAt(start, lane);
		const last = axis.frequencyAt(end, lane);
		if (start === axis.start) ticks.push({ value: first, position: 0, label: frequencyLabel(first), isReference: false });
		if (end === axis.start + axis.span) ticks.push({ value: last, position: 1, label: frequencyLabel(last), isReference: false });
		const minimum = Math.min(first, last);
		const maximum = Math.max(first, last);
		// 拡大して1オクターブ未満になったら、対数軸でも読みやすいHz値に補助目盛りを打つ。
		const values = settings.logarithmic && maximum / minimum >= 2 ? logarithmicTicks(minimum, maximum)
			: createImageValueAxisTicks('linear', { minimum, maximum }, 'float64').slice(1, -1).map(tick => tick.value);
		for (const value of values) {
			const position = (axis.positionOf(value, lane) - axis.start) / axis.span;
			ticks.push({ value, position, label: frequencyLabel(value), isReference: false });
		}
	}
	return ticks;
}

export function createSpectrogramAxes(settings: SpectrogramSettings, viewport: SpectrogramViewport) {
	const { isHorizontal, latestAtStart } = getTimeAxis(settings);
	const timeStart = isHorizontal ? viewport.x : viewport.y;
	const timeSpan = isHorizontal ? viewport.width : viewport.height;
	const timeAt = (position: number) => {
		const fullPosition = timeStart + position * timeSpan;
		return -(latestAtStart ? fullPosition : 1 - fullPosition) * settings.duration;
	};
	const time = {
		ticks: createImageValueAxisTicks('linear', { minimum: timeAt(0), maximum: timeAt(1) }, 'float64')
			.map(tick => ({ ...tick, label: timeLabel(tick.value) })),
		labelAt: (position: number) => timeLabel(timeAt(position)),
	};
	const frequencyAxis = getFrequencyAxis(settings, viewport);
	const frequency = {
		ticks: createFrequencyTicks(settings, frequencyAxis),
		labelAt(position: number) {
			const fullPosition = frequencyAxis.start + position * frequencyAxis.span;
			return frequencyLabel(frequencyAxis.frequencyAt(fullPosition, frequencyAxis.laneAt(fullPosition)));
		},
	};
	return isHorizontal ? { x: time, y: frequency } : { x: frequency, y: time };
}
