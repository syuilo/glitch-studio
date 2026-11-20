import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import { createFullscreenEffect } from '../../fullscreen-effect.ts';
import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import { getCellSubdivisionLevels } from '../../cell-subdivision.ts';
import code, { uniforms as codeUniforms } from './shader.shader.ts?shader';
import type definition from './_def_.ts';

const cellWrapModes = { transparent: 0, clamp: 1, repeat: 2, repeatMirrored: 3 };

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(context) {
		const { device, inputs, resolution } = context;
		const uniformValues = createShaderBuffer(codeUniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const bindGroup = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		const { width, height } = resolution;
		const shortDimension = Math.min(width, height);
		const aspect = [width / shortDimension, height / shortDimension] as const;
		const canvasUnitScale = Math.max(width, height) / shortDimension;
		const referenceSize = { width: 1, height: 1 };
		uniformValues.set({ aspect });
		return createFullscreenEffect(context, {
			code,
			schema: {
				inputs: { array: 'color' },
				densityMap: 'scalar',
				perCellSelection: 'scalar',
				perCellOpacity: 'scalar',
				perCellTranslation: 'vector',
				perCellScale: 'vector',
				perCellRotation: 'scalar',
			},
			inputs,
			// セル境界・素材の選択・切り取りで参照先が不連続になるため、LODを明示する。
			sampling: 'level0',
			internalLayouts: [layout],
			samplingOverrides: { referenceResolutions: { inputs: referenceSize } },
			bindResources(pass) {
				const translationUnit = inputs.translationUnit.value;
				const controlSamples = inputs.controlSamples.value;
				const sizeReference = inputs.sizeReference.value;
				const angle = inputs.angle.value;
				const phase = inputs.phase.value;
				const frequency = inputs.frequency.value;
				const maxSubdivisionLevels = getCellSubdivisionLevels(inputs.subdivisionMode.value, inputs.maxSubdivisionLevels.value);
				const referenceExtent = getSizeReferenceLength(sizeReference, resolution);
				// Grid系と同じ基準領域を使う。1周期は1セルで、1未満のFrequencyも許可する。
				const cellWidth = referenceExtent / (Number.isFinite(frequency[0]) ? Math.max(0.01, frequency[0]) : 0.01);
				const cellHeight = referenceExtent / (Number.isFinite(frequency[1]) ? Math.max(0.01, frequency[1]) : 0.01);
				const cellSize = [cellWidth / shortDimension, cellHeight / shortDimension] as const;
				uniformValues.set({
					cellSize,
					translationUnitScale: translationUnit === 'canvas' ? [canvasUnitScale, canvasUnitScale] : cellSize,
					phase: phase.map(value => Number.isFinite(value) ? value : 0),
					angle: Number.isFinite(angle) ? angle * 2 * Math.PI : 0,
					controlSamples: Number.isFinite(controlSamples) ? Math.min(256, Math.max(1, Math.round(controlSamples))) : 1,
					cellWrapMode: cellWrapModes[inputs.cellWrapMode.value],
					maxSubdivisionLevels,
					translationUsesCellUnits: Number(translationUnit === 'cell'),
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				// 素材のFitは変形前のセルを基準とし、制御用の場は出力画面を基準とする。
				// Adaptiveの四分割は縦横を同率で縮めるため、分割後のセルでも基本セルと同じFitを使える。
				referenceSize.width = cellWidth;
				referenceSize.height = cellHeight;
				pass.setBindGroup(0, bindGroup);
			},
			disposeResources() { uniformBuffer.destroy(); },
		});
	},
};

export default implementation;
