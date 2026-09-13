import accumulate from './fx-implementations/accumulate/main.ts';
import colorBlend from './fx-implementations/colorBlend/main.ts';
import colorMix from './fx-implementations/colorMix/main.ts';
import dataBlend from './fx-implementations/dataBlend/main.ts';
import dataMix from './fx-implementations/dataMix/main.ts';
import drosteRegression from './fx-implementations/drosteRegression/main.ts';
import audioWaveform from './fx-implementations/audioWaveform/main.ts';
import audioSpectrum from './fx-implementations/audioSpectrum/main.ts';
import audioSpectrogram from './fx-implementations/audioSpectrogram/main.ts';
import bloom from './fx-implementations/bloom/main.ts';
import blur from './fx-implementations/blur/main.ts';
import blockShuffle from './fx-implementations/blockShuffle/main.ts';
import channelShift from './fx-implementations/channelShift/main.ts';
import chromaticAberration from './fx-implementations/chromaticAberration/main.ts';
import colorBlocks from './fx-implementations/colorBlocks/main.ts';
import fill from './fx-implementations/fill/main.ts';
import frameDifference from './fx-implementations/frameDifference/main.ts';
import gradient from './fx-implementations/gradient/main.ts';
import histogram from './fx-implementations/histogram/main.ts';
import image from './fx-implementations/image/main.ts';
import lcd from './fx-implementations/lcd/main.ts';
import liquidMetal from './fx-implementations/liquidMetal/main.ts';
import multiply from './fx-implementations/multiply/main.ts';
import opticalFlow from './fx-implementations/opticalFlow/main.ts';
import vectorDisplacement from './fx-implementations/vectorDisplacement/main.ts';
import pixelSort from './fx-implementations/pixelSort/main.ts';
import quadtreeFilter from './fx-implementations/quadtreeFilter/main.ts';
import rainDropsOnWindow1 from './fx-implementations/rainDropsOnWindow1/main.ts';
import rainDropsOnWindow2 from './fx-implementations/rainDropsOnWindow2/main.ts';
import rgbTo from './fx-implementations/rgbTo/main.ts';
import shift from './fx-implementations/shift/main.ts';
import snoise from './fx-implementations/snoise/main.ts';
import symbols from './fx-implementations/symbols/main.ts';
import tearings from './fx-implementations/tearings/main.ts';
import test from './fx-implementations/test/main.ts';
import video from './fx-implementations/video/main.ts';
import water from './fx-implementations/water/main.ts';
import waveform from './fx-implementations/waveform/main.ts';
import pointerTrail from './fx-implementations/pointerTrail/main.ts';
import type { EffectImplementation } from './fx-implementation.ts';

const _fxImplementations = {
	colorBlend,
	colorMix,
	dataBlend,
	dataMix,
	drosteRegression,
	audioWaveform,
	audioSpectrum,
	audioSpectrogram,
	accumulate,
	bloom,
	blur,
	blockShuffle,
	channelShift,
	chromaticAberration,
	colorBlocks,
	fill,
	frameDifference,
	gradient,
	histogram,
	image,
	lcd,
	liquidMetal,
	multiply,
	opticalFlow,
	vectorDisplacement,
	pixelSort,
	quadtreeFilter,
	rainDropsOnWindow1,
	rainDropsOnWindow2,
	rgbTo,
	shift,
	snoise,
	symbols,
	tearings,
	test,
	video,
	water,
	waveform,
	pointerTrail,
} as Record<string, EffectImplementation<any>>;

const fxImplementations = {} as typeof _fxImplementations;
Object.keys(_fxImplementations).sort().forEach(key => {
	fxImplementations[key] = _fxImplementations[key];
});

export { fxImplementations };
