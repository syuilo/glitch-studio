struct Uniforms {
	aspect: vec2f,
	sizeScale: vec2f,
	pixelSize: f32,
	majorRadius: f32,
	minorDivisions: f32,
	minorRadius: f32,
	majorColor: vec4f,
	minorColor: vec4f,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct FragmentIn {
	@location(0) position: vec2f,
};

fn dotDistance(gridPosition: vec2f) -> f32 {
	// GLSLのmodと同じく負の座標でも周期を保つ。セルの四隅のうち
	// 最も近い格子点までの距離で、元の四つの円の判定をまとめる。
	let cellPosition = fract(gridPosition);
	return length(min(cellPosition, vec2f(1.0) - cellPosition));
}

@fragment
fn fs(fragData: FragmentIn) -> @location(0) vec4f {
	let backgroundColor = read_background(fragData.position);
	let angle = read_angle(fragData.position) * 3.141592653589793;
	let inputSize = read_size(fragData.position);
	// 正の値はfitModeで選んだ基準領域の割合を短辺基準の座標へ変換する。
	// 各軸とも0以下のときだけfitModeによらず出力の1pxを周期にし、正の値は1px未満も許す。
	let size = select(min(inputSize, vec2f(1.0)) * uniforms.sizeScale, vec2f(uniforms.pixelSize), inputSize <= vec2f(0.0));
	// 短辺基準で縦横の単位を揃え、楕円のドットでも回転による歪みを防ぐ。
	let centeredUv = fragData.position * 0.5 * uniforms.aspect;
	let cosine = cos(angle);
	let sine = sin(angle);
	let rotatedUv = vec2f(
		centeredUv.x * cosine - centeredUv.y * sine,
		centeredUv.x * sine + centeredUv.y * cosine,
	);
	let gridPosition = rotatedUv / size;
	var dotColor = vec4f(0.0);
	if (dotDistance(gridPosition) < uniforms.majorRadius * 0.5) {
		dotColor = uniforms.majorColor;
	} else if (uniforms.minorDivisions > 0.0 && dotDistance(gridPosition * uniforms.minorDivisions) < uniforms.minorRadius * 0.5) {
		// 主ドット内では補助ドットを重ねない（主ドットの不透明度が0でも同様）。
		dotColor = uniforms.minorColor;
	}

	// 元の入力alphaを維持する。定数色だけを入力alphaに合わせて乗算し、
	// 既にpremultipliedな入力RGBには再乗算しない。色自身のalphaは強度に反映する。
	return vec4f(mix(backgroundColor.rgb, dotColor.rgb * backgroundColor.a, clamp(dotColor.a, 0.0, 1.0)), backgroundColor.a);
}
