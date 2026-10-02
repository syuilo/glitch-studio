struct Uniforms {
	aspect: vec2f,
	referenceExtent: vec2f,
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
	// Densityは基準領域あたりの周期数。1未満を1にし、画素数による下限や密度の上限は設けない。
	let density = max(read_density(fragData.position), vec2f(1.0));
	// 各軸2マスで1周期。Stretch・Density=[1, 1]・Angle=0なら1周期が画面全体を覆う。
	let cellSize = uniforms.referenceExtent / density * 0.5;
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

	// 透明な背景にもパターンを描けるよう、source-overでalphaも合成する。
	// 定数色だけをpremultiplyし、既に乗算済みの背景RGBにはalphaを再乗算しない。
	return vec4f(
		uniforms.color.rgb * opacity + backgroundColor.rgb * (1.0 - opacity),
		opacity + backgroundColor.a * (1.0 - opacity),
	);
}
