// equivalent to GLSL's mod function
fn modVec2f(a: vec2f, b: vec2f) -> vec2f {
	return a - b * floor(a / b);
}

struct Uniforms {
	aspectRatio: f32,
	divisions: f32,
	margin: f32,
	symbolTexturesCount: u32,
	symbolTexturesRangeMin: f32,
	symbolTexturesRangeMax: f32,
	useOriginalColor: u32,
	highlightClipThreshold: f32,
	shadowClipThreshold: f32,
	enableClippedAreaFill: u32,
	bgColor: vec4f,
	colorA: vec4f,
	colorB: vec4f,
	colorC: vec4f,
	similarityThresholdFactor: f32,
	forceFieldShift: u32,
	forceFieldWarp: u32,
};

@group(0) @binding(1) var<uniform> uniforms: Uniforms;
@group(0) @binding(2) var mySampler: sampler;
@group(0) @binding(4) var symbolTextures: texture_2d_array<f32>;

// https://docs.arduino.cc/language-reference/en/functions/math/map/
fn remap(value: f32, inMin: f32, inMax: f32, outMin: f32, outMax: f32) -> f32 {
	return (value - inMin) * (outMax - outMin) / (inMax - inMin) + outMin;
}

fn getPixelatedUv(uv: vec2f, cellSize: vec2f) -> vec2f {
	return (cellSize * floor(uv / cellSize)) + (cellSize / 2.0);
}

fn getSourceColor(uv: vec2f) -> vec4f {
	// セルの座標を入力参照の座標へ戻せば、ベクトル値はそのまま変位に使える。
	var position = unscaleUvToCoverGivenAspectRatio(uv, uniforms.aspectRatio);
	if (uniforms.forceFieldWarp == 1) {
		position -= read_forceField(position);
	}
	return read_input(position);
}

fn getForceFieldAspectVector(aspectUv: vec2f) -> vec2f {
	let position = unscaleUvToCoverGivenAspectRatio(aspectUv, uniforms.aspectRatio);
	// 参照位置のfitとは別に、ベクトル値をセルの座標系へ変換する。
	return scaleUvToCoverGivenAspectRatio(read_forceField(position), uniforms.aspectRatio);
}

fn isSimilar(a: vec4f, b: vec4f, c: vec4f, d: vec4f, threshold: f32) -> bool {
	return (
		abs(a.r - b.r) < threshold && abs(a.g - b.g) < threshold && abs(a.b - b.b) < threshold &&
		abs(a.r - c.r) < threshold && abs(a.g - c.g) < threshold && abs(a.b - c.b) < threshold &&
		abs(a.r - d.r) < threshold && abs(a.g - d.g) < threshold && abs(a.b - d.b) < threshold
	);
}

fn scaleUvToCoverGivenAspectRatio(uv: vec2f, aspectRatio: f32) -> vec2f {
	return uv / vec2f(1.0, aspectRatio) * select(1.0, aspectRatio, 1.0 > aspectRatio);
}

fn unscaleUvToCoverGivenAspectRatio(uv: vec2f, aspectRatio: f32) -> vec2f {
	return uv * vec2f(1.0, aspectRatio) / select(1.0, aspectRatio, 1.0 > aspectRatio);
}

struct FragmentIn {
	@location(0) uv: vec2f,
};

@fragment
fn fs(fragData: FragmentIn) -> @location(0) vec4f {
	let uv = scaleUvToCoverGivenAspectRatio(fragData.uv, uniforms.aspectRatio);
	var cellSize = vec2f(2.0 / uniforms.divisions);
	var border = uniforms.margin;
	var modUv = modVec2f(uv, cellSize);

	let cellUv4 = getPixelatedUv(uv, cellSize * 4.0);
	let cellOffset4 = cellSize * 1.5;
	let a4 = cellUv4 + vec2f(-cellOffset4.x, -cellOffset4.y);
	let b4 = cellUv4 + vec2f(cellOffset4.x, -cellOffset4.y);
	let c4 = cellUv4 + vec2f(-cellOffset4.x, cellOffset4.y);
	let d4 = cellUv4 + vec2f(cellOffset4.x, cellOffset4.y);
	let sourceColorA4 = getSourceColor(a4);
	let sourceColorB4 = getSourceColor(b4);
	let sourceColorC4 = getSourceColor(c4);
	let sourceColorD4 = getSourceColor(d4);
	let similar4 = isSimilar(sourceColorA4, sourceColorB4, sourceColorC4, sourceColorD4, 0.025 * uniforms.similarityThresholdFactor);

	if (similar4) {
		modUv = modVec2f(uv, cellSize * 4.0);
		cellSize = cellSize * 4.0;
		border /= 4.0;
	} else {
		// 4x4でまとめられる場合は、2x2判定の追加サンプリングを省く。
		let cellUv2 = getPixelatedUv(uv, cellSize * 2.0);
		let cellOffset2 = cellSize * 0.5;
		let a2 = cellUv2 + vec2f(-cellOffset2.x, -cellOffset2.y);
		let b2 = cellUv2 + vec2f(cellOffset2.x, -cellOffset2.y);
		let c2 = cellUv2 + vec2f(-cellOffset2.x, cellOffset2.y);
		let d2 = cellUv2 + vec2f(cellOffset2.x, cellOffset2.y);
		let sourceColorA2 = getSourceColor(a2);
		let sourceColorB2 = getSourceColor(b2);
		let sourceColorC2 = getSourceColor(c2);
		let sourceColorD2 = getSourceColor(d2);
		let similar2 = isSimilar(sourceColorA2, sourceColorB2, sourceColorC2, sourceColorD2, 0.1 * uniforms.similarityThresholdFactor);
		if (similar2) {
			modUv = modVec2f(uv, cellSize * 2.0);
			cellSize *= 2.0;
			border /= 2.0;
		}
	}

	let cellUv = getPixelatedUv(uv, cellSize);

	let sourceColor = getSourceColor(cellUv);
	let sourceColorLuminance = (sourceColor.r + sourceColor.g + sourceColor.b) / 3.0;

	var texSelector = remap(sourceColorLuminance, uniforms.shadowClipThreshold, uniforms.highlightClipThreshold, 0.0, 1.0); // クリップする範囲の分だけ範囲を圧縮する
	texSelector = remap(texSelector, 0.0, 1.0, uniforms.symbolTexturesRangeMin, uniforms.symbolTexturesRangeMax);

	let scale = min(1.0, 1.0 - border);
	var shift = vec2f(0.0);
	if (uniforms.forceFieldShift == 1) {
		shift = -getForceFieldAspectVector(cellUv) * cellSize;
	}
	let margin = (1.0 - scale) * 0.5 * cellSize;
	let transformedCoords = ((modUv + shift) - margin) / (cellSize - (margin * 2.0));
	var out_color = textureSample(symbolTextures, mySampler, vec2f(transformedCoords.x, 1.0 - transformedCoords.y), u32(texSelector * f32(uniforms.symbolTexturesCount)));
	if (transformedCoords.x < 0.0 || transformedCoords.x > 1.0 || transformedCoords.y < 0.0 || transformedCoords.y > 1.0) {
		out_color = vec4f(0.0); // 範囲外の参照は無として扱う
	}

	if (sourceColorLuminance > uniforms.highlightClipThreshold) {
		return vec4f(uniforms.bgColor.rgb, 1.0);
	}

	// fill background dots and blocks
	if (uniforms.enableClippedAreaFill == 1) {
		if (sourceColorLuminance < uniforms.shadowClipThreshold * 0.3) {
			return vec4f(uniforms.bgColor.rgb, 1.0);
		} else if (sourceColorLuminance < uniforms.shadowClipThreshold * 0.7) {
			if (distance(modUv / cellSize, vec2(0.5, 0.5)) < 0.05) {
				return vec4f(mix(uniforms.bgColor.rgb, uniforms.colorA.rgb, 0.25), 1.0);
			} else {
				return vec4f(uniforms.bgColor.rgb, 1.0);
			}
		} else if (sourceColorLuminance < uniforms.shadowClipThreshold) {
			return vec4f(mix(uniforms.bgColor.rgb, uniforms.colorA.rgb, 0.05), 1.0);
		}
	} else {
		if (sourceColorLuminance < uniforms.shadowClipThreshold) {
			return vec4f(uniforms.bgColor.rgb, 1.0);
		}
	}

	let isIn = (
		(modUv.x / cellSize.x) > (1.0 - scale) / 2.0 &&
		(modUv.x / cellSize.x) < 0.5 + (scale / 2.0) &&
		(modUv.y / cellSize.y) > (1.0 - scale) / 2.0 &&
		(modUv.y / cellSize.y) < 0.5 + (scale / 2.0)
	);

	if (!isIn) {
		return vec4f(uniforms.bgColor.rgb, 1.0);
	}

	if (uniforms.useOriginalColor == 0) {
		if (sourceColorLuminance > 0.7) { // apply colorA
			out_color = vec4f(uniforms.colorA.rgb, out_color.a);
		} else if (sourceColor.r > 0.75) { // apply colorC
			out_color = vec4f(uniforms.colorC.rgb, out_color.a);
		} else if (sourceColor.g > 0.4) { // apply colorB
			out_color = vec4f(uniforms.colorB.rgb, out_color.a);
		} else if (sourceColorLuminance < 0.2) { // apply colorA with lower opacity
			out_color = vec4f(uniforms.colorA.rgb, out_color.a * 0.7);
		} else { // apply colorA
			out_color = vec4f(uniforms.colorA.rgb, out_color.a);
		}
	}

	return vec4f(mix(uniforms.bgColor.rgb, out_color.rgb, out_color.a), 1.0);
}
