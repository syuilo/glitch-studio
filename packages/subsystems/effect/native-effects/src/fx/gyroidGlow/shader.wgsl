struct Uniforms {
	viewHalfExtent: vec2f,
	zoom: f32,
	rotation: f32,
	cameraPosition: vec3f,
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
	maximumTraceDistance: f32,
	nearEmissionFadeDistance: f32,
	nearFoldFadeDistance: f32,
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

fn nearFadeFactor(distance: f32, fadeDistance: f32) -> f32 {
	// 距離0は抑制を無効にする。完了したフェードも除算前に返し、
	// 非常に小さい正の距離で除算がオーバーフローすることを避ける。
	if (fadeDistance <= 0.0 || distance >= fadeDistance) { return 1.0; }
	return distance / fadeDistance;
}

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	// Orb Colorは画面上の着色として一度だけ読む。ShaderInputはlinear・乗算済みで、
	// alphaを再乗算しない。発光量は色と強度の積で指定する。
	let orbEmission = read_orbColor(position).rgb * uniforms.orbStrength;
	// 長辺基準の等方座標へ換算してから参照方向を反時計回りに回し、画像を時計回りに回転する。
	// 初期カメラZ=0.8・Zoom=1で、Z=0の基準面の長辺全体が1になる透視投影。
	// 画角はカメラ位置へ依存させず、移動とZoomを独立させる。視線は常に-Z方向。
	let viewPosition = rotationMatrix(uniforms.rotation) * (position * uniforms.viewHalfExtent) / uniforms.zoom;
	let rayDirection = normalize(vec3f(viewPosition, -0.8));
	let spin = rotationMatrix(uniforms.spin);
	var rayDistance = 0.0;
	var accumulatedLight = vec3f(0.0);
	for (var step = 0u; step < uniforms.maximumSteps; step++) {
		if (rayDistance >= uniforms.maximumTraceDistance) { break; }
		let worldPosition = uniforms.cameraPosition + rayDirection * rayDistance;
		// 模様の座標は固定したワールド座標から換算する。周波数・配色の尺度と基準位置を
		// カメラや縦横比から独立させる。近傍のうねり抑制だけはカメラからの距離で適用する。
		let patternPosition = vec3f(worldPosition.xy * 2.0, 1.6 - worldPosition.z * 2.0);
		// 行ベクトルの回転で膜を動かす。構図のRotationとは独立した膜の運動。
		let foldPosition = vec3f(patternPosition.xy * spin, patternPosition.z) + uniforms.flowOffset;
		// うねりの強さだけを抑え、傾きと基準値は維持する。形状と歩幅を一緒に変えるため、
		// 発光だけのフェードとは分離し、現在のサンプル位置で評価する。
		let foldFade = nearFadeFactor(rayDistance, uniforms.nearFoldFadeDistance);
		let sheet = folds(foldPosition * (0.6 * uniforms.foldFrequency)) * uniforms.foldAmount * foldFade
			+ dot(patternPosition, vec3f(uniforms.sheetTilt, 0.0)) * 0.45 + 0.6;
		// 歩幅は形状だけで決める。発光幅・配色によってレイの到達位置や発光球の明るさを変えない。
		let requestedStepLength = abs(sheet) * 0.125 + 0.005;
		// 最後の区間を描画距離に収め、その区間が占める割合だけ膜の光を加える。
		// 最大距離を0へ近づけたときも、範囲外の光が残らず連続的に暗くなる。
		let stepLength = min(requestedStepLength, uniforms.maximumTraceDistance - rayDistance);
		let stepCoverage = stepLength / requestedStepLength;
		if (uniforms.glowWidth > 0.0 && uniforms.sheetStrength > 0.0) {
			let colorPosition = (patternPosition.z * 0.2 + foldPosition.x * 0.05) * uniforms.colorFrequency - uniforms.colorPhase;
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
			// 近傍で膜に入ったときの眩しさは形状を変形せず発光で抑える。
			// 打ち切り区間を含めて区間中央で評価し、歩幅と発光球には適用しない。
			let emissionFade = nearFadeFactor(rayDistance + stepLength * 0.5, uniforms.nearEmissionFadeDistance);
			accumulatedLight += tint * (uniforms.sheetStrength * emissionFade * stepCoverage / glowFalloff);
		}
		let orbOffset = worldPosition - uniforms.orbPosition;
		accumulatedLight += orbEmission * (stepLength * 100.0 / (dot(orbOffset, orbOffset) + 0.00125));
		rayDistance += stepLength;
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
