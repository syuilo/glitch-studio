struct Uniforms {
	canvasSize: vec2f,
	center: vec2f,
	hasGap: u32,
};

struct Region {
	bounds: vec4f,
	startPlane: vec3f,
	endPlane: vec3f,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> regions: array<Region>;

fn sampleRegion(index: u32, pixelPosition: vec2f) -> vec4f {
	let bounds = regions[index].bounds;
	if (any(bounds.zw <= vec2f(0.0))) { return vec4f(0.0); }
	// 画像は画面に対して正立させる。画像参照のFitはこの矩形の寸法を基準に設定済み。
	return read_inputs(index, (pixelPosition - bounds.xy) * 2.0 / bounds.zw);
}

fn boundaryCoverage(pixelPosition: vec2f, plane: vec3f) -> f32 {
	let distance = dot(pixelPosition, plane.xy) - plane.z;
	// 単位法線なのでdistanceはピクセル距離。画素が境界法線に占める幅でAAを行う。
	let pixelWidth = abs(plane.x) + abs(plane.y);
	return clamp(distance / pixelWidth + 0.5, 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) fragmentPosition: vec4f) -> @location(0) vec4f {
	if (count_inputs == 0u) { return vec4f(0.0); }
	// 補間された画像参照座標から逆算すると、中心の画素にも丸め誤差が残る。
	// 実際の画素中心から直接求め、奇数解像度でも中心ちょうどの規則を安定させる。
	let pixelPosition = (fragmentPosition.xy - uniforms.canvasSize * 0.5) * vec2f(1.0, -1.0);
	if (count_inputs == 1u) { return sampleRegion(0u, pixelPosition); }
	// 中心ちょうどには角度がない。Gapなしは先頭、Gapありは透明と定義する。
	if (all(pixelPosition == uniforms.center)) {
		if (uniforms.hasGap != 0u) { return vec4f(0.0); }
		return sampleRegion(0u, pixelPosition);
	}
	var color = vec4f(0.0);
	var totalCoverage = 0.0;
	for (var index = 0u; index < count_inputs; index++) {
		let region = regions[index];
		if (any(region.bounds.zw <= vec2f(0.0))) { continue; }
		let startCoverage = boundaryCoverage(pixelPosition, region.startPlane);
		let endCoverage = boundaryCoverage(pixelPosition, region.endPlane);
		// 2入力では両境界が同じ直線を表すため、同じAAを二度掛けない。
		let coverage = select(startCoverage * endCoverage, min(startCoverage, endCoverage), count_inputs == 2u);
		if (coverage <= 0.0) { continue; }
		color += sampleRegion(index, pixelPosition) * coverage;
		totalCoverage += coverage;
	}
	if (totalCoverage <= 0.0) { return vec4f(0.0); }
	// Gapなしでは被覆率を正規化し、複数境界が集まる中心付近にも透明な筋を作らない。
	// Gapありでは透明な被覆を残す。入力の乗算済みRGBAをそのまま混ぜ、HDR・負値を保持する。
	let normalization = select(totalCoverage, max(1.0, totalCoverage), uniforms.hasGap != 0u);
	return color / normalization;
}
