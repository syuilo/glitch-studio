struct EigenDecomposition {
	vectors: mat3x3f,
	values: vec3f,
};

fn diagonalMatrix(values: vec3f) -> mat3x3f {
	return mat3x3f(vec3f(values.x, 0.0, 0.0), vec3f(0.0, values.y, 0.0), vec3f(0.0, 0.0, values.z));
}

fn symmetricMatrix(matrix: mat3x3f) -> mat3x3f {
	return (matrix + transpose(matrix)) * 0.5;
}

fn symmetricEigenDecomposition(matrix: mat3x3f) -> EigenDecomposition {
	var diagonalized = symmetricMatrix(matrix);
	var vectors = diagonalMatrix(vec3f(1.0));
	// 3×3対称行列の巡回Jacobi法。固定10巡で同じ入力に同じ計算量を与える。
	// 大きなtauでは角度を直接求めず安定なtan(theta)を使い、桁落ちを抑える。
	for (var sweep = 0u; sweep < 10u; sweep++) {
		for (var pair = 0u; pair < 3u; pair++) {
			let first = select(0u, 1u, pair == 2u);
			let second = select(2u, 1u, pair == 0u);
			let offDiagonal = diagonalized[second][first];
			let scale = max(max(abs(diagonalized[first][first]), abs(diagonalized[second][second])), 1e-8);
			if (abs(offDiagonal) <= scale * 1e-12) { continue; }
			let tau = (diagonalized[second][second] - diagonalized[first][first]) / (2.0 * offDiagonal);
			let tangent = select(-1.0, 1.0, tau >= 0.0) / (abs(tau) + sqrt(1.0 + tau * tau));
			let cosine = inverseSqrt(1.0 + tangent * tangent);
			let sine = tangent * cosine;
			var rotation = diagonalMatrix(vec3f(1.0));
			rotation[first][first] = cosine;
			rotation[second][second] = cosine;
			rotation[second][first] = sine;
			rotation[first][second] = -sine;
			diagonalized = symmetricMatrix(transpose(rotation) * diagonalized * rotation);
			vectors = vectors * rotation;
		}
	}
	return EigenDecomposition(vectors, vec3f(diagonalized[0][0], diagonalized[1][1], diagonalized[2][2]));
}

fn symmetricSquareRoot(matrix: mat3x3f) -> mat3x3f {
	let decomposition = symmetricEigenDecomposition(matrix);
	return decomposition.vectors * diagonalMatrix(sqrt(max(decomposition.values, vec3f(0.0)))) * transpose(decomposition.vectors);
}

fn covarianceTransform(inputCovariance: mat3x3f, referenceCovariance: mat3x3f) -> mat3x3f {
	let inputVariance = inputCovariance[0][0] + inputCovariance[1][1] + inputCovariance[2][2];
	let referenceVariance = referenceCovariance[0][0] + referenceCovariance[1][1] + referenceCovariance[2][2];
	let identity = diagonalMatrix(vec3f(1.0));
	// 単色の主入力に存在しない変動を作らない。解析点が1点だけの場合も、平均の
	// 移動に留め、解析できなかった画素の細部を消したり増幅したりしない。
	if (inputVariance <= 1e-8) { return identity; }
	if (referenceVariance <= 1e-8) { return diagonalMatrix(vec3f(0.0)); }
	// 共分散を同じ尺度で正規化しても転送行列は変わらない。HDRで共分散同士の
	// 積だけがoverflowしないよう、平方根を取る前に両側を同じ大きさへ揃える。
	let scale = max(inputVariance, referenceVariance);
	let regularization = max(1e-8 / scale, 1e-6);
	let input = symmetricEigenDecomposition(inputCovariance * (1.0 / scale) + identity * regularization);
	let roots = sqrt(max(input.values, vec3f(regularization)));
	let squareRoot = input.vectors * diagonalMatrix(roots) * transpose(input.vectors);
	let inverseRoot = input.vectors * diagonalMatrix(vec3f(1.0) / roots) * transpose(input.vectors);
	// Gaussianの対称な色転送行列 A=Cs^(-1/2)(Cs^(1/2)CrCs^(1/2))^(1/2)Cs^(-1/2)。
	// RGB各成分の分散だけを合わせる方式と異なり、色成分間の相関も変換する。
	// 特異な共分散でも逆平方根を有限に保つため、両側へ同じ正則化を加える。
	// https://djalil.chafai.net/blog/2010/04/30/wasserstein-distance-between-two-gaussians/
	let middle = symmetricSquareRoot(squareRoot * (referenceCovariance * (1.0 / scale) + identity * regularization) * squareRoot);
	let transform = symmetricEigenDecomposition(symmetricMatrix(inverseRoot * middle * inverseRoot));
	// 対称な半正定値行列なので、固有値は各主軸の増幅率に一致する。
	// 成分ごとのclampでは斜め方向の増幅を制限できないため、固有値へ上限を適用する。
	let gains = clamp(transform.values, vec3f(0.0), vec3f(uniforms.maximumGain));
	return transform.vectors * diagonalMatrix(gains) * transpose(transform.vectors);
}
