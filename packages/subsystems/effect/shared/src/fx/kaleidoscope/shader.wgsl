struct Uniforms {
	center: vec2f,
	sourceCenter: vec2f,
	aspectRatio: f32,
	sectorAngle: f32,
	rotation: f32,
	sourceRotation: f32,
	zoom: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	// 出力の縦半径を距離の単位に揃え、長方形でも角度と半径を歪ませない。
	// 入力自身の縦横比とfitは共通入力に任せる。
	let outputExtent = vec2f(uniforms.aspectRatio, 1.0);
	let relativePosition = (position - uniforms.center) * outputExtent;
	let radius = length(relativePosition);
	var foldedAngle = 0.0;
	// 中心では角度を定義できないのでatan2(0, 0)を避ける。
	// 半径がゼロのため、どの角度でもSource Centerを参照する。
	if (radius > 0.0) {
		// 上向きを角度0、時計回りを正とし、Repetitionsを変えても上側の軸を固定する。
		// Rotationは出力全体の時計回りの回転なので、参照時には差し引く。
		let angle = atan2(relativePosition.x, relativePosition.y) - uniforms.rotation;
		// 1周期を中央で折り返し、[0, sectorAngle / 2]の扇形へ写す。
		// 正負の角度を同じ周期で扱うことで、全周の境界でも模様が連続する。
		let sectorPosition = fract(angle / uniforms.sectorAngle + 0.5);
		foldedAngle = abs(sectorPosition - 0.5) * uniforms.sectorAngle;
	}

	// 入力側の回転は取り込む扇形の向きだけを時計回りに変える。
	// 出力側の対称軸には影響させず、万華鏡の内部の模様を動かせるようにする。
	let sourceAngle = foldedAngle + uniforms.sourceRotation;
	// 入力も上向き基準で復元する。出力だけ基準を変えると画像が90°回転してしまうため、
	// 同じ座標変換を対にして使い、基準となる扇形では元画像の向きを保つ。
	let sourceOffset = radius / uniforms.zoom * vec2f(sin(sourceAngle), cos(sourceAngle));
	let sourcePosition = uniforms.sourceCenter + sourceOffset / outputExtent;
	// wrap・filterとpremultiplied alphaを含め、共通入力のサンプリング結果を保持する。
	return read_input(sourcePosition);
}
