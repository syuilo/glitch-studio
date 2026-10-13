import tinycolor from 'tinycolor2';

export function getBgColor(elem?: Element | null): string | null {
	if (elem == null) return null;

	const { backgroundColor: bg } = window.getComputedStyle(elem);

	if (bg && tinycolor(bg).getAlpha() !== 0) {
		return bg;
	}

	return getBgColor(elem.parentElement);
}
