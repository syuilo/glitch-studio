import accumulate from './effects/accumulate/_impl_.ts';
import colorBlend from './effects/colorBlend/_impl_.ts';
import colorMix from './effects/colorMix/_impl_.ts';
import dataBlend from './effects/dataBlend/_impl_.ts';
import dataMix from './effects/dataMix/_impl_.ts';
import drosteRegression from './effects/drosteRegression/_impl_.ts';
import audioWaveform from './effects/audioWaveform/_impl_.ts';
import audioSpectrum from './effects/audioSpectrum/_impl_.ts';
import audioSpectrogram from './effects/audioSpectrogram/_impl_.ts';
import bloom from './effects/bloom/_impl_.ts';
import blur from './effects/blur/_impl_.ts';
import blockShuffle from './effects/blockShuffle/_impl_.ts';
import channelShift from './effects/channelShift/_impl_.ts';
import chromaticAberration from './effects/chromaticAberration/_impl_.ts';
import colorBlocks from './effects/colorBlocks/_impl_.ts';
import fill from './effects/fill/_impl_.ts';
import frameDifference from './effects/frameDifference/_impl_.ts';
import gradient from './effects/gradient/_impl_.ts';
import scalarGradient from './effects/scalarGradient/_impl_.ts';
import composeVector from './effects/composeVector/_impl_.ts';
import histogram from './effects/histogram/_impl_.ts';
import image from './effects/image/_impl_.ts';
import lcd from './effects/lcd/_impl_.ts';
import liquidMetal from './effects/liquidMetal/_impl_.ts';
import multiply from './effects/multiply/_impl_.ts';
import remap from './effects/remap/_impl_.ts';
import opticalFlow from './effects/opticalFlow/_impl_.ts';
import vectorDisplacement from './effects/vectorDisplacement/_impl_.ts';
import pixelSort from './effects/pixelSort/_impl_.ts';
import polkadot from './effects/polkadot/_impl_.ts';
import quadtreeFilter from './effects/quadtreeFilter/_impl_.ts';
import rainDropsOnWindow1 from './effects/rainDropsOnWindow1/_impl_.ts';
import rainDropsOnWindow2 from './effects/rainDropsOnWindow2/_impl_.ts';
import rgbTo from './effects/rgbTo/_impl_.ts';
import snoise from './effects/snoise/_impl_.ts';
import symbols from './effects/symbols/_impl_.ts';
import tearings from './effects/tearings/_impl_.ts';
import test from './effects/test/_impl_.ts';
import transform from './effects/transform/_impl_.ts';
import video from './effects/video/_impl_.ts';
import videoFrame from './effects/videoFrame/_impl_.ts';
import water from './effects/water/_impl_.ts';
import waveform from './effects/waveform/_impl_.ts';
import pointerTrail from './effects/pointerTrail/_impl_.ts';
import testStructArray from './effects/testStructArray/_impl_.ts';
import type { EffectImplementation } from '@glitch/shared/effect-implementation.js';

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
	scalarGradient,
	composeVector,
	histogram,
	image,
	lcd,
	liquidMetal,
	multiply,
	remap,
	opticalFlow,
	vectorDisplacement,
	pixelSort,
	polkadot,
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
	videoFrame,
	water,
	waveform,
	pointerTrail,
	testStructArray,
} as Record<string, EffectImplementation<any>>;

const effectImplementations = {} as typeof _effectImplementations;
Object.keys(_effectImplementations).sort().forEach(key => {
	effectImplementations[key] = _effectImplementations[key];
});

export { effectImplementations };
