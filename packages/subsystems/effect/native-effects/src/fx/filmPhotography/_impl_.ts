import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import { createFullscreenEffect } from '../../fullscreen-effect.ts';
import { createFilmPhotographyModel, DEFAULT_SETTINGS, packFilmPhotographyModel } from './model.ts';
import { SPECTRAL_TRIANGLES } from './spectral.ts';
import shaderCode from './shader.wgsl?raw';
import type definition from './_def_.ts';

const code = `const SPECTRAL_TRIANGLE_COUNT = ${SPECTRAL_TRIANGLES.length}u;\n${shaderCode}`;

function readMaterial<Key extends string>(fields: Readonly<Record<Key, { readonly value: number }>>): Record<Key, number> {
	const values = {} as Record<Key, number>;
	for (const key in fields) values[key] = fields[key].value;
	return values;
}

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(context) {
		const { device, inputs } = context;
		const initialData = packFilmPhotographyModel(createFilmPhotographyModel(DEFAULT_SETTINGS));
		const buffer = device.createBuffer({ size: initialData.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const group = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer } }] });

		let previousSettings: string | null = null;
		return createFullscreenEffect(context, {
			code,
			schema: { input: 'color', exposure: 'scalar', printExposure: 'scalar' },
			inputs,
			internalLayouts: [layout],
			sampling: 'level0',
			bindResources(pass) {
				const redLayer = readMaterial(inputs.redLayer.fields);
				const greenLayer = readMaterial(inputs.greenLayer.fields);
				const blueLayer = readMaterial(inputs.blueLayer.fields);
				const base = readMaterial(inputs.base.fields);
				const printer = readMaterial(inputs.printer.fields);
				const paper = readMaterial(inputs.paper.fields);
				const settings = { redLayer, greenLayer, blueLayer, base, printer, paper };
				const settingsKey = JSON.stringify(settings);
				if (settingsKey !== previousSettings) {
					// 材料の変更時だけ分光係数を更新する。露出・入力画像・時刻の変化では
					// 再計算せず、画素ごとの露出を含めて同じGPUモデルを利用する。
					device.queue.writeBuffer(buffer, 0, packFilmPhotographyModel(createFilmPhotographyModel(settings)));
					previousSettings = settingsKey;
				}
				pass.setBindGroup(0, group);
			},
			disposeResources() { buffer.destroy(); },
		});
	},
};

export default implementation;
