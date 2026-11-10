import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import colorCode from '@gs/shared/gpu/color-space.wgsl?raw';
import { linearChannelToSrgb } from '@gs/shared/color-space.ts';

type ColorSpaceCandidate = 'srgb' | 'display-p3' | 'srgb-linear' | 'display-p3-linear';
type ProbeResult = { colorSpace: ColorSpaceCandidate; supported: boolean; reason: string | null; values: number[] | null };

// 左はsRGBの赤、右はP3の赤。どちらも同じ内部linear sRGBとして定義する。
const LINEAR_SRGB_REDS = [[1, 0, 0], [1.2249401763, -0.0420569547, -0.0196375546]];
const LINEAR_P3_REDS = [[0.8224619687, 0.0331941989, 0.0170826307], [1, 0, 0]];

function addLabel(parent: HTMLElement, text: string) {
	const label = document.createElement('div');
	label.textContent = text;
	parent.append(label);
}

function createSwatch(parent: HTMLElement) {
	const canvas = document.createElement('canvas');
	canvas.width = 2;
	canvas.height = 1;
	Object.assign(canvas.style, { width: '320px', height: '96px', imageRendering: 'pixelated', display: 'block', margin: '8px 0' });
	parent.append(canvas);
	return canvas;
}

function assertPixels(name: string, actual: ArrayLike<number>, expected: number[], tolerance: number) {
	for (const [index, value] of expected.entries()) {
		if (!Number.isFinite(actual[index]) || Math.abs(actual[index] - value) > tolerance) {
			throw new Error(`${name}, component ${index}: ${actual[index]} != ${value}`);
		}
	}
}

export async function run() {
	Object.assign(document.body.style, { background: '#202020', color: '#eee', font: '14px system-ui', margin: '24px' });
	addLabel(document.body, 'Canvas color output probe — left: sRGB red / right: Display P3 red');
	addLabel(document.body, '数値の保持とCanvas間の色変換を検証します。最終的なモニターの表示精度は実機で別途確認してください。');
	const runtime = navigator.userAgent;
	const screen = { p3: matchMedia('(color-gamut: p3)').matches, rec2020: matchMedia('(color-gamut: rec2020)').matches,
		hdr: matchMedia('(dynamic-range: high)').matches };
	addLabel(document.body, `${runtime}\nScreen capability (approximate): ${JSON.stringify(screen)}`);
	addLabel(document.body, '8bit sRGB control — both reds are clamped to the same sRGB red');
	const control = createSwatch(document.body);
	control.getContext('2d', { colorSpace: 'srgb' })!.putImageData(new ImageData(new Uint8ClampedArray([255, 0, 0, 255, 255, 0, 0, 255]), 2, 1), 0, 0);
	const adapter = await navigator.gpu?.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	// 数値検証後も比較画面を残し、ページを閉じる際に表示用のGPU資源を解放する。
	window.addEventListener('pagehide', () => device.destroy(), { once: true });
	const errors: string[] = [];
	device.addEventListener('uncapturederror', event => errors.push(event.error.message));
	const results: ProbeResult[] = [];
	const colorSpaces: ColorSpaceCandidate[] = ['srgb', 'display-p3', 'srgb-linear', 'display-p3-linear'];
	try {
		for (const colorSpace of colorSpaces) {
			const section = document.createElement('div');
			document.body.append(section);
			addLabel(section, `rgba16float / ${colorSpace} / SDR`);
			const canvas = createSwatch(section);
			const context = canvas.getContext('webgpu');
			if (context == null) throw new Error('WebGPU canvas unavailable');
			try {
				// DOMの型定義は線形色空間の追加より古いため、この検証だけで実行時のenum対応を調べる。
				// 不明なenumの拒否と、構成後の画素の不一致は別の結果として扱う。
				context.configure({ device, format: 'rgba16float', colorSpace: colorSpace as PredefinedColorSpace,
					alphaMode: 'opaque', toneMapping: { mode: 'standard' }, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
			} catch (error) {
				const reason = String(error);
				results.push({ colorSpace, supported: false, reason, values: null });
				addLabel(section, `Unsupported: ${reason}`);
				continue;
			}
			if (context.getConfiguration()?.colorSpace !== colorSpace) throw new Error(`${colorSpace}: configuration was not retained`);
			const p3 = colorSpace.startsWith('display-p3');
			const linear = colorSpace.endsWith('-linear');
			const colors = p3 ? LINEAR_P3_REDS : LINEAR_SRGB_REDS;
			const encoded = colors.map(rgb => rgb.map(value => linear ? value : linearChannelToSrgb(value)));
			const shader = device.createShaderModule({ code: `${colorCode}
@fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
	let color = select(vec3f(${colors[0].join(', ')}), vec3f(${colors[1].join(', ')}), position.x >= 1.0);
	return vec4f(${linear ? 'color' : 'colorLinearToSrgb(color)'}, 1.0);
}` });
			const pipeline = device.createRenderPipeline({ layout: 'auto',
				vertex: { module: device.createShaderModule({ code: vertexCode }) },
				fragment: { module: shader, entryPoint: 'fs', targets: [{ format: 'rgba16float' }] }, primitive: { topology: 'triangle-list' } });
			const readback = device.createBuffer({ size: 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
			try {
				const encoder = device.createCommandEncoder();
				const texture = context.getCurrentTexture();
				const pass = encoder.beginRenderPass({ colorAttachments: [{ view: texture.createView(), loadOp: 'clear', storeOp: 'store' }] });
				pass.setPipeline(pipeline); pass.draw(3); pass.end();
				encoder.copyTextureToBuffer({ texture }, { buffer: readback, bytesPerRow: 256 }, [2, 1]);
				device.queue.submit([encoder.finish()]);
				// Canvas 2Dへの色管理されたコピーも同じフレーム中に確定する。
				// 元Canvasのfloat値を読むだけでは、出力の色空間指定の間違いを検出できない。
				for (const destination of ['srgb', 'display-p3'] as const) {
					const reference = document.createElement('canvas');
					reference.width = 2; reference.height = 1;
					const referenceContext = reference.getContext('2d', { colorSpace: destination, colorType: 'float16' });
					if (referenceContext == null) throw new Error('Float16 Canvas 2D unavailable');
					referenceContext.drawImage(canvas, 0, 0);
					const converted = referenceContext.getImageData(0, 0, 2, 1, { colorSpace: destination, pixelFormat: 'rgba-float16' });
					const referenceColors = destination === 'srgb' ? LINEAR_SRGB_REDS : LINEAR_P3_REDS;
					assertPixels(`${colorSpace} to ${destination}`, converted.data, referenceColors.flatMap(rgb => [...rgb.map(linearChannelToSrgb), 1]), 0.004);
				}
				await readback.mapAsync(GPUMapMode.READ);
				const values = Array.from(new Float16Array(readback.getMappedRange()).slice(0, 8));
				readback.unmap();
				assertPixels(colorSpace, values, encoded.flatMap(rgb => [...rgb, 1]), 0.002);
				results.push({ colorSpace, supported: true, reason: null, values });
				addLabel(section, `PASS: float values preserved; Canvas 2D conversions to sRGB/P3 match the reference. ${JSON.stringify(values)}`);
			} finally { readback.destroy(); }
		}
		await device.queue.onSubmittedWorkDone();
		if (errors.length > 0) throw new Error(errors.join('\n'));
		return { runtime, screen, results };
	} catch (error) { device.destroy(); throw error; }
}
