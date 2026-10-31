struct Uniforms {
	center: vec2f,
	sourceCenter: vec2f,
	aspectRatio: f32,
	sectorAngle: f32,
	rotation: f32,
	sourceRotation: f32,
	zoom: f32,
	twist: f32,
	radialRepeat: f32,
	radialPhase: f32,
	mirror: u32,
	angularSkew: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	// 出力の縦半径を距離の単位に揃え、長方形でも角度と半径を歪ませない。
	// 入力自身の縦横比とfitは共通入力に任せる。
	let outputExtent = vec2f(uniforms.aspectRatio, 1.0);
	let relativePosition = (position - uniforms.center) * outputExtent;
	let radius = length(relativePosition);
	var repeatedAngle = 0.0;
	// 中心では角度を定義できないのでatan2(0, 0)を避ける。
	// Radial Phaseによって入力の中心以外を参照する場合も、中心の角度は上向きに固定する。
	if (radius > 0.0) {
		// 上向きを角度0、時計回りを正とし、Repetitionsを変えても上側の軸を固定する。
		// Rotationは出力全体の時計回りの回転なので、参照時には差し引く。
		// Twistは折り返し前の角度に適用し、対称軸そのものを渦巻きにする。
		// 半径方向の反復やZoomより前の距離を使い、リングをまたいでもねじれを連続させる。
		let angle = atan2(relativePosition.x, relativePosition.y) - uniforms.rotation - uniforms.twist * radius;
		if (uniforms.mirror != 0u) {
			if (uniforms.angularSkew == 0.0) {
				// 1周期を中央で折り返し、[0, sectorAngle / 2]の扇形へ写す。
				// 正負の角度を同じ周期で扱うことで、全周の境界でも模様が連続する。
				let sectorPosition = fract(angle / uniforms.sectorAngle + 0.5);
				repeatedAngle = abs(sectorPosition - 0.5) * uniforms.sectorAngle;
			} else {
				// 開始角を固定したまま、1周期の折り返し位置だけを移動する。
				// 各側は同じ入力扇形[0, sectorAngle / 2]をたどり、幅に応じて伸縮する。
				let sectorPosition = fract(angle / uniforms.sectorAngle);
				let midpoint = (uniforms.angularSkew + 1.0) * 0.5;
				// 基準角では0を保つ。幅0の側を評価しないことで±1でも0除算を避ける。
				if (sectorPosition > 0.0) {
					if (sectorPosition < midpoint) {
						repeatedAngle = sectorPosition / midpoint * (uniforms.sectorAngle * 0.5);
					} else {
						repeatedAngle = (1.0 - sectorPosition) / (1.0 - midpoint) * (uniforms.sectorAngle * 0.5);
					}
				}
			}
		} else {
			// 上向きを扇形の開始方向に保ち、向きを反転せず[0, sectorAngle)を反復する。
			// 入力の両端を接続するため、扇形の境界では模様に継ぎ目が生じる場合がある。
			repeatedAngle = fract(angle / uniforms.sectorAngle) * uniforms.sectorAngle;
		}
	}

	var sourceRadius = radius;
	if (uniforms.radialRepeat > 0.0) {
		// 1周期で入力の中心から外へ進み、同じ経路を戻る三角波にする。
		// 周期境界でも入力の参照位置が繋がるため、同心円状の切れ目を作らない。
		// 位相を差し引くことで、値を増やすと模様が外側へ移動する。
		let radialCycle = fract(radius * uniforms.radialRepeat - uniforms.radialPhase);
		// 周波数で割って周期内の倍率を保つ。位相0では周波数を0に近づけると
		// 最初の折り返しが遠ざかり、反復なしの半径に自然に繋がる。
		// 小さい周波数でも桁落ちしにくい形で計算する。
		sourceRadius = min(radialCycle, 1.0 - radialCycle) / uniforms.radialRepeat;
	}

	// 入力側の回転は取り込む扇形の向きだけを時計回りに変える。
	// 出力側の対称軸には影響させず、万華鏡の内部の模様を動かせるようにする。
	let sourceAngle = repeatedAngle + uniforms.sourceRotation;
	// 入力も上向き基準で復元する。出力だけ基準を変えると画像が90°回転してしまうため、
	// 同じ座標変換を対にして使い、基準となる扇形では元画像の向きを保つ。
	let sourceOffset = sourceRadius / uniforms.zoom * vec2f(sin(sourceAngle), cos(sourceAngle));
	let sourcePosition = uniforms.sourceCenter + sourceOffset / outputExtent;
	// wrap・filterとpremultiplied alphaを含め、共通入力のサンプリング結果を保持する。
	return read_input(sourcePosition);
}
