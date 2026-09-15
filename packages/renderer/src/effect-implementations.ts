import accumulate from './effect-implementations/accumulate/main.ts';
import colorBlend from './effect-implementations/colorBlend/main.ts';
import colorMix from './effect-implementations/colorMix/main.ts';
import dataBlend from './effect-implementations/dataBlend/main.ts';
import dataMix from './effect-implementations/dataMix/main.ts';
import drosteRegression from './effect-implementations/drosteRegression/main.ts';
import audioWaveform from './effect-implementations/audioWaveform/main.ts';
import audioSpectrum from './effect-implementations/audioSpectrum/main.ts';
import audioSpectrogram from './effect-implementations/audioSpectrogram/main.ts';
import bloom from './effect-implementations/bloom/main.ts';
import blur from './effect-implementations/blur/main.ts';
import blockShuffle from './effect-implementations/blockShuffle/main.ts';
import channelShift from './effect-implementations/channelShift/main.ts';
import chromaticAberration from './effect-implementations/chromaticAberration/main.ts';
import colorBlocks from './effect-implementations/colorBlocks/main.ts';
import fill from './effect-implementations/fill/main.ts';
import frameDifference from './effect-implementations/frameDifference/main.ts';
import gradient from './effect-implementations/gradient/main.ts';
import histogram from './effect-implementations/histogram/main.ts';
import image from './effect-implementations/image/main.ts';
import lcd from './effect-implementations/lcd/main.ts';
import liquidMetal from './effect-implementations/liquidMetal/main.ts';
import multiply from './effect-implementations/multiply/main.ts';
import remap from './effect-implementations/remap/main.ts';
import opticalFlow from './effect-implementations/opticalFlow/main.ts';
import vectorDisplacement from './effect-implementations/vectorDisplacement/main.ts';
import pixelSort from './effect-implementations/pixelSort/main.ts';
import quadtreeFilter from './effect-implementations/quadtreeFilter/main.ts';
import rainDropsOnWindow1 from './effect-implementations/rainDropsOnWindow1/main.ts';
import rainDropsOnWindow2 from './effect-implementations/rainDropsOnWindow2/main.ts';
import rgbTo from './effect-implementations/rgbTo/main.ts';
import shift from './effect-implementations/shift/main.ts';
import snoise from './effect-implementations/snoise/main.ts';
import symbols from './effect-implementations/symbols/main.ts';
import tearings from './effect-implementations/tearings/main.ts';
import test from './effect-implementations/test/main.ts';
import transform from './effect-implementations/transform/main.ts';
import video from './effect-implementations/video/main.ts';
import water from './effect-implementations/water/main.ts';
import waveform from './effect-implementations/waveform/main.ts';
import pointerTrail from './effect-implementations/pointerTrail/main.ts';
import type { EffectImplementation } from './effect-implementation.ts';

const _effectImplementations = {
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
	remap,
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
	transform,
	video,
	water,
	waveform,
	pointerTrail,
} as Record<string, EffectImplementation<any>>;

const effectImplementations = {} as typeof _effectImplementations;
Object.keys(_effectImplementations).sort().forEach(key => {
	effectImplementations[key] = _effectImplementations[key];
});

export { effectImplementations };
