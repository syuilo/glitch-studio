import accumulate from './effects/accumulate/_def_.ts';
import audioWaveform from './effects/audioWaveform/_def_.ts';
import audioSpectrum from './effects/audioSpectrum/_def_.ts';
import audioSpectrogram from './effects/audioSpectrogram/_def_.ts';
import bloom from './effects/bloom/_def_.ts';
import blur from './effects/blur/_def_.ts';
import blockShuffle from './effects/blockShuffle/_def_.ts';
import channelShift from './effects/channelShift/_def_.ts';
import chromaticAberration from './effects/chromaticAberration/_def_.ts';
import colorBlocks from './effects/colorBlocks/_def_.ts';
import fill from './effects/fill/_def_.ts';
import frameDifference from './effects/frameDifference/_def_.ts';
import gradient from './effects/gradient/_def_.ts';
import histogram from './effects/histogram/_def_.ts';
import image from './effects/image/_def_.ts';
import liquidMetal from './effects/liquidMetal/_def_.ts';
import lcd from './effects/lcd/_def_.ts';
import multiply from './effects/multiply/_def_.ts';
import remap from './effects/remap/_def_.ts';
import opticalFlow from './effects/opticalFlow/_def_.ts';
import vectorDisplacement from './effects/vectorDisplacement/_def_.ts';
import pixelSort from './effects/pixelSort/_def_.ts';
import quadtreeFilter from './effects/quadtreeFilter/_def_.ts';
import rainDropsOnWindow1 from './effects/rainDropsOnWindow1/_def_.ts';
import rainDropsOnWindow2 from './effects/rainDropsOnWindow2/_def_.ts';
import rgbTo from './effects/rgbTo/_def_.ts';
import snoise from './effects/snoise/_def_.ts';
import symbols from './effects/symbols/_def_.ts';
import tearings from './effects/tearings/_def_.ts';
import test from './effects/test/_def_.ts';
import transform from './effects/transform/_def_.ts';
import video from './effects/video/_def_.ts';
import water from './effects/water/_def_.ts';
import waveform from './effects/waveform/_def_.ts';
import pointerTrail from './effects/pointerTrail/_def_.ts';
import colorBlend from './effects/colorBlend/_def_.ts';
import colorMix from './effects/colorMix/_def_.ts';
import dataBlend from './effects/dataBlend/_def_.ts';
import dataMix from './effects/dataMix/_def_.ts';
import drosteRegression from './effects/drosteRegression/_def_.ts';
import testStructArray from './effects/testStructArray/_def_.ts';
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
	testStructArray,
} as Record<string, Omit<EffectDefinition<any>, 'paramDefs'> & { paramDefs: EffectParamDefs }>;

const effectDefinitions = {} as typeof _effectDefinitions;
Object.keys(_effectDefinitions).sort().forEach(key => {
	effectDefinitions[key] = _effectDefinitions[key];
});

export { effectDefinitions };
