import accumulate from './effect-definitions/accumulate.ts';
import audioWaveform from './effect-definitions/audioWaveform.ts';
import audioSpectrum from './effect-definitions/audioSpectrum.ts';
import audioSpectrogram from './effect-definitions/audioSpectrogram.ts';
import bloom from './effect-definitions/bloom.ts';
import blur from './effect-definitions/blur.ts';
import blockShuffle from './effect-definitions/blockShuffle.ts';
import channelShift from './effect-definitions/channelShift.ts';
import chromaticAberration from './effect-definitions/chromaticAberration.ts';
import colorBlocks from './effect-definitions/colorBlocks.ts';
import fill from './effect-definitions/fill.ts';
import frameDifference from './effect-definitions/frameDifference.ts';
import gradient from './effect-definitions/gradient.ts';
import histogram from './effect-definitions/histogram.ts';
import image from './effect-definitions/image.ts';
import liquidMetal from './effect-definitions/liquidMetal.ts';
import lcd from './effect-definitions/lcd.ts';
import multiply from './effect-definitions/multiply.ts';
import remap from './effect-definitions/remap.ts';
import opticalFlow from './effect-definitions/opticalFlow.ts';
import vectorDisplacement from './effect-definitions/vectorDisplacement.ts';
import pixelSort from './effect-definitions/pixelSort.ts';
import quadtreeFilter from './effect-definitions/quadtreeFilter.ts';
import rainDropsOnWindow1 from './effect-definitions/rainDropsOnWindow1.ts';
import rainDropsOnWindow2 from './effect-definitions/rainDropsOnWindow2.ts';
import rgbTo from './effect-definitions/rgbTo.ts';
import shift from './effect-definitions/shift.ts';
import snoise from './effect-definitions/snoise.ts';
import symbols from './effect-definitions/symbols.ts';
import tearings from './effect-definitions/tearings.ts';
import test from './effect-definitions/test.ts';
import transform from './effect-definitions/transform.ts';
import video from './effect-definitions/video.ts';
import water from './effect-definitions/water.ts';
import waveform from './effect-definitions/waveform.ts';
import pointerTrail from './effect-definitions/pointerTrail.ts';
import colorBlend from './effect-definitions/colorBlend.ts';
import colorMix from './effect-definitions/colorMix.ts';
import dataBlend from './effect-definitions/dataBlend.ts';
import dataMix from './effect-definitions/dataMix.ts';
import drosteRegression from './effect-definitions/drosteRegression.ts';
import type { EffectDefinition } from './effect-definition.ts';
import type { EffectParamDefs } from '@glitch/shared/types.ts';

const _effectDefinitions = {
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
	colorBlend,
	colorMix,
	dataBlend,
	dataMix,
	drosteRegression,
} as Record<string, Omit<EffectDefinition<any>, 'paramDefs'> & { paramDefs: EffectParamDefs }>;

const effectDefinitions = {} as typeof _effectDefinitions;
Object.keys(_effectDefinitions).sort().forEach(key => {
	effectDefinitions[key] = _effectDefinitions[key];
});

export { effectDefinitions };
