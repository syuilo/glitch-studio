/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

struct Uniforms {
	aspect: vec2f,
	angle: f32,
	scale: f32,
	color: vec4f,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct FragmentIn {
	@location(0) position: vec2f,
};

@fragment
fn fs(fragData: FragmentIn) -> @location(0) vec4f {
	let inputColor = read_input(fragData.position);
	// [-1, 1]から元の中央原点UVの単位に戻し、短辺基準でマス目を正方形に保つ。
	let centeredUv = fragData.position * 0.5 * uniforms.aspect;
	let cosine = cos(uniforms.angle);
	let sine = sin(uniforms.angle);
	let rotatedUv = vec2f(
		centeredUv.x * cosine - centeredUv.y * sine,
		centeredUv.x * sine + centeredUv.y * cosine,
	);
	let cellIndex = floor(uniforms.scale * rotatedUv);
	let indexSum = cellIndex.x + cellIndex.y;
	// WGSLの剰余演算では負の値が残るため、GLSLのmod(x, 2)をfloorで再現する。
	let checkerMask = indexSum - 2.0 * floor(indexSum * 0.5);
	let opacity = checkerMask * clamp(uniforms.color.a, 0.0, 1.0);

	// 元の入力alphaを維持する。定数色だけを入力alphaに合わせて乗算し、
	// 既にpremultipliedな入力RGBには再乗算しない。色自身のalphaは強度に反映する。
	return vec4f(mix(inputColor.rgb, uniforms.color.rgb * inputColor.a, opacity), inputColor.a);
}
