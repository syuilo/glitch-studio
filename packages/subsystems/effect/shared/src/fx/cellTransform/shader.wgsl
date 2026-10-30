struct Uniforms {
	aspect: vec2f,
	cellSize: vec2f,
	phase: vec2f,
	angle: f32,
	controlSamples: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct CellControls {
	opacity: f32,
	scale: vec2f,
	rotation: f32,
};

fn sampleCellControls(cellCenter: vec2f, cosine: f32, sine: f32) -> CellControls {
	// セルを指定数の等面積領域へ分割して各中心を読む。行の高さを列数に比例させ、
	// 平方数以外も指定数で偏りなく平均する。1サンプルではセル中心だけを読む。
	let rowCount = u32(sqrt(f32(uniforms.controlSamples)));
	let baseColumns = uniforms.controlSamples / rowCount;
	let extraRows = uniforms.controlSamples % rowCount;
	var completedSamples = 0u;
	var opacity = 0.0;
	var scale = vec2f(0.0);
	var rotation = 0.0;
	for (var row = 0u; row < rowCount; row++) {
		let columns = baseColumns + select(0u, 1u, row < extraRows);
		let localY = (f32(completedSamples) + 0.5 * f32(columns)) / f32(uniforms.controlSamples) - 0.5;
		for (var column = 0u; column < columns; column++) {
			let localX = (f32(column) + 0.5) / f32(columns) - 0.5;
			let gridSample = cellCenter + vec2f(localX, localY) * uniforms.cellSize;
			// 分割格子から出力座標へ戻して評価する。拡縮・個別回転ではサンプル領域を
			// 動かさず、同じセルに属する全画素で共通の属性値を使う。
			let samplePosition = vec2f(
				cosine * gridSample.x + sine * gridSample.y,
				-sine * gridSample.x + cosine * gridSample.y,
			) * 2.0 / uniforms.aspect;
			opacity += read_perCellOpacity(samplePosition);
			scale += read_perCellScale(samplePosition);
			// 角度も折り返す前の値を算術平均し、複数周の情報を保つ。
			rotation += read_perCellRotation(samplePosition);
		}
		completedSamples += columns;
	}
	let sampleCount = f32(uniforms.controlSamples);
	return CellControls(opacity / sampleCount, scale / sampleCount, rotation / sampleCount);
}

@fragment
fn fs(@location(0) position: vec2f) -> @location(0) vec4f {
	let cosine = cos(uniforms.angle);
	let sine = sin(uniforms.angle);
	// 短辺基準で物理的な縦横の距離を揃える。正のAngleで分割格子を時計回りへ
	// 回すため、所属セルの判定では逆向きに回転する。画像全体は回転させない。
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

	// 変形がなければ分割方法によらず元画像をそのまま保つ。格子座標を往復する
	// 丸め誤差によってサンプル位置がずれたり、セル境界に隙間が出たりするのを避ける。
	if (all(controls.scale == vec2f(1.0)) && controls.rotation == 0.0) {
		return read_input(position) * opacity;
	}

	// セル中心を原点に、拡縮→時計回りの個別回転の逆変換を適用する。
	// 回転中も物理的な距離の単位を揃え、長方形のセルや出力でも歪ませない。
	let localPosition = gridPosition - cellCenter;
	let rotation = controls.rotation * 6.283185307179586;
	let localCosine = cos(rotation);
	let localSine = sin(rotation);
	let sourceLocalPosition = vec2f(
		localCosine * localPosition.x - localSine * localPosition.y,
		localSine * localPosition.x + localCosine * localPosition.y,
	) / controls.scale;
	// 描画先は所属セル内に限り、参照元も元のセル内だけに限る。
	// 参照元の切り取りがないと、縮小・回転で空いた場所に隣のセルの画像が入り込む。
	if (any(abs(sourceLocalPosition) > uniforms.cellSize * 0.5)) { return vec4f(0.0); }

	// 各セルへ画像全体を複製せず、元のセル中心を足して画面全体の参照座標に戻す。
	let sourceGridPosition = cellCenter + sourceLocalPosition;
	let sourcePosition = vec2f(
		cosine * sourceGridPosition.x + sine * sourceGridPosition.y,
		-sine * sourceGridPosition.x + cosine * sourceGridPosition.y,
	) * 2.0 / uniforms.aspect;
	// 画面端の部分的なセルでも、元画像の表示領域外は破片に含めない。
	// 接続のwrapで反対側の画像が現れることを防ぎ、空いた部分は透明にする。
	if (any(abs(sourcePosition) > vec2f(1.0))) { return vec4f(0.0); }
	// 入力は既にpremultiplied RGBAなので、OpacityはRGBA全体へ一度だけ掛ける。
	return read_input(sourcePosition) * opacity;
}
