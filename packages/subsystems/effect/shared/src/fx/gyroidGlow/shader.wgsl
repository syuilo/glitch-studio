struct Uniforms {
	aspectRatio: f32,
	zoom: f32,
	rotation: f32,
	foldFrequency: f32,
	flowOffset: vec3f,
	spin: f32,
	orbPosition: vec3f,
	sheetStrength: f32,
	orbStrength: f32,
	colorPhase: f32,
	exposureMultiplier: f32,
	softShoulder: u32,
	outputAlpha: f32,
	maximumSteps: u32,
	foldAmount: f32,
	glowWidth: f32,
	sheetTilt: vec2f,
	colorMode: u32,
	colorFrequency: f32,
};
@group(0) @binding(0) var<uniform> uniforms: Uniforms;

const TAU = 6.283185307179586;
const FOLD_ROTATION = mat3x3f(
	0.704466, 0.706864, -0.063799,
	-0.297844, 0.376027, 0.877435,
	0.644218, -0.599121, 0.475434
);

fn rotationMatrix(angle: f32) -> mat2x2f {
	let cosine = cos(angle);
	let sine = sin(angle);
	return mat2x2f(cosine, sine, -sine, cosine);
}

fn folds(position: vec3f) -> f32 {
	// 膜の形状に変化を持たせるため、行列を左右から掛けた二つの座標系と異なる周波数を組み合わせる。
	// この値は膜の陰関数であり、最短距離を表すSDFではない。
	return dot(cos(FOLD_ROTATION * position), sin(1.37 * (position * FOLD_ROTATION)));
}

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	// Orb Colorは画面上の着色として一度だけ読む。ShaderInputはlinear・乗算済みで、
	// alphaを再乗算しない。発光量は色と強度の積で指定する。
	let orbEmission = read_orbColor(position).rgb * uniforms.orbStrength;
	// 高さ基準の画角。両軸を等方にしてから参照座標を反時計回りに回し、
	// 正のRotationで画像が時計回りに回るようにする。内部の3D座標は公開距離ではない。
	let viewPosition = rotationMatrix(uniforms.rotation) * (position * vec2f(uniforms.aspectRatio, 1.0)) / uniforms.zoom;
	let rayDirection = normalize(vec3f(viewPosition, 1.6));
	let spin = rotationMatrix(uniforms.spin);
	var rayDistance = 0.0;
	var accumulatedLight = vec3f(0.0);
	for (var step = 0u; step < uniforms.maximumSteps; step++) {
		if (rayDistance > 14.0) { break; }
		let rayPosition = rayDirection * rayDistance;
		// 行ベクトルの回転で膜を動かす。構図のRotationとは独立した膜の運動。
		let foldPosition = vec3f(rayPosition.xy * spin, rayPosition.z) + uniforms.flowOffset;
		let sheet = folds(foldPosition * (0.6 * uniforms.foldFrequency)) * min(rayDistance * 0.5, 1.0) * uniforms.foldAmount
			+ dot(rayPosition, vec3f(uniforms.sheetTilt, 0.0)) * 0.45 + 0.6;
		// 歩幅は形状だけで決める。発光幅・配色によってレイの到達位置や発光球の明るさを変えない。
		let stepLength = abs(sheet) * 0.25 + 0.01;
		rayDistance += stepLength;
		if (uniforms.glowWidth > 0.0 && uniforms.sheetStrength > 0.0) {
			let colorPosition = (rayPosition.z * 0.2 + foldPosition.x * 0.05) * uniforms.colorFrequency - uniforms.colorPhase;
			var tint: vec3f;
			if (uniforms.colorMode == 1u) {
				// 各地点の発光色を加算し、奥行き方向の色の混ざりを表現する。
				// Rampは乗算済みlinear RGBを返すため、alphaを再乗算しない。
				tint = evaluateColorRamp(fract(colorPosition)).rgb;
			} else {
				tint = vec3f(0.5, 0.45, 0.45) + vec3f(0.5, 0.42, 0.42) * cos(TAU * (colorPosition + vec3f(0.0, 0.18, 0.3)));
			}
			// 陰関数の0から離れるにつれて減衰する発光の幅。距離単位ではなく基準幅に対する倍率。
			// 中心のピークは幅に依存させず、幅を広げるほど周囲にも光が届くようにする。
			let glowFalloff = abs(sheet) * 0.25 / uniforms.glowWidth + 0.01;
			accumulatedLight += tint * (uniforms.sheetStrength / glowFalloff);
		}
		let orbOffset = rayPosition - uniforms.orbPosition;
		accumulatedLight += orbEmission * (stepLength * 200.0 / (dot(orbOffset, orbOffset) + 0.005));
	}

	// 光の強弱を際立たせるため、合計光量を二乗してコントラストを付け、その後の光量へEVを適用する。
	// ガンマ変換は表示側の責務。HDRモードではハイライトを圧縮しない。
	var color = accumulatedLight * accumulatedLight * (8e-8 * uniforms.exposureMultiplier);
	if (uniforms.softShoulder != 0u) {
		color = vec3f(1.0) - exp(-color);
	}
	// rgba16floatの有限範囲だけを守り、HDRを0〜1へ制限しない。
	// Emissionは被覆を持たない光なのでalpha=0でもRGBを消さない。
	return vec4f(min(color, vec3f(65504.0)), uniforms.outputAlpha);
}
