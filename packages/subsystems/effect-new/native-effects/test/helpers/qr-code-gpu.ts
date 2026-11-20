import { nativeEffectProbe } from './native-effect-probe.ts';
import jsQR from 'jsqr';
import definition from '../../src/fx/qrCode/_def_.ts';
import implementationNative from '../../src/fx/qrCode/_impl_.ts';
import { encodeQrCode, getQrCodeCenterImageLayout } from '../../src/fx/qrCode/qr-code.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { constantShaderInput, textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { NativeParameterValues } from '../../src/multipass.ts';

const implementation = nativeEffectProbe(definition, implementationNative);

type QrCodeParameters = NativeParameterValues<typeof definition.paramDefs>;

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	device.pushErrorScope('validation');
	const vertex = device.createShaderModule({ code: vertexCode });
	const checks: string[] = [];
	const owned: { destroy(): void }[] = [];
	const effects: { dispose(): void }[] = [];
	const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
	const color = (value: [number, number, number, number]) => constantShaderInput('color', value);
	function close(actual: number, expected: number, message: string) { assert(Math.abs(actual - expected) < 0.002, `${message}: ${actual} != ${expected}`); }
	function equalPixels(actual: Float32Array, expected: Float32Array) { assert(actual.length === expected.length && actual.every((value, index) => value === expected[index]), 'pixel arrays differ'); }
	const readShader = device.createShaderModule({ code: `
@group(0) @binding(0) var image: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> pixels: array<vec4f>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
	let size = textureDimensions(image);
	if (all(id.xy < size)) { pixels[id.y * size.x + id.x] = textureLoad(image, vec2i(id.xy), 0); }
}` });
	const readPipeline = device.createComputePipeline({ layout: 'auto', compute: { module: readShader } });
	async function read(texture: GPUTexture) {
		const byteLength = texture.width * texture.height * 16;
		const result = device.createBuffer({ size: byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
		const buffer = device.createBuffer({ size: byteLength, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
		try {
			const encoder = device.createCommandEncoder();
			const pass = encoder.beginComputePass();
			pass.setPipeline(readPipeline);
			pass.setBindGroup(0, device.createBindGroup({ layout: readPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: texture.createView() }, { binding: 1, resource: { buffer: result } }] }));
			pass.dispatchWorkgroups(Math.ceil(texture.width / 8), Math.ceil(texture.height / 8));
			pass.end();
			encoder.copyBufferToBuffer(result, 0, buffer, 0, byteLength);
			device.queue.submit([encoder.finish()]);
			await buffer.mapAsync(GPUMapMode.READ);
			return new Float32Array(buffer.getMappedRange().slice(0));
		} finally { result.destroy(); buffer.destroy(); }
	}

	function createEffect(width = 444, height = 444, overrides: Partial<QrCodeParameters> = {}) {
		const resolution = { width, height };
		const defaults = Object.fromEntries(Object.entries(definition.paramDefs).map(([name, parameter]) => [name, 'canNode' in parameter && parameter.canNode === true ? constantShaderInput(parameter.dataType.kind, parameter.defaultValue.value) : parameter.defaultValue.value])) as QrCodeParameters;
		const base = { ...defaults, version: 3, content: 'https://example.com', errorCorrection: 'H', sizeReference: 'shortSide', ...overrides } as QrCodeParameters;
		let uploads = 0;
		// 実GPUへの転送を数え、装飾だけの更新でマスを再転送していないことを確認する。
		const queue = new Proxy(device.queue, { get(target, key) {
			if (key === 'writeTexture') return (...args: Parameters<GPUQueue['writeTexture']>) => { uploads++; target.writeTexture(...args); };
			const value = Reflect.get(target, key, target);
			return typeof value === 'function' ? value.bind(target) : value;
		} });
		const trackedDevice = new Proxy(device, { get(target, key) {
			if (key === 'queue') return queue;
			const value = Reflect.get(target, key, target);
			return typeof value === 'function' ? value.bind(target) : value;
		} });
		const wgpu = { device: trackedDevice, enable32bitDataTextures: false, defaultVertexShaderModule: vertex };
		const output = implementation.createTexture('output', { wgpu, resolution });
		owned.push(output);
		assert(output.format === 'rgba16float', 'image output format');
		const instance = implementation.place(wgpu, resolution);
		effects.push(instance);
		return {
			base, width, height,
			get uploads() { return uploads; },
			async render(changes: Partial<QrCodeParameters> = {}) {
				const params = { ...base, ...changes };
				const encoder = device.createCommandEncoder();
				await instance.draw({ params, commandEncoder: encoder, time: 0, timeDelta: 0, pointerPosition: { x: 0, y: 0 }, pointerVector: { x: 0, y: 0 },
					outputs: { output },
				});
				device.queue.submit([encoder.finish()]);
				return read(output);
			},
		};
	}

	function texture(width: number, height: number, values: number[]) {
		const image = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		owned.push(image);
		device.queue.writeTexture({ texture: image }, new Uint8Array(values), { bytesPerRow: width * 4 }, [width, height]);
		return textureShaderInput(image, { fitMode: 'contain', wrapMode: 'transparent', filterMode: 'nearest' });
	}
	function rgba8(pixels: Float32Array) {
		const bytes = new Uint8ClampedArray(pixels.length);
		for (let i = 0; i < pixels.length; i += 4) {
			for (let channel = 0; channel < 3; channel++) bytes[i + channel] = (pixels[i + channel] + 1 - pixels[i + 3]) * 255;
			bytes[i + 3] = 255;
		}
		return bytes;
	}
	function pixel(pixels: Float32Array, width: number, x: number, y: number) { return pixels.subarray((Math.floor(y) * width + Math.floor(x)) * 4, (Math.floor(y) * width + Math.floor(x)) * 4 + 4); }
	const qrCode = encodeQrCode('https://example.com', 'H', 3)!;
	const { size } = qrCode;
	function cellPixel(pixels: Float32Array, effect: { width: number; height: number }, x: number, y: number, localX = 0.5, localY = 0.5) {
		const cellSize = Math.min(effect.width, effect.height) / (size + 8);
		return pixel(pixels, effect.width, effect.width / 2 + (x + localX - size / 2) * cellSize, effect.height / 2 + (y + localY - size / 2) * cellSize);
	}
	function dark(x: number, y: number) { return x >= 0 && y >= 0 && x < size && y < size && qrCode.cells[(y * size + x) * 2] !== 0; }
	function connectableDark(x: number, y: number) { return dark(x, y) && qrCode.cells[(y * size + x) * 2 + 1] === 0; }
	function findCell(predicate: (x: number, y: number) => boolean) {
		for (let y = 1; y < size - 1; y++) for (let x = 1; x < size - 1; x++) {
			if (qrCode.cells[(y * size + x) * 2 + 1] === 0 && predicate(x, y)) return [x, y] as const;
		}
		throw new Error('Required QR cell topology missing');
	}

	try {
		const effect = createEffect();
		const original = await effect.render();
		for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) close(cellPixel(original, effect, x, y)[0], dark(x, y) ? 0 : 1, `cell ${x},${y}`);
		assert(jsQR(rgba8(original), effect.width, effect.height)?.data === effect.base.content, 'rendered QR decode');
		checks.push('integer cells and finder geometry', 'independent GPU image decode');

		// 【三隅の検出パターンを個別に保ち、通常の装飾例を復元できる】
		// 見た目の差分だけでなくデコーダーを通し、検出パターンまでセル単位で装飾する回帰を防ぐ。
		let decorated = original;
		for (const cellShape of ['square', 'rounded', 'circle', 'diamond'] as const) {
			decorated = await effect.render({ cellShape });
			// 全機能セルへの装飾により、位置合わせパターンもひし形になる。
			// デコーダーの位置合わせ検出に依存するひし形は、下で型番1の復号と形状の画素を確認する。
			if (cellShape !== 'diamond') assert(jsQR(rgba8(decorated), effect.width, effect.height)?.data === effect.base.content, `decode ${cellShape}`);
			close(cellPixel(decorated, effect, 0, 0, 0.1, 0.1)[0], 0, 'finder preserved');
		}
		const simple = createEffect(580, 580, { version: 1, content: 'GS' });
		const simpleDiamond = await simple.render({ cellShape: 'diamond' });
		assert(jsQR(rgba8(simpleDiamond), simple.width, simple.height)?.data === simple.base.content, 'decode version 1 diamond');
		checks.push('four cell shapes and independent decode');
		// 【位置合わせ・タイミング・形式情報にも形状・大きさ・角丸を適用する】
		// 右下などの一部だけ四角いまま残る回帰を、暗部の中心と周辺の実画素で確認する。
		const formatCell = Array.from({ length: 6 }, (_, y) => [8, y] as const).find(([x, y]) => dark(x, y))!;
		const functionalCells = [[20, 20], [22, 22], [6, 10], [10, 6], formatCell] as const;
		for (const [changes, localX, localY] of [
			[{ cellShape: 'circle' }, 0.08, 0.08],
			[{ cellShape: 'square', cellScale: 0.5 }, 0.15, 0.5],
			[{ cellShape: 'rounded', roundness: 1 }, 0.08, 0.08],
		] as const) {
			const pixels = await effect.render(changes);
			for (const [x, y] of functionalCells) {
				assert(dark(x, y), 'functional cell fixture must be dark');
				close(cellPixel(pixels, effect, x, y)[0], 0, 'functional cell center');
				close(cellPixel(pixels, effect, x, y, localX, localY)[0], 1, 'functional cell styling');
			}
		}
		checks.push('styles on alignment timing and format cells');
		const rounded = await effect.render({ cellShape: 'rounded', roundness: 1, antiAlias: false });
		const connected = await effect.render({ cellShape: 'rounded', roundness: 1, cornerMode: 'connected', antiAlias: false });
		const convex = findCell((x, y) => dark(x, y) && (connectableDark(x - 1, y) || connectableDark(x, y - 1)));
		close(cellPixel(rounded, effect, ...convex, 0.08, 0.08)[0], 1, 'individual corner');
		close(cellPixel(connected, effect, ...convex, 0.08, 0.08)[0], 0, 'connected convex corner');
		const concave = findCell((x, y) => !dark(x, y) && connectableDark(x - 1, y) && connectableDark(x, y - 1) && connectableDark(x - 1, y - 1));
		close(cellPixel(connected, effect, ...concave, 0.08, 0.08)[0], 0, 'connected concave corner');
		const diagonal = findCell((x, y) => !dark(x, y) && connectableDark(x - 1, y) && connectableDark(x, y - 1) && !connectableDark(x - 1, y - 1));
		close(cellPixel(connected, effect, ...diagonal, 0.08, 0.08)[0], 1, 'disconnected diagonal');
		equalPixels(await effect.render({ cellShape: 'rounded', cellScale: 0.7, cornerMode: 'connected' }), await effect.render({ cellShape: 'rounded', cellScale: 0.7, cornerMode: 'individual' }));
		checks.push('connected convex and concave rounding', 'diagonal separation and cell gaps');

		// 【対角セルの中心を丸い線で結び、横切る明部セルにも線を描く】
		// 各セル内だけで線を描くと斜めの連結が途中で切れるため、両側の白いセル内で連続性を確認する。
		// 逆向きや上下左右だけの隣接ではつながず、孤立点と線幅もCell Scaleへ従わせる。
		const dots = await effect.render({ cellShape: 'circle', cellScale: 0.5 });
		for (const [cellShape, directionY] of [['diagonalDown', 1], ['diagonalUp', -1]] as const) {
			const pixels = await effect.render({ cellShape, cellScale: 0.5 });
			const simplePixels = await simple.render({ cellShape, cellScale: 0.5 });
			assert(jsQR(rgba8(simplePixels), simple.width, simple.height)?.data === simple.base.content, `decode ${cellShape}`);
			const pair = findCell((x, y) => dark(x, y) && connectableDark(x + 1, y + directionY) && !dark(x + 1, y) && !dark(x, y + directionY));
			for (const [localX, localY] of [[1.08, 0.5 + directionY * 0.42], [0.92, 0.5 + directionY * 0.58]]) {
				close(cellPixel(dots, effect, ...pair, localX, localY)[0], 1, 'unconnected circle gap');
				close(cellPixel(pixels, effect, ...pair, localX, localY)[0], 0, 'continuous diagonal through light cell');
			}
			const opposite = await effect.render({ cellShape: directionY === 1 ? 'diagonalUp' : 'diagonalDown', cellScale: 0.5 });
			close(cellPixel(opposite, effect, ...pair, 1, 0.5 + directionY * 0.5)[0], 1, 'opposite direction stays open');
			const thin = await effect.render({ cellShape, cellScale: 0.3 });
			const thick = await effect.render({ cellShape, cellScale: 0.7 });
			close(cellPixel(thin, effect, ...pair, 1.2, 0.5 + directionY * 0.3)[0], 1, 'thin diagonal');
			close(cellPixel(thick, effect, ...pair, 1.2, 0.5 + directionY * 0.3)[0], 0, 'thick diagonal');
			const isolated = findCell((x, y) => dark(x, y) && !connectableDark(x + 1, y + directionY) && !connectableDark(x - 1, y - directionY));
			close(cellPixel(pixels, effect, ...isolated)[0], 0, 'isolated dot center');
			close(cellPixel(pixels, effect, ...isolated, 0.9, 0.5)[0], 1, 'isolated dot radius');
			const horizontal = findCell((x, y) => dark(x, y) && connectableDark(x + 1, y));
			close(cellPixel(pixels, effect, ...horizontal, 1, 0.5)[0], 1, 'horizontal neighbors stay separate');
			for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) close(cellPixel(pixels, effect, x, y, 0.08, 0.08)[0], dark(x, y) ? 0 : 1, 'finder unaffected by diagonal links');
			checks.push(`${cellShape} continuous readable links`);
		}
		checks.push('diagonal widths isolated dots and finder isolation');

		const finders = await effect.render({ finderFrameShape: 'circle', finderCenterShape: 'circle', finderFrameColor: color([1, 0, 0, 1]), finderCenterColor: color([0, 0, 1, 1]) });
		close(cellPixel(finders, effect, 0, 0, 0.1, 0.1)[1], 1, 'circular frame corner');
		close(cellPixel(finders, effect, 3, 0)[0], 1, 'frame color');
		close(cellPixel(finders, effect, 3, 3)[2], 1, 'finder center color');
		checks.push('independent finder frame and center');

		// 【透明な画像でもマスを丸ごと除き、画像だけを重ねる実装との差を確認する】
		// 半透明の画像下のマス、画像外の余白、セル境界の端まで白い下地が続く必要がある。
		const centerLayout = getQrCodeCenterImageLayout(size, true, [0.2, 0.2], 1);
		const hole = await effect.render({ centerImageEnabled: true });
		const [left, top, right, bottom] = centerLayout.cutoutBounds;
		let removedDarkCells = 0;
		for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
			close(cellPixel(hole, effect, x, y, 0.08, 0.08)[0], 1, 'whole-cell transparent cutout');
			if (dark(x, y)) removedDarkCells++;
		}
		assert(removedDarkCells > 0, 'cutout must remove actual dark cells');
		const diagonalHole = await effect.render({ centerImageEnabled: true, cellShape: 'diagonalDown', cellScale: 0.5 });
		for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
			for (const [localX, localY] of [[0.08, 0.08], [0.92, 0.08], [0.08, 0.92], [0.92, 0.92]]) close(cellPixel(diagonalHole, effect, x, y, localX, localY)[0], 1, 'diagonal links respect whole-cell cutout');
		}
		checks.push('diagonal links respect cutouts');
		// 【両端がくり抜きの外にある斜め接続も、途中がくり抜きの角へ重なるなら終了する】
		// 端点だけの判定では、丸い線の片側だけが矩形で削られて切れ込みが生じる。
		// 四隅すべてで、領域外に残ってしまう線分が消え、両端の丸いセルは残ることを確認する。
		for (const fixture of [
			{ corner: 'top right', cellShape: 'diagonalDown', imageSize: [0.2, 0.2], startCell: [18, 9], outsideCorner: [1.08, 0.92] },
			{ corner: 'bottom left', cellShape: 'diagonalDown', imageSize: [0.2, 0.3], startCell: [9, 19], outsideCorner: [0.92, 1.08] },
			{ corner: 'top left', cellShape: 'diagonalUp', imageSize: [0.2, 0.1], startCell: [9, 12], outsideCorner: [0.92, -0.08] },
			{ corner: 'bottom right', cellShape: 'diagonalUp', imageSize: [0.1, 0.3], startCell: [16, 20], outsideCorner: [1.08, 0.08] },
		] as const) {
			const { cellShape, startCell, outsideCorner } = fixture;
			const imageSize: [number, number] = [...fixture.imageSize];
			const directionY = cellShape === 'diagonalDown' ? 1 : -1;
			const [cutoutLeft, cutoutTop, cutoutRight, cutoutBottom] = getQrCodeCenterImageLayout(size, true, imageSize, 1).cutoutBounds;
			const inside = (x: number, y: number) => x >= cutoutLeft && y >= cutoutTop && x < cutoutRight && y < cutoutBottom;
			assert(connectableDark(...startCell) && connectableDark(startCell[0] + 1, startCell[1] + directionY), 'cutout corner fixture must join two dark cells');
			assert(!inside(...startCell) && !inside(startCell[0] + 1, startCell[1] + directionY), 'both endpoints must be outside the cutout');
			assert(!inside(Math.floor(startCell[0] + outsideCorner[0]), Math.floor(startCell[1] + outsideCorner[1])), 'notch regression sample must be outside the cutout');
			const joined = await effect.render({ cellShape, cellScale: 0.5, antiAlias: false });
			close(cellPixel(joined, effect, ...startCell, ...outsideCorner)[0], 0, 'unobstructed diagonal corner');
			for (const antiAlias of [false, true]) for (const cellScale of [0.3, 0.5, 1]) {
				const pixels = await effect.render({ cellShape, cellScale, antiAlias, centerImageEnabled: true, centerImageSize: imageSize });
				close(cellPixel(pixels, effect, ...startCell, ...outsideCorner)[0], 1, `cutout corner connection ends without a notch: ${fixture.corner}`);
				close(cellPixel(pixels, effect, ...startCell)[0], 0, 'starting cell remains');
				close(cellPixel(pixels, effect, startCell[0] + 1, startCell[1] + directionY)[0], 0, 'ending cell remains');
				close(cellPixel(pixels, effect, ...startCell, 0.92, 0.5 + directionY * 0.42)[0], 1, 'starting cell keeps a round cap');
			}
		}
		checks.push('round diagonal ends at all four cutout corners');
		const halfTransparentImage = await effect.render({ centerImageEnabled: true, centerImage: color([1, 0, 0, 0.5]) });
		const centerPixel = pixel(halfTransparentImage, effect.width, effect.width / 2, effect.height / 2);
		close(centerPixel[0], 1, 'center image red');
		close(centerPixel[1], 0.5, 'center image alpha over light background');
		close(centerPixel[3], 1, 'center image alpha');
		const logoInput = texture(3, 3, [0, 80, 255, 255, 255, 255, 255, 255, 0, 80, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 0, 80, 255, 255, 255, 255, 255, 255, 0, 80, 255, 255]);
		const uploadsBeforeLogo = effect.uploads;
		const logo = await effect.render({ centerImageEnabled: true, centerImage: logoInput });
		assert(jsQR(rgba8(logo), effect.width, effect.height)?.data === effect.base.content, 'decode with center image');
		checks.push('cell-aligned cutout with transparent input', 'premultiplied center image', 'independent decode with center image');
		await effect.render({ centerImageEnabled: true, centerImage: logoInput, cellScale: 0.9 });
		assert(effect.uploads === uploadsBeforeLogo + 1, 'fixed texture placement reuses the encoded QR code');
		checks.push('encoding and upload cache');

		for (const [width, height] of [[888, 444], [444, 888], [222, 222]]) {
			const target = createEffect(width, height);
			const pixels = await target.render();
			assert(jsQR(rgba8(pixels), width, height)?.data === target.base.content, 'aspect ratio decode');
			close(pixel(pixels, width, 0, 0)[3], width === height ? 1 : 0, 'outside square transparency');
		}
		const wide = createEffect(888, 444);
		const bands = texture(2, 1, [255, 0, 0, 255, 0, 255, 0, 255]);
		const fitted = await wide.render({ centerImageEnabled: true, centerImageSize: [0.4, 0.4], centerImage: bands });
		close(pixel(fitted, 888, 420, 222)[1], 0, 'center image left band');
		close(pixel(fitted, 888, 468, 222)[0], 0, 'center image right band');
		close(pixel(fitted, 888, 420, 170)[1], 1, 'contain uses image rectangle aspect');
		checks.push('resolution and aspect independence', 'center image fit and transparent wrap');

		const dataCell = findCell((x, y) => dark(x, y));
		const hdr = await effect.render({ darkColor: color([2, -0.5, 0.25, 0.5]) });
		const hdrPixel = cellPixel(hdr, effect, ...dataCell);
		for (const [channel, expected] of [1, -0.25, 0.125, 0.5].entries()) close(hdrPixel[channel], expected, 'HDR and premultiplied data color');
		const transparent = await effect.render({ centerImageEnabled: true, centerImage: color([2, -1, 0.5, 0.5]), lightColor: color([0, 0, 0, 0]) });
		for (const [channel, expected] of [1, -0.5, 0.25, 0.5].entries()) close(pixel(transparent, effect.width, 222, 222)[channel], expected, 'HDR center image');
		checks.push('transparent and HDR colors');

		const inputNames = ['darkColor', 'lightColor', 'finderFrameColor', 'finderCenterColor', 'centerImage'] as const;
		const black = texture(1, 1, [0, 0, 0, 255]);
		const white = texture(1, 1, [255, 255, 255, 255]);
		const clear = texture(1, 1, [0, 0, 0, 0]);
		for (const name of inputNames) equalPixels(await effect.render({ [name]: name === 'lightColor' ? white : name === 'centerImage' ? clear : black }), original);
		equalPixels(await effect.render({ darkColor: black, lightColor: white, finderFrameColor: black, finderCenterColor: black, centerImage: clear }), original);
		checks.push('uniform and texture input variants');

		const uploadsBeforeChange = effect.uploads;
		const changed = await effect.render({ content: 'QRコード 👩‍💻', version: 0 });
		assert(jsQR(rgba8(changed), effect.width, effect.height)?.data === 'QRコード 👩‍💻', 'changed Unicode content');
		assert(effect.uploads === uploadsBeforeChange + 1, 'changed content upload');
		assert((await effect.render({ content: '' })).every(value => value === 0), 'empty output');
		const exceedsCapacity = () => effect.render({ content: 'x'.repeat(1000), version: 1 }).then(() => false, () => true);
		assert(await exceedsCapacity(), 'reject content exceeding capacity');
		assert(await exceedsCapacity(), 'repeated failure');
		equalPixels(await effect.render(), original);
		checks.push('Unicode content changes', 'empty output', 'capacity errors and recovery');

		const diagonalDown = await effect.render({ cellShape: 'diagonalDown', cellScale: 0.5, finderFrameShape: 'circle', finderCenterShape: 'circle', centerImageEnabled: true });
		const diagonalUp = await effect.render({ cellShape: 'diagonalUp', cellScale: 0.5, finderFrameShape: 'circle', finderCenterShape: 'circle', centerImageEnabled: true, centerImageSize: [0.2, 0.1] });
		const canvas = new OffscreenCanvas(888, 1332);
		const context = canvas.getContext('2d')!;
		for (const [index, pixels] of [original, decorated, connected, logo, diagonalDown, diagonalUp].entries()) context.putImageData(new ImageData(rgba8(pixels), 444, 444), index % 2 * 444, Math.floor(index / 2) * 444);
		const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
		return { checks, preview: bytes.toBase64() };
	} finally {
		for (const effect of effects) effect.dispose();
		for (const resource of owned) resource.destroy();
		const error = await device.popErrorScope();
		device.destroy();
		if (error != null) throw new Error(error.message);
	}
}
