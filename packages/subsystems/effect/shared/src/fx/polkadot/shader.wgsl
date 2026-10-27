struct Uniforms {
	aspect: vec2f,
	referenceExtent: vec2f,
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
	let angle = read_angle(fragData.position) * 6.283185307179586;
	// 制御用の入力は出力座標で読み、位相によって参照位置を動かさない。
	let phase = read_phase(fragData.position);
	// Densityは基準領域あたりの周期数。1未満を1にし、画素数による下限や密度の上限は設けない。
	let density = max(read_density(fragData.position), vec2f(1.0));
	let size = uniforms.referenceExtent / density;
	// 短辺基準で縦横の単位を揃え、楕円のドットでも回転による歪みを防ぐ。
	let centeredUv = fragData.position * 0.5 * uniforms.aspect;
	let cosine = cos(angle);
	let sine = sin(angle);
	let rotatedUv = vec2f(
		centeredUv.x * cosine - centeredUv.y * sine,
		centeredUv.x * sine + centeredUv.y * cosine,
	);
	// 主ドット・補助ドットの配置を保つため、分割前の座標へ同じ位相を加える。
	// 非整数の補助分割数では全体の周期が1とは限らないので、Phase自体は折り返さない。
	let gridPosition = rotatedUv / size + phase;
	var dotColor = vec4f(0.0);
	if (dotDistance(gridPosition) < uniforms.majorRadius * 0.5) {
		dotColor = uniforms.majorColor;
	} else if (uniforms.minorDivisions > 0.0 && dotDistance(gridPosition * uniforms.minorDivisions) < uniforms.minorRadius * 0.5) {
		// 主ドット内では補助ドットを重ねない（主ドットの不透明度が0でも同様）。
		dotColor = uniforms.minorColor;
	}

	let opacity = clamp(dotColor.a, 0.0, 1.0);
	// 透明な背景にもドットを描けるよう、source-overでalphaも合成する。
	// 定数色だけをpremultiplyし、既に乗算済みの背景RGBにはalphaを再乗算しない。
	return vec4f(
		dotColor.rgb * opacity + backgroundColor.rgb * (1.0 - opacity),
		opacity + backgroundColor.a * (1.0 - opacity),
	);
}
