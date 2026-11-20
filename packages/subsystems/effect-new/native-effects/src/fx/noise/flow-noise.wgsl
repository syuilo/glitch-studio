// Adapted from psrdnoise3.glsl, version 2021-12-02.
// https://github.com/stegu/psrdnoise/blob/main/src/psrdnoise3.glsl
// Modified for WGSL: non-tiling 3D noise, rotation supplied as cosine/sine,
// and a struct result instead of an out parameter. See LICENSE.
// Copyright (c) 2021 Stefan Gustavson and Ian McEwan.

struct FlowNoiseSample {
	value: f32,
	gradient: vec3f,
};

fn flowNoisePermute(value: vec4f) -> vec4f {
	let wrapped = value - floor(value / 289.0) * 289.0;
	let polynomial = ((wrapped * 34.0) + 10.0) * wrapped;
	return polynomial - floor(polynomial / 289.0) * 289.0;
}

fn flowNoise(position: vec3f, rotation: vec2f) -> FlowNoiseSample {
	const toSimplex = mat3x3f(0, 1, 1, 1, 0, 1, 1, 1, 0);
	const fromSimplex = mat3x3f(-0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, -0.5);
	let simplexPosition = toSimplex * position;
	let corner0 = floor(simplexPosition);
	let fraction = fract(simplexPosition);
	// 同値のときの優先順位も参照実装に揃え、隣の四面体との境界を連続にする。
	let comparison = step(fraction.xyx, fraction.yzz);
	let complement = 1.0 - comparison;
	let rank0 = vec3f(complement.z, comparison.xy);
	let rank1 = vec3f(complement.xy, comparison.z);
	let corner1 = corner0 + min(rank0, rank1);
	let corner2 = corner0 + max(rank0, rank1);
	let corner3 = corner0 + 1.0;
	let displacement0 = position - fromSimplex * corner0;
	let displacement1 = position - fromSimplex * corner1;
	let displacement2 = position - fromSimplex * corner2;
	let displacement3 = position - fromSimplex * corner3;
	let hash = flowNoisePermute(flowNoisePermute(flowNoisePermute(
		vec4f(corner0.z, corner1.z, corner2.z, corner3.z))
		+ vec4f(corner0.y, corner1.y, corner2.y, corner3.y))
		+ vec4f(corner0.x, corner1.x, corner2.x, corner3.x));

	// 球面上の勾配と、それに直交するランダムな方向で回転面を作る。
	// 画面座標を回転するのではなく、各格子点の勾配そのものを回す。
	let azimuth = hash * 3.883222077;
	let height = hash * -0.006920415 + 0.996539792;
	let orientation = hash * 0.108705628;
	let azimuthCosine = cos(azimuth);
	let azimuthSine = sin(azimuth);
	let radius = sqrt(max(1.0 - height * height, vec4f(0.0)));
	let orientationSine = sin(orientation);
	let orientationCosine = cos(orientation);
	let initialX = azimuthCosine * radius;
	let initialY = azimuthSine * radius;
	let crossTerm = azimuthSine * orientationSine - azimuthCosine * orientationCosine;
	let perpendicularX = mix(crossTerm * azimuthSine, orientationSine, height);
	let perpendicularY = mix(-crossTerm * azimuthCosine, orientationCosine, height);
	let perpendicularZ = -(initialY * orientationCosine + initialX * orientationSine);
	let gradientX = rotation.x * initialX + rotation.y * perpendicularX;
	let gradientY = rotation.x * initialY + rotation.y * perpendicularY;
	let gradientZ = rotation.x * height + rotation.y * perpendicularZ;
	let gradient0 = vec3f(gradientX.x, gradientY.x, gradientZ.x);
	let gradient1 = vec3f(gradientX.y, gradientY.y, gradientZ.y);
	let gradient2 = vec3f(gradientX.z, gradientY.z, gradientZ.z);
	let gradient3 = vec3f(gradientX.w, gradientY.w, gradientZ.w);
	let weight = max(0.5 - vec4f(
		dot(displacement0, displacement0), dot(displacement1, displacement1),
		dot(displacement2, displacement2), dot(displacement3, displacement3)), vec4f(0.0));
	let weightSquared = weight * weight;
	let weightCubed = weightSquared * weight;
	let projection = vec4f(
		dot(gradient0, displacement0), dot(gradient1, displacement1),
		dot(gradient2, displacement2), dot(gradient3, displacement3));
	// 有限差分でノイズを複数回評価せず、値と同時に解析的な偏微分を求める。
	let weightDerivative = -6.0 * weightSquared * projection;
	let derivative0 = weightCubed.x * gradient0 + weightDerivative.x * displacement0;
	let derivative1 = weightCubed.y * gradient1 + weightDerivative.y * displacement1;
	let derivative2 = weightCubed.z * gradient2 + weightDerivative.z * displacement2;
	let derivative3 = weightCubed.w * gradient3 + weightDerivative.w * displacement3;
	return FlowNoiseSample(39.5 * dot(weightCubed, projection), 39.5 * (derivative0 + derivative1 + derivative2 + derivative3));
}
