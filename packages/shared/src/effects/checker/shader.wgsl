/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

struct Uniforms {
	aspect: vec2f,
	sizeScale: vec2f,
	pixelSize: f32,
	color: vec4f,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct FragmentIn {
	@location(0) position: vec2f,
};

@fragment
fn fs(fragData: FragmentIn) -> @location(0) vec4f {
	let backgroundColor = read_background(fragData.position);
	let angle = read_angle(fragData.position) * 3.141592653589793;
	let inputSize = read_size(fragData.position);
	// 正の値はfitModeで選んだ基準領域の割合を短辺基準の座標へ変換する。
	// チェック模様は各軸2マスで一巡するため、sizeは1周期の大きさとし、1マスはその半分にする。
	// Stretch・Size=[1, 1]・Angle=0では、2×2マスの1周期が画面全体を覆う。
	// 各軸とも0以下のときだけfitModeによらず1マスを出力の1pxにし、正の値は1px未満も許す。
	let cellSize = select(min(inputSize, vec2f(1.0)) * uniforms.sizeScale * 0.5, vec2f(uniforms.pixelSize), inputSize <= vec2f(0.0));
	// 短辺基準で縦横の単位を揃え、長方形のマス目でも回転による歪みを防ぐ。
	let centeredUv = fragData.position * 0.5 * uniforms.aspect;
	let cosine = cos(angle);
	let sine = sin(angle);
	let rotatedUv = vec2f(
		centeredUv.x * cosine - centeredUv.y * sine,
		centeredUv.x * sine + centeredUv.y * cosine,
	);
	let cellIndex = floor(rotatedUv / cellSize);
	let indexSum = cellIndex.x + cellIndex.y;
	// WGSLの剰余演算では負の値が残るため、GLSLのmod(x, 2)をfloorで再現する。
	let checkerMask = indexSum - 2.0 * floor(indexSum * 0.5);
	let opacity = checkerMask * clamp(uniforms.color.a, 0.0, 1.0);

	// 元の入力alphaを維持する。定数色だけを入力alphaに合わせて乗算し、
	// 既にpremultipliedな入力RGBには再乗算しない。色自身のalphaは強度に反映する。
	return vec4f(mix(backgroundColor.rgb, uniforms.color.rgb * backgroundColor.a, opacity), backgroundColor.a);
}
