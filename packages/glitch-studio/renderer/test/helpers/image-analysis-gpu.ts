import { CanvasRenderer } from '../../src/canvas-renderer.ts';
import { float32ToFloat16Bits } from '@gs/shared/utility/float32ToFloat16Bits.ts';
import type { ImageAnalysisTarget } from '@gs/shared/utility/image-analysis.ts';
import type { ImageValueScale } from '@gs/shared/utility/image-value-scale.ts';
import type { PreviewCanvasContext } from '../../src/preview-canvas-context.ts';

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice({ requiredFeatures: adapter.features.has('float32-filterable') ? ['float32-filterable'] : [] });
	const errors: string[] = [];
	device.addEventListener('uncapturederror', event => errors.push(event.error.message));
	const format = navigator.gpu.getPreferredCanvasFormat();
	const textures: GPUTexture[] = [];
	const context = (width: number, height: number): PreviewCanvasContext => {
		const texture = device.createTexture({ size: [width, height], format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
		textures.push(texture);
		return { canvas: new OffscreenCanvas(width, height), configure() {}, unconfigure() {}, getCurrentTexture: () => texture };
	};
	const renderer = new CanvasRenderer({ gpuDevice: device, gpuContext: context(1, 1), enableWaveformAndHistogram: true,
		histogramGpuContext: context(256, 150), waveformHorizontalGpuContext: context(512, 256), waveformVerticalGpuContext: context(256, 512) });
	const readbacks = textures.slice(1).map(texture => {
		const bytesPerRow = texture.width * 4;
		return { texture, bytesPerRow, buffer: device.createBuffer({ size: bytesPerRow * texture.height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }) };
	});
	const checks: string[] = [];
	async function check(target: ImageAnalysisTarget, valueScale: ImageValueScale, components: number[], expectedValue: number, sourceFormat: GPUTextureFormat = 'rgba16float') {
		const source = device.createTexture({ size: [1, 1], format: sourceFormat, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		try {
			const data = sourceFormat.includes('32') ? new Float32Array(components) : new Uint16Array(components.map(float32ToFloat16Bits));
			device.queue.writeTexture({ texture: source }, data, { bytesPerRow: data.byteLength }, [1, 1]);
			renderer.analysisTarget = target;
			renderer.analysisValueScale = valueScale;
			const encoder = device.createCommandEncoder();
			renderer.renderToCanvas(source, encoder);
			for (const { texture, buffer, bytesPerRow } of readbacks) encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, [texture.width, texture.height]);
			device.queue.submit([encoder.finish()]);
			const pixels = await Promise.all(readbacks.map(async ({ buffer }) => {
				await buffer.mapAsync(GPUMapMode.READ);
				const result = new Uint8Array(buffer.getMappedRange()).slice();
				buffer.unmap();
				return result;
			}));
			if (errors.length > 0) throw new Error(errors.join('\n'));
			const normalized = Math.max(0, Math.min(1, valueScale === 'linearMinusOneToOne' ? (expectedValue + 1) / 2
				: valueScale === 'linear' ? (expectedValue + 1) / 5 : expectedValue));
			const expectedBin = Math.round(normalized * 255);
			const visibleBins = Array.from({ length: 256 }, (_, bin) => bin).filter(bin => pixels[0][(75 * 256 + bin) * 4] > 0);
			if (visibleBins.length !== 1 || visibleBins[0] !== expectedBin) throw new Error(`${target} ${valueScale} ${sourceFormat}: histogram bins ${visibleBins}, expected ${expectedBin}`);
			const histogramColor = pixels[0].slice((75 * 256 + expectedBin) * 4, (75 * 256 + expectedBin) * 4 + 3);
			if (histogramColor.some(value => value !== 255)) throw new Error(`${target}: scalar histogram is not white`);
			for (const [index, vertical] of [false, true].entries()) {
				const waveform = pixels[index + 1];
				let peak = -1;
				let maximum = 0;
				for (let level = 0; level < 256; level++) {
					const offset = (vertical ? level : level * 512) * 4;
					if (waveform[offset] > maximum) { peak = level; maximum = waveform[offset]; }
				}
				const expectedLevel = (vertical ? normalized : 1 - normalized) * 255;
				if (peak < 0 || Math.abs(peak - expectedLevel) > 1) throw new Error(`${target} ${valueScale} ${sourceFormat}: ${vertical ? 'vertical' : 'horizontal'} waveform peak ${peak}, expected ${expectedLevel}`);
				const offset = (vertical ? peak : peak * 512) * 4;
				if (waveform[offset] !== waveform[offset + 1] || waveform[offset] !== waveform[offset + 2]) throw new Error(`${target}: scalar waveform is not white`);
			}
			checks.push(`${target} ${valueScale} ${sourceFormat} ${components}: histogram and both waveforms`);
			return pixels;
		} finally { source.destroy(); }
	}
	try {
		// 【半透明RGBAも数値のまま解析し、全てのLinear範囲で同じ値と白い波形を示す】
		// alphaで割る・重みを掛ける処理が混入すると、成分やベクトル長が変化してしまう。
		// (-0.375, 0.5)の長さは厳密に0.625であり、半精度の丸めにも依存しない期待値を使う。
		for (const [target, value] of [['alpha', 0.25], ['vectorX', -0.375], ['vectorY', 0.5], ['vectorLength', 0.625]] as const) {
			for (const scale of ['linearZeroToOne', 'linearMinusOneToOne', 'linear'] as const) await check(target, scale, [-0.375, 0.5, 0.125, 0.25], value);
		}
		// 【透明黒の0も消さず、alpha=0のベクトル成分も同じ重みで集計する】
		// ヒストグラムの下端をRGBの明度で暗くすると、alpha=0の分布だけ見えなくなる。
		for (const target of ['alpha', 'vectorX', 'vectorY', 'vectorLength'] as const) await check(target, 'linearZeroToOne', [0, 0, 0, 0], 0);
		await check('vectorLength', 'linearZeroToOne', [-0.375, 0.5, 0, 0], 0.625);
		// 【同じベクトルはalphaだけ変わっても波形の密度とヒストグラムが一致する】
		// ピークの位置だけではalphaによる誤った重み付けを検出できないため、全画素を比較する。
		const reference = await check('vectorLength', 'linearZeroToOne', [-0.375, 0.5, 0, 0.25], 0.625);
		for (const alpha of [0, 0.5, 1]) {
			const actual = await check('vectorLength', 'linearZeroToOne', [-0.375, 0.5, 0, alpha], 0.625);
			if (actual.some((pixels, index) => pixels.some((value, offset) => value !== reference[index][offset]))) throw new Error(`Data analysis was weighted by alpha ${alpha}`);
		}
		await check('vectorLength', 'linear', [3, 4, 0, 0], 5);
		// 【ベクトルのRG形式とスカラーのR形式をRGBAへ変換せず直接解析する】
		// 欠けている成分はGPUの既定値に従い、半精度・対応GPUでは単精度でも確認する。
		for (const sourceFormat of device.features.has('float32-filterable') ? ['rg16float', 'rg32float'] as const : ['rg16float'] as const) {
			await check('vectorX', 'linearMinusOneToOne', [-0.375, 0.5], -0.375, sourceFormat);
			await check('vectorY', 'linearZeroToOne', [-0.375, 0.5], 0.5, sourceFormat);
			await check('vectorLength', 'linearZeroToOne', [-0.375, 0.5], 0.625, sourceFormat);
		}
		await check('vectorLength', 'linearZeroToOne', [0.5], 0.5, 'r16float');
		// 【UIを経由しない設定でも、データにsRGBやEVを適用しない】
		// Rendererの設定境界でもLinear 0〜1へ補正し、見た目と目盛りの誤解釈を防ぐ。
		await check('alpha', 'srgb', [0, 0, 0, 0.25], 0.25);
		await check('vectorLength', 'ev', [-0.375, 0.5, 0, 0], 0.625);
		return checks;
	} finally {
		renderer.destroy();
		for (const { buffer } of readbacks) buffer.destroy();
		for (const texture of textures) texture.destroy();
		device.destroy();
	}
}
