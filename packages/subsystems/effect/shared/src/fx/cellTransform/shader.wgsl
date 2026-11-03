struct Uniforms {
	aspect: vec2f,
	cellSize: vec2f,
	translationUnitScale: vec2f,
	phase: vec2f,
	angle: f32,
	controlSamples: u32,
	cellWrapMode: u32,
	wrapReference: u32,
	imageInputIsConstant: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct CellControls {
	opacity: f32,
	translation: vec2f,
	scale: vec2f,
	rotation: f32,
};

fn wrapCellPosition(position: vec2f) -> vec2f {
	// 元画像全体ではなく、各セルに含まれる画像片の[-1,+1]を基準に処理する。
	// fractで負の座標も同じ周期に揃え、移動方向による反復・鏡像の違いをなくす。
	let uv = position * 0.5 + 0.5;
	switch uniforms.cellWrapMode {
		case 1u: { return clamp(position, vec2f(-1.0), vec2f(1.0)); }
		case 2u: { return fract(uv) * 2.0 - 1.0; }
		case 3u: {
			let mirroredUv = 1.0 - abs(fract(uv * 0.5) * 2.0 - 1.0);
			return mirroredUv * 2.0 - 1.0;
		}
		default: { return position; }
	}
}

fn sampleCellControls(cellCenter: vec2f, cosine: f32, sine: f32) -> CellControls {
	// セルを指定数の等面積領域へ分割して各中心を読む。行の高さを列数に比例させ、
	// 平方数以外も指定数で偏りなく平均する。1サンプルではセル中心だけを読む。
	let rowCount = u32(sqrt(f32(uniforms.controlSamples)));
	let baseColumns = uniforms.controlSamples / rowCount;
	let extraRows = uniforms.controlSamples % rowCount;
	var completedSamples = 0u;
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
			// 分割格子から出力座標へ戻して評価する。移動・拡縮・個別回転ではサンプル領域を
			// 動かさず、同じセルに属する全画素で共通の属性値を使う。
			let samplePosition = vec2f(
				cosine * gridSample.x + sine * gridSample.y,
				-sine * gridSample.x + cosine * gridSample.y,
			) * 2.0 / uniforms.aspect;
			opacity += read_perCellOpacity(samplePosition);
			translation += read_perCellTranslation(samplePosition);
			scale += read_perCellScale(samplePosition);
			// 角度も折り返す前の値を算術平均し、複数周の情報を保つ。
			rotation += read_perCellRotation(samplePosition);
		}
		completedSamples += columns;
	}
	let sampleCount = f32(uniforms.controlSamples);
	return CellControls(opacity / sampleCount, translation / sampleCount, scale / sampleCount, rotation / sampleCount);
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
	if (all(controls.translation == vec2f(0.0)) && all(controls.scale == vec2f(1.0)) && controls.rotation == 0.0) {
		return read_input(position) * opacity;
	}

	// 入力単位を、格子の計算と同じ短辺基準の物理座標へ変換する。
	// Cellでは1を変形前のセル幅／高さ1つ分とし、セルに対する移動量の比率を保つ。
	// Canvasでは1を描画領域の長辺全体とし、FrequencyやSize Referenceで移動の単位を変えない。
	// 格子のAngleを変えても、正のXは画面右、正のYは画面上へ移動する。
	let physicalTranslation = controls.translation * uniforms.translationUnitScale;
	let gridTranslation = vec2f(
		cosine * physicalTranslation.x - sine * physicalTranslation.y,
		sine * physicalTranslation.x + cosine * physicalTranslation.y,
	);
	// セル中心を原点に、拡縮→時計回りの個別回転→移動の逆変換を適用する。
	// 移動後も描画先は元のセル内とし、制御入力の評価点は動かさない。
	// 回転中も物理的な距離の単位を揃え、長方形のセルや出力でも歪ませない。
	let localPosition = gridPosition - cellCenter - gridTranslation;
	let rotation = controls.rotation * 6.283185307179586;
	let localCosine = cos(rotation);
	let localSine = sin(rotation);
	let sourceLocalPosition = vec2f(
		localCosine * localPosition.x - localSine * localPosition.y,
		localSine * localPosition.x + localCosine * localPosition.y,
	) / controls.scale;
	// Cellでは画像片の範囲で折り返す。Imageではセル外の元画像も参照できるよう、
	// 局所座標では切り取りも折り返しもせず、画像全体の座標へ戻してから処理する。
	var wrappedSourceLocalPosition = sourceLocalPosition;
	if (uniforms.wrapReference == 0u) {
		if (uniforms.cellWrapMode == 0u) {
			// Transparentでは座標の正規化・復元を省き、従来の参照位置をそのまま保つ。
			if (any(abs(sourceLocalPosition) > uniforms.cellSize * 0.5)) { return vec4f(0.0); }
		} else {
			wrappedSourceLocalPosition = wrapCellPosition(sourceLocalPosition * 2.0 / uniforms.cellSize) * uniforms.cellSize * 0.5;
		}
	}

	// 各セルへ画像全体を複製せず、元のセル中心を足して画面全体の参照座標に戻す。
	let sourceGridPosition = cellCenter + wrappedSourceLocalPosition;
	let sourcePosition = vec2f(
		cosine * sourceGridPosition.x + sine * sourceGridPosition.y,
		-sine * sourceGridPosition.x + cosine * sourceGridPosition.y,
	) * 2.0 / uniforms.aspect;
	if (uniforms.wrapReference == 0u) {
		// Cellでは画面端で途切れたセルの表示領域外を画像片に含めない。
		if (any(abs(sourcePosition) > vec2f(1.0))) { return vec4f(0.0); }
	} else if (uniforms.imageInputIsConstant != 0u && uniforms.cellWrapMode == 0u) {
		// 定数色にはテクスチャの端がないため、Image・Transparentだけは画面全体を
		// 有限の画像領域として扱う。ほかのモードは一様な色で埋まる。
		if (any(abs(sourcePosition) > vec2f(1.0))) { return vec4f(0.0); }
	}
	// Imageのテクスチャ入力は、Fit後の画像端に対して共通のWrap・Filter処理を適用する。
	// 入力は既にpremultiplied RGBAなので、OpacityはRGBA全体へ一度だけ掛ける。
	return read_input(sourcePosition) * opacity;
}
