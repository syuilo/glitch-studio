import { createFourierImageLayout } from '../../fourier/layout.ts';
import type { FourierResourceLimits } from '../../fourier/layout.ts';
import type definition from './_def_.ts';
import type { RuntimeEffectParameters } from '../../effect-implementation.ts';

type LayoutParameters = Pick<RuntimeEffectParameters<typeof definition.paramDefs>, 'processing' | 'boundary' | 'analysisResolution' | 'blockResolution' | 'blockSize' | 'sizeReference'>;

export function createPhaseScrambleLayout(params: LayoutParameters, resolution: { width: number; height: number }, limits: FourierResourceLimits) {
	try {
		return createFourierImageLayout({ ...params, analysisResolution: Number(params.analysisResolution), blockResolution: Number(params.blockResolution) }, resolution, limits);
	} catch (error) {
		if (error instanceof Error) throw new Error('Phase Scramble: ' + error.message, { cause: error });
		throw error;
	}
}

export type PhaseScrambleLayout = ReturnType<typeof createPhaseScrambleLayout>;

export function createPhaseScramblePasses(layout: PhaseScrambleLayout) {
	const passes: { kind: 'capture' | 'fft' | 'scramble'; source: number; destination: number; axis: number; span: number; inverse: number }[] = [
		{ kind: 'capture', source: 1, destination: 0, axis: 0, span: 0, inverse: 0 },
	];
	let source = 0;
	for (const inverse of [0, 1]) {
		if (inverse === 1) {
			passes.push({ kind: 'scramble', source, destination: 1 - source, axis: 0, span: 0, inverse: 0 });
			source = 1 - source;
		}
		for (const axis of [0, 1]) {
			for (let stage = 1; stage <= layout.logSize[axis]; stage++) {
				passes.push({ kind: 'fft', source, destination: 1 - source, axis, span: 2 ** stage, inverse });
				source = 1 - source;
			}
		}
	}
	return { passes, outputBuffer: source };
}
