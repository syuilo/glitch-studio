struct Uniforms {
	aspect: vec2f,
	cellSize: vec2f,
	translationUnitScale: vec2f,
	phase: vec2f,
	angle: f32,
	controlSamples: u32,
	cellWrapMode: u32,
	maxSubdivisionLevels: u32,
	translationUsesCellUnits: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct CellControls {
	selection: f32,
	opacity: f32,
	translation: vec2f,
	scale: vec2f,
	rotation: f32,
};

fn wrapCellPosition(position: vec2f) -> vec2f {
	// セル内の[-1,+1]を[0,1]へ移して折り返す。fractを使うことで、
	// 負方向への移動でも正方向と同じ周期になり、描画先のセルや属性の参照先は変わらない。
	let uv = position * 0.5 + 0.5;
	switch uniforms.cellWrapMode {
		case 1u: { return clamp(position, vec2f(-1.0), vec2f(1.0)); }
		case 2u: { return fract(uv) * 2.0 - 1.0; }
		case 3u: {
			let mirroredUv = 1.0 - abs(fract(uv * 0.5) * 2.0 - 1.0);
			return mirroredUv * 2.0 - 1.0;
		}
		// Transparentの範囲外判定は呼び出し側で行い、範囲内の座標は加工せず保つ。
		default: { return position; }
	}
}

fn sampleCellControls(cellCenter: vec2f, cellSize: vec2f, cosine: f32, sine: f32) -> CellControls {
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
			let gridSample = cellCenter + vec2f(localX, localY) * cellSize;
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
	// 分割方法に依存する処理をここで完了させ、属性・変形・Wrapは確定した葉の寸法で行う。
	let cellLayout = findCellLayout(
		gridPosition, uniforms.cellSize, uniforms.phase, uniforms.aspect,
		cosine, sine, uniforms.maxSubdivisionLevels,
	);
	let cellCenter = cellLayout.center;
	let cellSize = cellLayout.size;
	let controls = sampleCellControls(cellCenter, cellSize, cosine, sine);
	let opacity = clamp(controls.opacity, 0.0, 1.0);
	if (opacity == 0.0 || any(abs(controls.scale) < vec2f(0.000001))) { return vec4f(0.0); }

	// 入力単位を、格子の計算と同じ短辺基準の物理座標へ変換する。
	// Cellでは1を変形前のセル幅／高さ1つ分とし、セルに対する移動量の比率を保つ。
	// Canvasでは1を描画領域の長辺全体とし、FrequencyやSize Referenceで移動の単位を変えない。
	// 格子のAngleを変えても、正のXは画面右、正のYは画面上へ移動する。
	// Cell単位は細分化後の葉の幅／高さに合わせる。Canvas単位は分割深度に依存させない。
	let translationUnitScale = select(uniforms.translationUnitScale, cellSize, uniforms.translationUsesCellUnits != 0u);
	let physicalTranslation = controls.translation * translationUnitScale;
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
	) / controls.scale * 2.0 / cellSize;
	// 描画先は所属セル内に限定したまま、変形で生じる余白を指定の方法で埋める。
	// 入力接続のwrapより先に処理し、セル単位の反復と素材画像自体のfit/wrapを分ける。
	if (uniforms.cellWrapMode == 0u && any(abs(sourcePosition) > vec2f(1.0))) { return vec4f(0.0); }
	let wrappedSourcePosition = wrapCellPosition(sourcePosition);

	// まず制御値を平均し、その結果を0〜1へ制限して素材数で均等分割する。
	// 1は最後の素材を選ぶ。空配列のvariantでも定数式の符号なし減算が負にならないようにする。
	let selection = clamp(controls.selection, 0.0, 1.0);
	let inputIndex = min(u32(floor(selection * f32(count_inputs))), max(count_inputs, 1u) - 1u);
	// 素材は既にpremultiplied RGBAなので、OpacityはRGBとalphaの両方へ一度だけ掛ける。
	return read_inputs(inputIndex, wrappedSourcePosition) * opacity;
}
