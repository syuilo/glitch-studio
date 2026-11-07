type EffectSearchQuery = {
	text: string;
	terms: string[];
};

type EffectNameSearchMatch = {
	isExactName: boolean;
	typoCount: number;
	substringMatchCount: number;
	prefixMatchCount: number;
};

function normalizeEffectSearchText(text: string): string {
	return text.normalize('NFKC').toLowerCase().trim().replace(/\s+/gu, ' ');
}

export function createEffectSearchQuery(text: string): EffectSearchQuery {
	const normalizedText = normalizeEffectSearchText(text);
	return {
		text: normalizedText,
		terms: normalizedText === '' ? [] : [...new Set(normalizedText.split(' '))],
	};
}

export function matchEffectName(displayName: string, query: EffectSearchQuery): EffectNameSearchMatch | null {
	const normalizedName = normalizeEffectSearchText(displayName);
	// ハイフンや括弧なども語の境界として扱い、名前の一部のtypoを名前全体の長さで判定しない。
	// 部分一致は元の名前に対して行うため、日本語や記号を含む検索も維持する。
	const nameWords: string[] = normalizedName.match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
	const match: EffectNameSearchMatch = {
		// 空白だけの入力では、空の名前も含めて検索による順位を付けない。
		isExactName: query.terms.length > 0 && normalizedName === query.text,
		typoCount: 0,
		substringMatchCount: 0,
		prefixMatchCount: 0,
	};
	for (const term of query.terms) {
		if (nameWords.includes(term)) continue;
		if (nameWords.some(word => word.startsWith(term))) {
			match.prefixMatchCount++;
			continue;
		}
		if (normalizedName.includes(term)) {
			match.substringMatchCount++;
			continue;
		}
		const termCharacters = Array.from(term);
		// 短い語で1文字を許すと無関係な候補が増えるため、4文字以上に限定する。
		if (termCharacters.length < 4 || !nameWords.some(word => isWithinOneTypo(termCharacters, Array.from(word)))) return null;
		match.typoCount++;
	}
	return match;
}

export function compareEffectNameSearchMatches(first: EffectNameSearchMatch, second: EffectNameSearchMatch): number {
	// 点数の重み付けではなく優先順位ごとに比較し、部分一致が積み重なって完全一致を追い越すのを防ぐ。
	// 全語が通常一致する候補をtypo候補より優先し、同じ編集回数なら残りの語の一致の強さで比較する。
	return Number(second.isExactName) - Number(first.isExactName)
		|| first.typoCount - second.typoCount
		|| first.substringMatchCount - second.substringMatchCount
		|| first.prefixMatchCount - second.prefixMatchCount;
}

function isWithinOneTypo(termCharacters: string[], wordCharacters: string[]): boolean {
	if (Math.abs(termCharacters.length - wordCharacters.length) > 1) return false;
	let termIndex = 0;
	let wordIndex = 0;
	let hasTypo = false;
	// 許容する編集は1回だけなので、最初の不一致で編集方法を決め、残りが一致するかを調べればよい。
	// Unicodeのコードポイント単位で比較し、サロゲートペアを2文字と数えない。
	while (termIndex < termCharacters.length && wordIndex < wordCharacters.length) {
		if (termCharacters[termIndex] === wordCharacters[wordIndex]) {
			termIndex++;
			wordIndex++;
			continue;
		}
		if (hasTypo) return false;
		hasTypo = true;
		if (termCharacters.length > wordCharacters.length) {
			termIndex++;
		} else if (termCharacters.length < wordCharacters.length) {
			wordIndex++;
		} else if (termCharacters[termIndex] === wordCharacters[wordIndex + 1]
			&& termCharacters[termIndex + 1] === wordCharacters[wordIndex]) {
			termIndex += 2;
			wordIndex += 2;
		} else {
			termIndex++;
			wordIndex++;
		}
	}
	// 未編集なら末尾の1文字の挿入・削除を許す。編集済みなら末尾まで一致している必要がある。
	return !hasTypo || termIndex === termCharacters.length && wordIndex === wordCharacters.length;
}
