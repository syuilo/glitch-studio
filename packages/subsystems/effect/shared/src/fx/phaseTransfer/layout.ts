import { createFourierImageLayout } from '../../fourier/layout.ts';
import type { FourierResourceLimits, FourierImageLayout } from '../../fourier/layout.ts';
import type definition from './_def_.ts';
import type { RuntimeEffectParameters } from '../../effect-implementation.ts';

type LayoutParameters = Pick<RuntimeEffectParameters<typeof definition.paramDefs>, 'processing' | 'boundary' | 'analysisResolution' | 'blockResolution' | 'blockSize' | 'sizeReference'>;

export function createPhaseTransferLayout(params: LayoutParameters, resolution: { width: number; height: number }, limits: FourierResourceLimits) {
	try {
		return createFourierImageLayout({ ...params, analysisResolution: Number(params.analysisResolution), blockResolution: Number(params.blockResolution) }, resolution, limits);
	} catch (error) {
		if (error instanceof Error) throw new Error('Phase Transfer: ' + error.message, { cause: error });
		throw error;
	}
}

type FourierPass = { kind: 'fft'; source: number; destination: number; axis: number; span: number; inverse: number };
type TransferPass = { kind: 'transfer'; source: number; reference: number; destination: number };
type CapturePass = { kind: 'capture'; source: number; destination: number; referenceInput: boolean };

export function createPhaseTransferPasses(layout: FourierImageLayout) {
	const passes: (FourierPass | TransferPass | CapturePass)[] = [{ kind: 'capture', source: 1, destination: 0, referenceInput: false }];
	const transform = (start: number, spare: number, inverse: number) => {
		let source = start;
		let destination = spare;
		for (const axis of [0, 1]) {
			for (let stage = 1; stage <= layout.logSize[axis]; stage++) {
				passes.push({ kind: 'fft', source, destination, axis, span: 2 ** stage, inverse });
				[source, destination] = [destination, source];
			}
		}
		return source;
	};
	const inputSpectrum = transform(0, 1, 0);
	passes.push({ kind: 'capture', source: inputSpectrum, destination: 2, referenceInput: true });
	// 主入力のスペクトルを保持したまま、残る二つのbufferで副入力を変換する。
	// 位相移植が済めば主入力のbufferも再利用でき、計三つで全処理を賄える。
	const referenceSpectrum = transform(2, 1 - inputSpectrum, 0);
	const difference = 3 - inputSpectrum - referenceSpectrum;
	passes.push({ kind: 'transfer', source: inputSpectrum, reference: referenceSpectrum, destination: difference });
	const outputBuffer = transform(difference, inputSpectrum, 1);
	return { passes, outputBuffer };
}
