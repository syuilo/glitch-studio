struct Uniforms {
	aspect: vec2f,
	referenceExtent: vec2f,
	lineWidth: f32,
	lineColor: vec4f,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct FragmentIn {
	@location(0) position: vec2f,
};

fn hexEdgeDistance(position: vec2f) -> f32 {
	// 隣接中心間距離1の三角格子を、半周期ずらした二つの長方形格子で表す。
	// それぞれの最寄り中心を比較すれば、所属する六角セルが定まる。
	// floor(x + 0.5)を使うことで負の座標でも同じ周期で繰り返す。
	let period = vec2f(1.0, 1.7320508075688772);
	let offsetA = position - floor(position / period + vec2f(0.5)) * period;
	let shiftedPosition = position - period * 0.5;
	let offsetB = shiftedPosition - floor(shiftedPosition / period + vec2f(0.5)) * period;
	let localPosition = abs(select(offsetA, offsetB, dot(offsetB, offsetB) < dot(offsetA, offsetA)));
	// 六辺の単位法線への射影の最大値を、内接円半径0.5から引く。
	// 最寄りの辺までの距離なので、頂点でも線を重複して合成しない。
	return max(0.0, 0.5 - max(localPosition.x, dot(localPosition, vec2f(0.5, 0.8660254037844386))));
}

@fragment
fn fs(fragData: FragmentIn) -> @location(0) vec4f {
	let backgroundColor = read_background(fragData.position);
	let angle = read_angle(fragData.position) * 6.283185307179586;
	// 制御用の入力は出力座標で読み、位相によって参照位置を動かさない。
	let phase = read_phase(fragData.position);
	// Frequencyは基準領域あたりの周期数。1未満も許し、0除算を避けるため最小値を0.01とする。
	let frequency = max(read_frequency(fragData.position), vec2f(0.01));
	// 直交するローカルX/Y軸の1周期。六角格子固有の縦横比は周期座標の算出後に適用する。
	let periodSize = uniforms.referenceExtent / frequency;
	let centeredPosition = fragData.position * 0.5 * uniforms.aspect;
	let cosine = cos(angle);
	let sine = sin(angle);
	let rotatedPosition = vec2f(
		centeredPosition.x * cosine - centeredPosition.y * sine,
		centeredPosition.x * sine + centeredPosition.y * cosine,
	);
	// X/YともPhase=1で1周期となる座標を作り、格子固有の周期[1, √3]へ変換する。
	// Yの周波数にも√3を適用することで、他のパターンと同じく周期長を基準寸法 / Frequencyに揃える。
	let cyclePosition = rotatedPosition / periodSize + phase;
	let gridPosition = cyclePosition * vec2f(1.0, 1.7320508075688772);
	// 線幅は六角セルの対辺間距離に対する割合で、セル寸法と一緒に拡縮する。
	let edgeDistance = hexEdgeDistance(gridPosition);
	let isLine = uniforms.lineWidth > 0.0 && edgeDistance <= uniforms.lineWidth * 0.5;
	// セル内部はBackgroundをそのまま表示し、線の部分だけを着色する。
	let opacity = select(0.0, clamp(uniforms.lineColor.a, 0.0, 1.0), isLine);
	// 透明な背景にも線を描けるよう、source-overでalphaも合成する。
	// 定数色だけをpremultiplyし、既に乗算済みの背景RGBにはalphaを再乗算しない。
	return vec4f(
		uniforms.lineColor.rgb * opacity + backgroundColor.rgb * (1.0 - opacity),
		opacity + backgroundColor.a * (1.0 - opacity),
	);
}
