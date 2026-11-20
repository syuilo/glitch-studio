struct Uniforms {
	aspect: vec2f,
	referenceExtent: vec2f,
	majorWidth: f32,
	minorDivisions: f32,
	minorWidth: f32,
	majorColor: vec4f,
	minorColor: vec4f,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct FragmentIn {
	@location(0) position: vec2f,
};

fn gridDistance(gridPosition: vec2f) -> f32 {
	// 負の座標でも同じ周期にし、最寄りの縦線・横線までの距離を求める。
	// 距離の最小値で判定するため、交差点でも二重に合成されない。
	let cellPosition = fract(gridPosition);
	let distanceToLine = min(cellPosition, vec2f(1.0) - cellPosition);
	return min(distanceToLine.x, distanceToLine.y);
}

@fragment
fn fs(fragData: FragmentIn) -> @location(0) vec4f {
	let backgroundColor = read_background(fragData.position);
	let angle = read_angle(fragData.position) * 6.283185307179586;
	// 制御用の入力は出力座標で読み、位相によって参照位置を動かさない。
	let phase = read_phase(fragData.position);
	// Frequencyは基準領域あたりの周期数。1未満も許し、0除算を避けるため最小値を0.01とする。
	let frequency = max(read_frequency(fragData.position), vec2f(0.01));
	let size = uniforms.referenceExtent / frequency;
	// 短辺全体が1となる中央原点の座標にし、セル寸法のX/Yで縦横の間隔を指定する。
	let centeredPosition = fragData.position * 0.5 * uniforms.aspect;
	let cosine = cos(angle);
	let sine = sin(angle);
	let rotatedPosition = vec2f(
		centeredPosition.x * cosine - centeredPosition.y * sine,
		centeredPosition.x * sine + centeredPosition.y * cosine,
	);
	var lineColor = vec4f(0.0);
	// 主線・補助線を同じ周期座標から生成し、位相を変えても互いの配置を保つ。
	let gridPosition = rotatedPosition / size + phase;
	// 線幅はそれぞれの格子間隔に対する割合。格子座標のまま判定し、
	// Frequencyを上げると間隔と線幅が一緒に縮むようにする。
	if (gridDistance(gridPosition) < uniforms.majorWidth * 0.5) {
		lineColor = uniforms.majorColor;
	} else if (uniforms.minorDivisions > 0.0) {
		// 補助線は補助格子の間隔が基準なので、分割数にも線幅が連動する。
		if (gridDistance(gridPosition * uniforms.minorDivisions) < uniforms.minorWidth * 0.5) {
			// 主線が透明でも、その領域に補助線は重ねない。
			lineColor = uniforms.minorColor;
		}
	}

	let opacity = clamp(lineColor.a, 0.0, 1.0);
	// 透明な背景にも線を描けるよう、source-overでalphaも合成する。
	// 定数色だけをpremultiplyし、既に乗算済みの背景RGBにはalphaを再乗算しない。
	return vec4f(
		lineColor.rgb * opacity + backgroundColor.rgb * (1.0 - opacity),
		opacity + backgroundColor.a * (1.0 - opacity),
	);
}
