import gradient from '../../../shared/src/effects/gradient/_impl_.ts';
import definition from '../../../shared/src/effects/gradient/_def_.ts';
import { constantShaderInput, textureShaderInput } from '../../../shared/src/shader-input.ts';
import { float32ToFloat16Bits } from '../../../shared/src/utility/float32ToFloat16Bits.ts';

function fromHalf(bits: number) {
	const exponent = (bits >> 10) & 31;
	const fraction = bits & 1023;
	return (bits & 32768 ? -1 : 1) * (exponent === 0 ? fraction * 2 ** -24 : exponent === 31 ? (fraction ? NaN : Infinity) : (1 + fraction / 1024) * 2 ** (exponent - 15));
}

// Gradientの値と符号付き微分を、色としてclampせず直接読み戻す。
export async function checkGradientInputs(device: GPUDevice, vertex: GPUShaderModule) {
	const completed: string[] = [];
	function check(name: string, actual: number[], expected: number[]) {
		if (actual.length !== expected.length || actual.some((v, i) => !Number.isFinite(v) || Math.abs(v - expected[i]) > 0.003)) throw new Error(`${name}: ${actual} != ${expected}`);
	}
	for (const enable32bitDataTextures of [false, true]) {
		if (enable32bitDataTextures && !device.features.has('float32-filterable')) continue;
		device.pushErrorScope('validation');
		const textures: GPUTexture[] = [];
		const context = { wgpu: { device, defaultVertexShaderModule: vertex, enable32bitDataTextures }, resolution: { width: 4, height: 4 } } as any;
		const instance = gradient.init(context);
		function texture(width: number, height: number, channels: number, values?: number[]) {
			const format = (channels === 1 ? 'r' : 'rg') + (enable32bitDataTextures ? '32float' : '16float') as GPUTextureFormat;
			const output = device.createTexture({ size: [width, height], format, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST });
			textures.push(output);
			if (values) {
				const bytes = enable32bitDataTextures ? new Float32Array(values) : new Uint16Array(values.map(float32ToFloat16Bits));
				device.queue.writeTexture({ texture: output }, bytes, { bytesPerRow: width * channels * (enable32bitDataTextures ? 4 : 2) }, [width, height]);
			}
			return output;
		}
		const scalar = texture(4, 4, 1);
		const vector = texture(4, 4, 2);
		const buffer = device.createBuffer({ size: 2048, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
		async function render(params: any, needsVector: boolean) {
			const encoder = device.createCommandEncoder();
			const outputDataMap: any = { scalar: { texture: scalar, textureView: scalar.createView() } };
			if (needsVector) outputDataMap.vector = { texture: vector, textureView: vector.createView() };
			instance.render({ params, commandEncoder: encoder, outputDataMap, usedOutputPorts: new Set(needsVector ? ['scalar', 'vector'] : ['scalar']), createPassEncoder: (e: GPUCommandEncoder, descriptor: GPURenderPassDescriptor) => e.beginRenderPass(descriptor), createPassEncoderFor: (e: GPUCommandEncoder, view: GPUTextureView) => e.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] }) } as any);
			encoder.copyTextureToBuffer({ texture: scalar }, { buffer, bytesPerRow: 256 }, [4, 4]);
			if (needsVector) encoder.copyTextureToBuffer({ texture: vector }, { buffer, offset: 1024, bytesPerRow: 256 }, [4, 4]);
			device.queue.submit([encoder.finish()]);
			await buffer.mapAsync(GPUMapMode.READ);
			const data = new DataView(buffer.getMappedRange());
			const decode = (offset: number, channels: number) => Array.from({ length: 16 * channels }, (_, index) => {
				const address = offset + Math.floor(index / (4 * channels)) * 256 + index % (4 * channels) * (enable32bitDataTextures ? 4 : 2);
				return enable32bitDataTextures ? data.getFloat32(address, true) : fromHalf(data.getUint16(address, true));
			});
			const result = { scalar: decode(0, 1), vector: needsVector ? decode(1024, 2) : [] };
			buffer.unmap();
			return result;
		}
		try {
			const params: Record<string, any> = {};
			const inputs: { name: string; uniform: any; texture: any }[] = [];
			for (const [name, param] of Object.entries(definition.paramDefs) as [string, any][]) {
				const value = param.defaultValue.value;
				params[name] = param.canNode ? constantShaderInput('scalar', value) : value;
				if (param.canNode) inputs.push({ name, uniform: params[name], texture: textureShaderInput(texture(1, 1, 1, [value])) });
			}
			// 全128入力構成でscalar単独と複数出力を比較する。最後は退避した構成へ戻す。
			const baseline = await render(params, true);
			check('linear gradient values', baseline.scalar, [0.875, 0.625, 0.375, 0.125].flatMap(v => [v, v, v, v]));
			check('linear gradient derivatives', baseline.vector, Array.from({ length: 16 }, () => [0, 0.5]).flat());
			for (let iteration = 0; iteration <= 128; iteration++) {
				const mask = iteration % 128;
				inputs.forEach((input, index) => { params[input.name] = mask & (1 << index) ? input.texture : input.uniform; });
				const scalarOnly = await render(params, false);
				const both = await render(params, true);
				check(`gradient scalar variant ${mask}`, scalarOnly.scalar, baseline.scalar);
				check(`gradient MRT scalar variant ${mask}`, both.scalar, baseline.scalar);
				check(`gradient vector variant ${mask}`, both.vector, baseline.vector);
			}
			// Radialでも既存の解析的微分と+Y方向を維持する。
			params.mode = 'radial';
			params.fitMode = 'stretch';
			const radial = await render(params, true);
			const radius = Math.hypot(-0.25, 0.25);
			check('radial value and derivative', [radial.scalar[5], ...radial.vector.slice(10, 12)], [radius, -0.25 / radius, 0.25 / radius]);
			params.mode = 'linear';
			// 同じ空間入力を両端値へ渡すと、結果と微分は入力そのものになる。
			// 異なる比率の入力でfitと全wrapを確認し、透明境界の1x1も含める。
			for (const [width, height, values] of [[4, 2, [0, 0.125, 0.375, 0.75, 0.25, 0.5, 0.625, 1]], [1, 1, [0.75]]] as const) {
				const source = texture(width, height, 1, [...values]);
				for (const fitMode of ['stretch', 'cover', 'contain'] as const) {
					const ratio = width / height;
					const scale = fitMode === 'stretch' ? [1, 1] : fitMode === 'cover' ? [Math.min(1, 1 / ratio), Math.min(1, ratio)] : [Math.max(1, 1 / ratio), Math.max(1, ratio)];
					for (const wrapMode of ['clamp', 'repeat', 'repeatMirrored', 'transparent'] as const) {
						params.startValue = params.endValue = textureShaderInput(source, { fitMode, wrapMode });
						const result = await render(params, true);
						function index(value: number, size: number) {
							if (wrapMode === 'repeat') return ((value % size) + size) % size;
							if (wrapMode === 'repeatMirrored') { const v = ((value % (2 * size)) + 2 * size) % (2 * size); return v < size ? v : 2 * size - 1 - v; }
							return Math.max(0, Math.min(size - 1, value));
						}
						function sample(x: number, y: number) {
							if (wrapMode === 'transparent' && (x < 0 || y < 0 || x >= width || y >= height)) return 0;
							return values[index(y, height) * width + index(x, width)];
						}
						const expectedScalar: number[] = [];
						const expectedVector: number[] = [];
						for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
							const px = (((x + 0.5) / 4 - 0.5) * scale[0] + 0.5) * width - 0.5;
							const py = (((y + 0.5) / 4 - 0.5) * scale[1] + 0.5) * height - 0.5;
							const ix = Math.floor(px), iy = Math.floor(py), wx = px - ix, wy = py - iy;
							const a = sample(ix, iy), b = sample(ix + 1, iy), c = sample(ix, iy + 1), d = sample(ix + 1, iy + 1);
							expectedScalar.push((a * (1 - wx) + b * wx) * (1 - wy) + (c * (1 - wx) + d * wx) * wy);
							expectedVector.push(((b - a) * (1 - wy) + (d - c) * wy) * width * scale[0] / 2, -((c - a) * (1 - wx) + (d - b) * wx) * height * scale[1] / 2);
						}
						check(`gradient ${width} ${fitMode} ${wrapMode} value`, result.scalar, expectedScalar);
						check(`gradient ${width} ${fitMode} ${wrapMode} derivative`, result.vector, expectedVector);
					}
				}
			}
			// nearestの入力微分は画素内・境界とも0。linearへ戻したときには復元される。
			const stepSource = texture(2, 2, 1, [0.125, 0.875, 0.125, 0.875]);
			params.startValue = params.endValue = textureShaderInput(stepSource, { filterMode: 'nearest' });
			const nearest = await render(params, true);
			check('nearest gradient values', nearest.scalar, Array.from({ length: 4 }, () => [0.125, 0.125, 0.875, 0.875]).flat());
			check('nearest input derivatives are zero', nearest.vector, Array(32).fill(0));
			params.startValue = params.endValue = textureShaderInput(stepSource, { filterMode: 'linear' });
			const linear = await render(params, true);
			check('restores linear input derivative', linear.vector.slice(2, 4), [0.75, 0]);
			const error = await device.popErrorScope();
			if (error) throw new Error(error.message);
			completed.push(`gradient inputs and derivatives ${enable32bitDataTextures ? 32 : 16}bit`);
		} finally {
			instance.dispose();
			buffer.destroy();
			for (const t of textures) t.destroy();
		}
	}
	return completed;
}
