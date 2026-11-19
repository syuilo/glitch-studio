fn lightnessAt(position: vec2f, fallback: f32) -> f32 {
	let weighted = readWeightedLightness(position);
	// alphaの境界だけを黒い線にしない。透明な近傍は中心画素と同じ明度とみなす。
	if (weighted.y <= 0.0) { return fallback; }
	return weighted.x / weighted.y;
}

fn outlineCoverage(position: vec2f, lightness: f32) -> f32 {
	if (uniforms.outlineWidth <= 0.0 || uniforms.outlineStrength <= 0.0) { return 0.0; }
	let step = uniforms.referenceToPosition * uniforms.outlineWidth * 0.5;
	let topLeft = lightnessAt(position + vec2f(-step.x, step.y), lightness);
	let top = lightnessAt(position + vec2f(0.0, step.y), lightness);
	let topRight = lightnessAt(position + step, lightness);
	let left = lightnessAt(position + vec2f(-step.x, 0.0), lightness);
	let right = lightnessAt(position + vec2f(step.x, 0.0), lightness);
	let bottomLeft = lightnessAt(position - step, lightness);
	let bottom = lightnessAt(position + vec2f(0.0, -step.y), lightness);
	let bottomRight = lightnessAt(position + vec2f(step.x, -step.y), lightness);
	// 段階化前の明暗にSobelを適用するので、網点や階調境界は輪郭へ混入しない。
	let gradient = vec2f(topRight + 2.0 * right + bottomRight - topLeft - 2.0 * left - bottomLeft,
		topLeft + 2.0 * top + topRight - bottomLeft - 2.0 * bottom - bottomRight) * 0.25;
	let threshold = 1.0 - uniforms.outlineSensitivity;
	return smoothstep(threshold, threshold + 0.1, length(gradient)) * uniforms.outlineStrength;
}

fn toneCoverage(referencePosition: vec2f, lightness: f32) -> f32 {
	let steps = uniforms.levels - 1.0;
	let quantized = floor(clamp(lightness, 0.0, 1.0) * steps + 0.5) / steps;
	// linear空間での面積平均が指定の知覚明度になるように網点の面積を決める。
	// sRGBの数値をそのまま面積率にすると、中間調が明るくなりすぎる。
	let coverage = 1.0 - colorSrgbToLinear(vec3f(quantized)).x;
	if (coverage <= 0.0 || coverage >= 1.0) { return coverage; }
	let cosine = cos(uniforms.toneAngle);
	let sine = sin(uniforms.toneAngle);
	let grid = vec2f(referencePosition.x * cosine - referencePosition.y * sine,
		referencePosition.x * sine + referencePosition.y * cosine) * uniforms.toneFrequency;
	// 暗部では同じ格子のセル中央に白い穴を残す。円が重なることによる
	// 面積率の誤差を避け、濃いトーンも黒ベタまで連続した濃さで表せる。
	let inverted = coverage > 0.5;
	let minorityCoverage = min(coverage, 1.0 - coverage);
	let centerOffset = select(0.0, 0.5, inverted);
	let distance = length(fract(grid + centerOffset + 0.5) - 0.5);
	let radius = sqrt(minorityCoverage / 3.141592653589793);
	let pixelFootprint = uniforms.toneFrequency / uniforms.referencePixels;
	let antialias = max(pixelFootprint * 0.70710678, 0.00001);
	let disk = 1.0 - smoothstep(radius - antialias, radius + antialias, distance);
	let pattern = select(disk, 1.0 - disk, inverted);
	// 4画素/周期から平均色へ移行し、2画素/周期で完全に平均化する。
	// 解像できない網点を残すと縮小・動画でモアレやちらつきが生じる。
	return mix(pattern, coverage, smoothstep(0.25, 0.5, pixelFootprint));
}

fn grainHash(cell: vec2i) -> f32 {
	var hash = bitcast<u32>(cell.x) * 374761393u + bitcast<u32>(cell.y) * 668265263u + uniforms.seed * 1442695041u;
	hash = (hash ^ (hash >> 13u)) * 1274126177u;
	hash = hash ^ (hash >> 16u);
	return f32(hash >> 8u) / 16777216.0;
}

fn paperNoise(referencePosition: vec2f) -> f32 {
	let position = referencePosition * uniforms.paperGrainFrequency;
	let cell = vec2i(floor(position));
	let fraction = fract(position);
	let weight = fraction * fraction * (3.0 - 2.0 * fraction);
	let noise = mix(mix(grainHash(cell), grainHash(cell + vec2i(1, 0)), weight.x),
		mix(grainHash(cell + vec2i(0, 1)), grainHash(cell + vec2i(1, 1)), weight.x), weight.y);
	let pixelFootprint = uniforms.paperGrainFrequency / uniforms.referencePixels;
	return mix(noise, 0.5, smoothstep(0.25, 1.0, pixelFootprint));
}

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let input = read_input(position);
	// alpha=0の発光は通常の未乗算色へ戻せないため、他の非線形色調整と同じく保持する。
	if (uniforms.amount <= 0.0 || input.a <= 0.0) { return input; }
	let referencePosition = position * uniforms.positionToReference;
	let lightness = lightnessAt(position, 1.0);
	let tone = toneCoverage(referencePosition, lightness);
	let outline = outlineCoverage(position, lightness);
	let coverage = tone + (1.0 - tone) * outline;
	// 紙の質感はインクには加えず、紙の反射色だけを弱く変調する。
	let paper = uniforms.paperColor.rgb * (1.0 - 0.2 * uniforms.paperGrain * paperNoise(referencePosition));
	let printed = mix(paper, uniforms.inkColor.rgb, coverage);
	return vec4f(mix(input.rgb, printed * input.a, uniforms.amount), input.a);
}
