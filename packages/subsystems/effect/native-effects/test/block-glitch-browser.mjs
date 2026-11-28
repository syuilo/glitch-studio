import { check, near, withGpu } from './native-effect-gpu-fixture.mjs';

const resolution = { width: 64, height: 32 };
const frame = { time: 0, timeDelta: 0 };

async function withBlockGlitch(run, { inputResolution = resolution, fitMode = 'cover' } = {}) {
	await withGpu(async ({ gpu: { device }, create, render, read }) => {
		const { width, height } = inputResolution;
		const texture = device.createTexture({ size: inputResolution, format: 'rgba16float',
			usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING });
		const inputPixels = new Float16Array(width * height * 4);
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				// xとyに別々の勾配を与え、参照位置がどの軸にずれたかをチャンネルごとに判別する。
				inputPixels.set([x / width, y / width, (x + 2 * y) / width, 1], (y * width + x) * 4);
			}
		}
		device.queue.writeTexture({ texture }, inputPixels, { bytesPerRow: width * 8 }, inputResolution);
		const image = { kind: 'texture', texture, resolution: inputResolution, sampling: { fitMode, wrapMode: 'transparent', filterMode: 'linear' } };
		try {
			await run(async (overrides, tileSize = null) => {
				const values = { dimension: [3, 2.5], aspectRatioRandomness: 0, scaleRandomness: 0, maxImageShift: 0, maxChannelShift: 0,
					blockCount: 1, ...overrides };
				const params = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { inputSource: 'literal', value }]));
				const instance = await create({ type: 'nativeEffect', id: 'blockGlitch' }, ['output'], { image }, {
					resolution, params, tiling: tileSize == null ? { mode: 'disabled' } : { mode: 'manual', tileSize },
				});
				try {
					if (tileSize == null) render(instance, frame);
					else await instance.renderTiled(frame);
					return await read(instance.outputs.get('output').texture);
				} finally {
					instance.dispose();
				}
			});
		} finally {
			texture.destroy();
		}
	});
}

function pixel(pixels, x, y) {
	const offset = (y * resolution.width + x) * 4;
	return pixels.subarray(offset, offset + 4);
}

export async function checkBlockGlitchRotation() {
	await withBlockGlitch(async draw => {
		const original = await draw({ blockCount: 0 });
		const [red, green, blue] = pixel(original, 32, 16);
		const horizontalImage = pixel(await draw({ maxImageShift: 0.16 }), 32, 16);
		const verticalImage = pixel(await draw({ maxImageShift: 0.16, angle: 0.25 }), 32, 16);
		check(Math.abs(horizontalImage[0] - red) > 0.05, 'horizontal image shift changes red');
		near(horizontalImage[1], green, 'horizontal image shift preserves green');
		near(verticalImage[0], red, 'vertical image shift preserves red');
		near(verticalImage[1] - green, horizontalImage[0] - red, 'quarter turn preserves the physical shift');

		const horizontalColor = pixel(await draw({ maxChannelShift: 0.12 }), 32, 16);
		check(Math.abs(horizontalColor[0] - red) > 0.05, 'horizontal channel shift changes red');
		near(horizontalColor[2] - blue, red - horizontalColor[0], 'red and blue shift in opposite directions');
		const options = { maxChannelShift: 0.12, angle: 0.25 };
		const verticalColor = await draw(options);
		const center = pixel(verticalColor, 32, 16);
		near(center[0], red, 'vertical channel shift preserves red');
		near(center[1], green, 'channel shift preserves green');
		near(center[2] - blue, 2 * (horizontalColor[2] - blue), 'blue follows the steeper vertical gradient');
		const tiled = await draw(options, 13);
		check(verticalColor.every((value, index) => value === tiled[index]), 'tiles reproduce the same full-frame result');

		const smallBlock = { seed: 1, dimension: [0.35, 0.075], maxImageShift: 0.16 };
		const level = await draw(smallBlock);
		const tilted = await draw({ ...smallBlock, angleSpread: 0.25 });
		const levelEnd = pixel(original, 42, 25)[0];
		const tiltedEnd = pixel(original, 34, 18)[1];
		check(Math.abs(pixel(level, 42, 25)[0] - levelEnd) > 0.04, 'level block covers a point along its width');
		near(pixel(tilted, 42, 25)[0], levelEnd, 'angle spread moves the block away from the level point');
		near(pixel(level, 34, 18)[1], tiltedEnd, 'level block does not cover the tilted point');
		check(Math.abs(pixel(tilted, 34, 18)[1] - tiltedEnd) > 0.04, 'angle spread rotates both the block and its image shift');
	});
}

export async function checkBlockGlitchOverlap() {
	await withBlockGlitch(async draw => {
		const options = { maxImageShift: 0.25 };
		const oneBlock = await draw(options);
		const twoBlocks = await draw({ ...options, blockCount: 2 });
		near(pixel(oneBlock, 60, 16)[3], 1, 'the first block samples an opaque texel at the right edge');
		check(pixel(twoBlocks, 60, 16).every(value => value === 0), 'the later block takes precedence with a transparent sample');
	});
}

export async function checkBlockGlitchRandomPosition() {
	await withBlockGlitch(async draw => {
		const options = { imageSource: 'randomPosition', seed: 3 };
		const original = await draw({ ...options, blockCount: 0 });
		const copied = await draw(options);
		// このSeedでは、出力の余白にあるブロックの中心が入力画像の上端付近を参照する。
		const center = pixel(copied, 52, 28);
		const neighbor = pixel(copied, 53, 29);
		near(pixel(original, 52, 28)[3], 0, 'the destination is in the contain padding');
		near(center[3], 1, 'the random source center is inside the input image');
		near(neighbor[0] - center[0], 1 / resolution.width, 'the patch preserves horizontal spacing');
		near(neighbor[1] - center[1], 1 / resolution.width, 'the patch preserves vertical spacing');

		const tiled = await draw({ ...options, maxImageShift: 0.25 }, 13);
		check(copied.every((value, index) => value === tiled[index]), 'random positions are stable across tiles and independent of Max Image Shift');
		const otherSeed = await draw({ ...options, seed: 0 });
		check(copied.some((value, index) => value !== otherSeed[index]), 'changing the seed changes which input regions appear');
	}, { inputResolution: { width: 64, height: 16 }, fitMode: 'contain' });
}
