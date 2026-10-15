@group(0) @binding(2) var<storage, read> scanStates: array<ScanState>;
@group(0) @binding(3) var<storage, read> decoded: array<f32>;
@group(0) @binding(4) var<storage, read> referenceSamples: array<f32>;

struct FragmentIn {
	@location(0) uv: vec2f,
};

fn component_sample(pixel: vec2i, component: u32) -> vec2f {
	let stride = select(1u, 2u, uniforms.subsample != 0u && component != 0u);
	// 中央寄せでは画像の四辺にパディングがあり、画像座標とバッファの先頭は一致しない。
	// サンプル位置はパディングを含む計算領域で制限し、対応するMCUを正しく読む。
	let size = vec2i(uniforms.gridSize / stride);
	let point = vec2u(clamp(pixel, vec2i(0), size - 1));
	let blockPosition = point / 8u;
	var mcu = blockPosition;
	var slot = component;
	if (uniforms.subsample != 0u) {
		if (component == 0u) {
			mcu = blockPosition / 2u;
			slot = (blockPosition.y % 2u) * 2u + blockPosition.x % 2u;
		} else {
			slot = component + 3u;
		}
	}
	let block = (mcu.y * uniforms.mcuColumns + mcu.x) * uniforms.blocksPerMcu + slot;
	// DCTのブロック・成分は補間すると意味が変わるため、整数位置でバッファを読む。
	let index = (point.y % 8u) * 8u + point.x % 8u;
	var reference = 0.0;
	if (uniforms.preserveDetails != 0u) {
		// 比較画像も同じ配置ずれを適用する。ずれを誤差として二重に合成せず、
		// 同じ参照元に対する量子化・係数破損・DC誤差だけを差分として取り出す。
		reference = referenceSamples[scanStates[block].sourceBlock * 64u + index];
	}
	return vec2f(decoded[block * 64u + index], reference);
}

fn sample_component(imagePosition: vec2f, component: u32) -> vec2f {
	let stride = select(1.0, 2.0, uniforms.subsample != 0u && component != 0u);
	let pixel = image_to_grid(imagePosition) / stride - 0.5;
	let base = vec2i(floor(pixel));
	let weight = fract(pixel);
	// 仮想画像の拡大と色差の復元は、同じ成分の隣接サンプル間で双線形補間する。
	return mix(
		mix(component_sample(base, component), component_sample(base + vec2i(1, 0), component), weight.x),
		mix(component_sample(base + vec2i(0, 1), component), component_sample(base + vec2i(1, 1), component), weight.x),
		weight.y,
	);
}

fn ycbcr_to_rgb(color: vec3f) -> vec3f {
	return vec3f(color.x + 1.402 * color.z, color.x - 0.344136 * color.y - 0.714136 * color.z, color.x + 1.772 * color.y);
}

fn detail_source(imagePosition: vec2f, original: vec4f) -> vec4f {
	let size = f32(mcu_size());
	let pixel = image_to_grid(imagePosition);
	let destination = vec2u(floor(pixel / size));
	let destinationMcu = destination.y * uniforms.mcuColumns + destination.x;
	let sourceMcu = scanStates[destinationMcu * uniforms.blocksPerMcu].sourceBlock / uniforms.blocksPerMcu;
	if (sourceMcu == destinationMcu) { return original; }
	// 高解像度の細部も同じMCUの参照元から読む。元位置の細部を重ねると、
	// 配置ずれの上に移動前の輪郭が残るため、MCU内の座標を保ったまま移動する。
	let source = vec2u(sourceMcu % uniforms.mcuColumns, sourceMcu / uniforms.mcuColumns);
	let sourcePixel = pixel + (vec2f(source) - vec2f(destination)) * size;
	let sourcePosition = clamp(grid_to_image(sourcePixel), vec2f(0.0), vec2f(1.0));
	return read_input(sourcePosition * vec2f(2.0, -2.0) + vec2f(-1.0, 1.0));
}

@fragment
fn fs(fragment: FragmentIn) -> @location(0) vec4f {
	let original = read_input(fragment.uv);
	if (original.a <= 0.0) { return vec4f(0.0); }
	let imagePosition = fragment.uv * vec2f(0.5, -0.5) + 0.5;
	let y = sample_component(imagePosition, 0u);
	let cb = sample_component(imagePosition, 1u);
	let cr = sample_component(imagePosition, 2u);
	var rgb = ycbcr_to_rgb(vec3f(y.x, cb.x, cr.x));
	if (uniforms.preserveDetails != 0u) {
		let source = detail_source(imagePosition, original);
		var sourceRgb = vec3f(0.0);
		if (source.a > 0.0) { sourceRgb = source.rgb / source.a; }
		let referenceRgb = ycbcr_to_rgb(vec3f(y.y, cb.y, cr.y));
		// 元画像 + (JPEG処理後 - 未圧縮の縮小画像) とし、リサンプリングで失った
		// 細部を維持する。比較する両画像に同じ補間を使い、差分計算後にだけRGBを飽和させる。
		rgb = sourceRgb + (rgb - referenceRgb);
	}
	rgb = clamp(rgb, vec3f(0.0), vec3f(1.0));
	// JPEGはalphaを持たない。元の透明度を保持し、色の復号後に一度だけpremultiplyする。
	return vec4f(rgb * original.a, original.a);
}
