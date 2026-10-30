struct Uniforms {
	aspect: vec2f,
	cellSize: vec2f,
	translationUnitScale: vec2f,
	phase: vec2f,
	angle: f32,
	controlSamples: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct CellControls {
	selection: f32,
	opacity: f32,
	translation: vec2f,
	scale: vec2f,
	rotation: f32,
};

fn sampleCellControls(cellCenter: vec2f, cosine: f32, sine: f32) -> CellControls {
	// Pixelateと同じ等面積の層化サンプリング。行の高さを列数に比例させることで、
	// 平方数以外でも指定数のサンプルを同じ重みで平均できる。1なら中心を読む。
	let rowCount = u32(sqrt(f32(uniforms.controlSamples)));
	let baseColumns = uniforms.controlSamples / rowCount;
	let extraRows = uniforms.controlSamples % rowCount;
	var completedSamples = 0u;
	var selection = 0.0;
	var opacity = 0.0;
	var translation = vec2f(0.0);
	var scale = vec2f(0.0);
	var rotation = 0.0;
	for (var row = 0u; row < rowCount; row++) {
		let columns = baseColumns + select(0u, 1u, row < extraRows);
		let localY = (f32(completedSamples) + 0.5 * f32(columns)) / f32(uniforms.controlSamples) - 0.5;
		for (var column = 0u; column < columns; column++) {
			let localX = (f32(column) + 0.5) / f32(columns) - 0.5;
			let gridSample = cellCenter + vec2f(localX, localY) * uniforms.cellSize;
			// 格子の逆変換で出力座標へ戻す。個別の移動・拡縮・回転では評価領域を動かさず、
			// 同じセルの全画素が同じ属性値を得るようにする。
			let samplePosition = vec2f(
				cosine * gridSample.x + sine * gridSample.y,
				-sine * gridSample.x + cosine * gridSample.y,
			) * 2.0 / uniforms.aspect;
			selection += read_perCellSelection(samplePosition);
			opacity += read_perCellOpacity(samplePosition);
			translation += read_perCellTranslation(samplePosition);
			scale += read_perCellScale(samplePosition);
			// 他のスカラーと同じ算術平均。1周で折り返してからの平均や円周平均はしない。
			rotation += read_perCellRotation(samplePosition);
		}
		completedSamples += columns;
	}
	let sampleCount = f32(uniforms.controlSamples);
	return CellControls(selection / sampleCount, opacity / sampleCount, translation / sampleCount, scale / sampleCount, rotation / sampleCount);
}

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	if (count_inputs == 0u) { return vec4f(0.0); }
	let cosine = cos(uniforms.angle);
	let sine = sin(uniforms.angle);
	// 短辺基準で縦横の距離を揃えてから格子を逆回転する。
	// 正のAngleで格子と素材が一緒に時計回りへ回る。
	let physicalPosition = position * 0.5 * uniforms.aspect;
	let gridPosition = vec2f(
		cosine * physicalPosition.x - sine * physicalPosition.y,
		sine * physicalPosition.x + cosine * physicalPosition.y,
	);
	let cellIndex = floor(gridPosition / uniforms.cellSize + uniforms.phase);
	let cellCenter = (cellIndex + 0.5 - uniforms.phase) * uniforms.cellSize;
	let controls = sampleCellControls(cellCenter, cosine, sine);
	let opacity = clamp(controls.opacity, 0.0, 1.0);
	if (opacity == 0.0 || any(abs(controls.scale) < vec2f(0.000001))) { return vec4f(0.0); }

	// 入力単位を、格子の計算と同じ短辺基準の物理座標へ変換する。
	// Cellでは1を変形前のセル幅／高さ1つ分とし、セルに対する移動量の比率を保つ。
	// Screenでは1を画面幅／高さの半分とし、FrequencyやFit Modeで感度を変えない。
	// 格子のAngleを変えても、正のXは画面右、正のYは画面上へ移動する。
	let physicalTranslation = controls.translation * uniforms.translationUnitScale;
	let gridTranslation = vec2f(
		cosine * physicalTranslation.x - sine * physicalTranslation.y,
		sine * physicalTranslation.x + cosine * physicalTranslation.y,
	);
	// 拡縮→個別回転→格子全体の回転→移動の逆順で参照位置を求める。
	// 移動は拡縮や個別回転に巻き込まず、描画先のセルと制御入力の評価点は固定する。
	// セルの物理的な縦横比を保ったまま回転し、最後にセル内の[-1,+1]へ正規化する。
	let localPosition = gridPosition - cellCenter - gridTranslation;
	let rotation = controls.rotation * 6.283185307179586;
	let localCosine = cos(rotation);
	let localSine = sin(rotation);
	let sourcePosition = vec2f(
		localCosine * localPosition.x - localSine * localPosition.y,
		localSine * localPosition.x + localCosine * localPosition.y,
	) / controls.scale * 2.0 / uniforms.cellSize;
	// 描画先は所属セルだけに限定する。さらに素材の配置枠外も透明にし、
	// 縮小時に接続のwrap設定で同じ素材が繰り返されることを防ぐ。
	if (any(abs(sourcePosition) > vec2f(1.0))) { return vec4f(0.0); }

	// まず制御値を平均し、その結果を0〜1へ制限して素材数で均等分割する。
	// 1は最後の素材を選ぶ。空配列のvariantでも定数式の符号なし減算が負にならないようにする。
	let selection = clamp(controls.selection, 0.0, 1.0);
	let inputIndex = min(u32(floor(selection * f32(count_inputs))), max(count_inputs, 1u) - 1u);
	// 素材は既にpremultiplied RGBAなので、OpacityはRGBとalphaの両方へ一度だけ掛ける。
	return read_inputs(inputIndex, sourcePosition) * opacity;
}
