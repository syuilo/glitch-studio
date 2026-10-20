// Adapted from Shaders ObjectTracker / gpu/kit/overlayParts (MIT).
// Copyright (c) 2026 Shader Effects Inc. See LICENSE.
struct Uniforms {
	resolution: vec2f,
	threshold: f32,
	cellSize: f32,
	detectionMode: u32,
	partitionLayout: u32,
	maxDepth: u32,
	boxStyle: u32,
	lineWidth: f32,
	cornerRadius: f32,
	labelMode: u32,
	labelPosition: u32,
	labelRadius: f32,
	labelInset: u32,
	fontSize: f32,
	letterSpacing: f32,
	strokeColor: vec4f,
	fillColor: vec4f,
	labelColor: vec4f,
	labelBackgroundColor: vec4f,
};
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var glyphAtlas: texture_2d<f32>;
@group(0) @binding(2) var glyphSampler: sampler;

fn contentAt(pixel: vec2f) -> bool {
	// 検出・ラベルは左上原点の画素座標、入力参照は中央原点でYが上向き。
	let uv = pixel / uniforms.resolution;
	let sample = read_input(vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0));
	// 入力はpremultiplied alphaなので、半透明の明るい色を暗い色と誤判定しないよう戻す。
	let rgb = sample.rgb / max(sample.a, 0.0001);
	let luminance = dot(rgb, vec3f(0.299, 0.587, 0.114));
	switch uniforms.detectionMode {
		case 0u: { return sample.a > uniforms.threshold; }
		case 1u: { return luminance > uniforms.threshold && sample.a > 0.02; }
		case 2u: { return luminance < uniforms.threshold && sample.a > 0.5; }
		case 3u: { return rgb.r > uniforms.threshold && rgb.r >= rgb.g && rgb.r >= rgb.b && sample.a > 0.02; }
		case 4u: { return rgb.g > uniforms.threshold && rgb.g >= rgb.r && rgb.g >= rgb.b && sample.a > 0.02; }
		default: { return rgb.b > uniforms.threshold && rgb.b >= rgb.r && rgb.b >= rgb.g && sample.a > 0.02; }
	}
}

struct CellScan {
	coverage: f32,
	minimum: vec2f,
	maximum: vec2f,
};

fn scanCell(origin: vec2f, size: f32, samples: u32) -> CellScan {
	var count = 0.0;
	var minimum = vec2f(1e9);
	var maximum = vec2f(-1e9);
	for (var y = 0u; y < samples; y++) {
		for (var x = 0u; x < samples; x++) {
			let pixel = origin + (vec2f(f32(x), f32(y)) + 0.5) * size / f32(samples);
			if (contentAt(pixel)) {
				count += 1.0;
				minimum = min(minimum, pixel);
				maximum = max(maximum, pixel);
			}
		}
	}
	return CellScan(count / f32(samples * samples), minimum, maximum);
}

fn roundRectDistance(point: vec2f, extent: vec2f, radius: f32) -> f32 {
	let q = abs(point) - extent + radius;
	return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - radius;
}

fn over(destination: vec4f, color: vec4f, coverage: f32) -> vec4f {
	let alpha = clamp(color.a * coverage, 0.0, 1.0);
	return vec4f(color.rgb * alpha, alpha) + destination * (1.0 - alpha);
}

fn digitCount(value: f32) -> f32 {
	return 1.0 + step(10.0, value) + step(100.0, value) + step(1000.0, value) + step(10000.0, value);
}

fn digitAt(value: f32, exponent: f32) -> f32 {
	let shifted = floor(value / pow(10.0, exponent));
	return shifted - 10.0 * floor(shifted / 10.0);
}

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let pixel = vec2f(position.x + 1.0, 1.0 - position.y) * uniforms.resolution * 0.5;
	// 分岐より先に微分を求める。セル探索後の非一様な制御フローではfwidthを使わない。
	let aa = max(max(fwidth(pixel.x), fwidth(pixel.y)), 0.0001);
	let scale = uniforms.resolution.y / 1080.0;
	let cellSize = max(uniforms.cellSize * scale, 4.0);
	let lineHalf = max(uniforms.lineWidth * scale * 0.5, 0.5);
	let inset = lineHalf + scale * 1.5;
	var origin = floor(pixel / cellSize) * cellSize;
	var size = cellSize;
	if (uniforms.partitionLayout != 0u) {
		for (var level = 0u; level < uniforms.maxDepth; level++) {
			var split = false;
			if (uniforms.partitionLayout == 2u) {
				// 時刻や描画履歴を使わずセルと深さだけで決め、再レンダリングでも分割を再現する。
				split = fract(sin(dot(origin / size, vec2f(127.1, 311.7)) + f32(level) * 53.13) * 43758.5453) > 0.5;
			} else {
				let scan = scanCell(origin, size, 3u);
				split = scan.coverage > 0.02 && scan.coverage < 0.98;
			}
			let childSize = size * 0.5;
			origin = select(origin, origin + step(origin + childSize, pixel) * childSize, split);
			size = select(size, childSize, split);
		}
	}
	let leaf = scanCell(origin, size, 4u);
	let innerMin = origin + inset;
	let innerMax = max(origin + size - inset, innerMin);
	// サンプル点を面積に広げてからセルの内側に制限し、隣のセルの枠と重ならないようにする。
	let boxMin = clamp(leaf.minimum - size / 8.0, innerMin, innerMax);
	let boxMax = clamp(leaf.maximum + size / 8.0, innerMin, innerMax);
	let boxSize = boxMax - boxMin;
	var destination = read_input(position);
	if (leaf.coverage <= 0.02 || any(boxSize <= vec2f(3.0 * scale))) { return destination; }
	let extent = boxSize * 0.5;
	let relative = pixel - (boxMin + boxMax) * 0.5;
	let radius = clamp(select(uniforms.cornerRadius * scale, 0.0, uniforms.boxStyle == 1u), 0.0, min(extent.x, extent.y));
	let distance = roundRectDistance(relative, extent, radius);
	let fill = 1.0 - smoothstep(0.0, aa, distance);
	var stroke = 1.0 - smoothstep(0.0, aa, abs(distance) - lineHalf);
	if (uniforms.boxStyle == 1u) {
		let bracketLength = min(extent.x, extent.y) * 0.35;
		stroke *= select(0.0, 1.0, all(abs(relative) > extent - bracketLength));
	}
	destination = over(destination, uniforms.fillColor, fill);
	destination = over(destination, uniforms.strokeColor, stroke);
	if (uniforms.labelMode == 0u) { return destination; }

	let textHeight = max(uniforms.fontSize * uniforms.resolution.y, 1.0);
	let glyphWidth = textHeight * (64.0 / 96.0);
	let advance = max(glyphWidth + textHeight * uniforms.letterSpacing, textHeight * 0.01);
	let padding = textHeight * vec2f(0.38, 0.24);
	let gap = textHeight * 0.28;
	let widthValue = clamp(floor(boxSize.x + 0.5), 1.0, 99999.0);
	let heightValue = clamp(floor(boxSize.y + 0.5), 1.0, 99999.0);
	let percentage = clamp(floor(leaf.coverage * 100.0 + 0.5), 0.0, 100.0);
	let widthDigits = digitCount(widthValue);
	let heightDigits = digitCount(heightValue);
	let percentageDigits = digitCount(percentage);
	let total = select(percentageDigits + 1.0, widthDigits + 1.0 + heightDigits, uniforms.labelMode == 1u);
	let labelSize = vec2f(total * advance, textHeight) + 2.0 * padding;
	let right = uniforms.labelPosition == 1u || uniforms.labelPosition == 3u;
	let top = uniforms.labelPosition >= 2u;
	let insetLabel = uniforms.labelInset != 0u;
	let outsideX = select(boxMin.x, boxMax.x - labelSize.x, right);
	let insideX = select(boxMin.x + gap, boxMax.x - labelSize.x - gap, right);
	let outsideY = select(boxMax.y + gap, boxMin.y - labelSize.y - gap, top);
	let insideY = select(boxMax.y - labelSize.y - gap, boxMin.y + gap, top);
	// ラベルは自分のセルの画素で描くため、セル外へ出すと途中で切れてしまう。
	let labelOrigin = clamp(vec2f(select(outsideX, insideX, insetLabel), select(outsideY, insideY, insetLabel)), origin, max(origin, origin + size - labelSize));
	let pillExtent = labelSize * 0.5;
	let pillRadius = clamp(uniforms.labelRadius * scale, 0.0, min(pillExtent.x, pillExtent.y));
	let pillDistance = roundRectDistance(pixel - labelOrigin - pillExtent, pillExtent, pillRadius);
	destination = over(destination, uniforms.labelBackgroundColor, 1.0 - smoothstep(0.0, aa, pillDistance));
	let textPosition = pixel - labelOrigin - padding;
	let slot = floor(textPosition.x / advance);
	let glyphUv = vec2f(fract(textPosition.x / advance) * advance / glyphWidth, textPosition.y / textHeight);
	if (textPosition.x >= 0.0 && slot >= 0.0 && slot < total && all(glyphUv >= vec2f(0.0)) && all(glyphUv <= vec2f(1.0))) {
		var glyph = 11.0;
		if (uniforms.labelMode == 1u) {
			if (slot < widthDigits) {
				glyph = digitAt(widthValue, widthDigits - 1.0 - slot);
			} else if (slot == widthDigits) {
				glyph = 10.0;
			} else {
				glyph = digitAt(heightValue, heightDigits + widthDigits - slot);
			}
		} else if (slot < percentageDigits) {
			glyph = digitAt(percentage, percentageDigits - 1.0 - slot);
		}
		let coverage = textureSampleLevel(glyphAtlas, glyphSampler, vec2f((glyph + glyphUv.x) / 16.0, glyphUv.y), 0.0).a;
		destination = over(destination, uniforms.labelColor, coverage);
	}
	// Glitch Studioのエフェクト出力はpremultiplied alphaのまま次へ渡す。
	return destination;
}
