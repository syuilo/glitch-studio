// equivalent to GLSL's mod function
fn modVec2f(a: vec2f, b: vec2f) -> vec2f {
	return a - b * floor(a / b);
}

fn premultiplyAlpha(color: vec4f) -> vec4f {
	return vec4f(color.rgb * color.a, color.a);
}

// テクスチャ座標(0~1、+Yが下)に変換
fn convertTexCoords(uv: vec2f) -> vec2f {
	return vec2f(uv.x, -uv.y) * 0.5 + vec2f(0.5);
}

struct Uniforms {
	aspectRatio: f32,
	divisions: f32,
	margin: f32,
	symbolTexturesCount: u32,
	symbolTexturesRangeMin: f32,
	symbolTexturesRangeMax: f32,
	useOriginalColor: u32,
	sourceAspectRatio: f32,
	sourceContrast: f32,
	highlightClipThreshold: f32,
	shadowClipThreshold: f32,
	enableClippedAreaFill: u32,
	coverSource: u32,
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
@group(0) @binding(3) var sourceTexture: texture_2d<f32>;
@group(0) @binding(4) var symbolTextures: texture_2d_array<f32>;
@group(0) @binding(5) var forceFieldTexture: texture_2d<f32>;

// https://docs.arduino.cc/language-reference/en/functions/math/map/
fn remap(value: f32, inMin: f32, inMax: f32, outMin: f32, outMax: f32) -> f32 {
	return (value - inMin) * (outMax - outMin) / (inMax - inMin) + outMin;
}

fn getPixelatedUv(uv: vec2f, cellSize: vec2f) -> vec2f {
	return (cellSize * floor(uv / cellSize)) + (cellSize / 2.0);
}

fn getSourceColor(uv: vec2f) -> vec4f {
	let sourceScale = select(
		select(1.0, uniforms.sourceAspectRatio / uniforms.aspectRatio, uniforms.sourceAspectRatio < uniforms.aspectRatio),
		select(1.0, uniforms.sourceAspectRatio / uniforms.aspectRatio, uniforms.sourceAspectRatio > uniforms.aspectRatio),
		uniforms.coverSource == 1) * min(1.0, uniforms.aspectRatio);
	let sourceUvScale = vec2f(1.0, uniforms.sourceAspectRatio) / sourceScale;
	var sourceUv = uv * sourceUvScale;
	if (uniforms.forceFieldWarp == 1) {
		sourceUv -= getForceFieldAspectVector(uv) * sourceUvScale;
	}
	let color = textureSample(sourceTexture, mySampler, convertTexCoords(sourceUv));
	return vec4f(pow(color.rgb, vec3f(uniforms.sourceContrast)), color.a);
}

fn getForceFieldAspectVector(aspectUv: vec2f) -> vec2f {
	return scaleUvToCoverGivenAspectRatio(textureSample(forceFieldTexture, mySampler, convertTexCoords(unscaleUvToCoverGivenAspectRatio(aspectUv, uniforms.aspectRatio))).rg, uniforms.aspectRatio);
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
	var cellSize = vec2f(1.0 / (uniforms.divisions * 0.5));
	var border = uniforms.margin;
	var modUv = modVec2f(uv, cellSize);

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
	} else if (similar2) {
		modUv = modVec2f(uv, cellSize * 2.0);
		cellSize = cellSize * 2.0;
		border /= 2.0;
	}

	let cellUv = getPixelatedUv(uv, cellSize);

	let sourceColor = getSourceColor(cellUv);
	let sourceColorLuminance = (sourceColor.r + sourceColor.g + sourceColor.b) / 3.0;

	var texSelector = remap(sourceColorLuminance, uniforms.shadowClipThreshold, uniforms.highlightClipThreshold, 0.0, 1.0); // クリップする範囲の分だけ範囲を圧縮する
	texSelector = remap(texSelector, 0.0, 1.0, uniforms.symbolTexturesRangeMin, uniforms.symbolTexturesRangeMax);

	let scale = min(1.0, 1.0 - border);
	let shift = select(vec2f(0.0), -getForceFieldAspectVector(cellUv) * cellSize, uniforms.forceFieldShift == 1);
	let margin = (1.0 - (0.5 + (scale * 0.5))) * cellSize;
	let transformedCoords = ((modUv + shift) - margin) / (cellSize - (margin * 2.0));
	var out_color = textureSample(symbolTextures, mySampler, vec2f(transformedCoords.x, 1.0 - transformedCoords.y), u32(texSelector * f32(uniforms.symbolTexturesCount)));
	if (transformedCoords.x < 0.0 || transformedCoords.x > 1.0 || transformedCoords.y < 0.0 || transformedCoords.y > 1.0) {
		out_color = vec4f(0.0); // 範囲外の参照は無として扱う
	}

	if (sourceColorLuminance > uniforms.highlightClipThreshold) {
		return premultiplyAlpha(vec4f(uniforms.bgColor.rgb, 1.0));
	}

	// fill background dots and blocks
	if (uniforms.enableClippedAreaFill == 1) {
		if (sourceColorLuminance < uniforms.shadowClipThreshold * 0.3) {
			return premultiplyAlpha(vec4f(uniforms.bgColor.rgb, 1.0));
		} else if (sourceColorLuminance < uniforms.shadowClipThreshold * 0.7) {
			if (distance(modUv / cellSize, vec2(0.5, 0.5)) < 0.05) {
				return premultiplyAlpha(vec4f(mix(uniforms.bgColor.rgb, uniforms.colorA.rgb, 0.25), 1.0));
			} else {
				return premultiplyAlpha(vec4f(uniforms.bgColor.rgb, 1.0));
			}
		} else if (sourceColorLuminance < uniforms.shadowClipThreshold) {
			return premultiplyAlpha(vec4f(mix(uniforms.bgColor.rgb, uniforms.colorA.rgb, 0.05), 1.0));
		}
	} else {
		if (sourceColorLuminance < uniforms.shadowClipThreshold) {
			return premultiplyAlpha(vec4f(uniforms.bgColor.rgb, 1.0));
		}
	}

	let isIn = (
		(modUv.x / cellSize.x) > (1.0 - scale) / 2.0 &&
		(modUv.x / cellSize.x) < 0.5 + (scale / 2.0) &&
		(modUv.y / cellSize.y) > (1.0 - scale) / 2.0 &&
		(modUv.y / cellSize.y) < 0.5 + (scale / 2.0)
	);

	if (!isIn) {
		return premultiplyAlpha(vec4f(vec3f(uniforms.bgColor.rgb), 1.0));
	}

	if (uniforms.useOriginalColor == 0) {
		if ((sourceColor.r + sourceColor.g + sourceColor.b) / 3.0 > 0.7) { // apply colorA
			out_color = vec4f(uniforms.colorA.rgb, out_color.a);
		} else if (sourceColor.r > 0.75) { // apply colorC
			out_color = vec4f(uniforms.colorC.rgb, out_color.a);
		} else if (sourceColor.g > 0.4) { // apply colorB
			out_color = vec4f(uniforms.colorB.rgb, out_color.a);
		} else if ((sourceColor.r + sourceColor.g + sourceColor.b) / 3.0 < 0.2) { // apply colorA with lower opacity
			out_color = vec4f(uniforms.colorA.rgb, out_color.a * 0.7);
		} else { // apply colorA
			out_color = vec4f(uniforms.colorA.rgb, out_color.a);
		}
	}

	out_color.r = mix(uniforms.bgColor.r, out_color.r, out_color.a);
	out_color.g = mix(uniforms.bgColor.g, out_color.g, out_color.a);
	out_color.b = mix(uniforms.bgColor.b, out_color.b, out_color.a);
	out_color.a = 1.0;

	return premultiplyAlpha(out_color);
}
