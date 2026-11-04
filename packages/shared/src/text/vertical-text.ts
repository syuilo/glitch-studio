import { uprightCodePointRanges } from './vertical-orientation.ts';

export type TextLineMetrics = Pick<TextMetrics, 'width' | 'actualBoundingBoxLeft' | 'actualBoundingBoxRight' | 'actualBoundingBoxAscent' | 'actualBoundingBoxDescent' | 'fontBoundingBoxAscent' | 'fontBoundingBoxDescent'>;

export type VerticalTextLine = {
	fontSize: number;
	metrics: TextLineMetrics;
	runs: { text: string; x: number; y: number; upright: boolean }[];
};

const graphemeSegmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' });

function isUpright(text: string): boolean {
	const codePoint = text.codePointAt(0)!;
	let lower = 0;
	let upper = uprightCodePointRanges.length - 1;
	while (lower <= upper) {
		const middle = (lower + upper) >>> 1;
		const [start, end] = uprightCodePointRanges[middle];
		if (codePoint < start) upper = middle - 1;
		else if (codePoint > end) lower = middle + 1;
		else return true;
	}
	return false;
}

/**
 * 縦書きの一列を、X=文字送り・Y=列送りの論理座標で配置する。
 * 呼び出し側で全体を時計回りに90度回すと、文字は上から下、列は右から左へ進む。
 * 日本語の字形だけ逆回転して正立させ、英数字の連続部分はCanvasへまとめて渡して
 * カーニング・合字・結合文字を維持する。フォントのvert/vrt2置換自体は行わない。
 */
export function layoutVerticalTextLine(text: string, fontSize: number, alignment: 'left' | 'center' | 'right', measure: (text: string) => TextLineMetrics): VerticalTextLine {
	const alignmentFraction = alignment === 'left' ? 0 : alignment === 'right' ? 1 : 0.5;
	const segments: { text: string; upright: boolean }[] = [];
	for (const { segment } of graphemeSegmenter.segment(text)) {
		const upright = isUpright(segment);
		const previous = segments.at(-1);
		if (!upright && previous != null && !previous.upright) previous.text += segment;
		else segments.push({ text: segment, upright });
	}
	let advance = 0;
	let left = Infinity;
	let right = -Infinity;
	let top = Infinity;
	let bottom = -Infinity;
	const runs: VerticalTextLine['runs'] = [];
	for (const segment of segments) {
		const metrics = measure(segment.text);
		// Canvasの計測値はtextAlignを含む。個々の描画はleftで行うので、いったん戻す。
		const glyphLeft = metrics.width * alignmentFraction - metrics.actualBoundingBoxLeft;
		const glyphRight = metrics.width * alignmentFraction + metrics.actualBoundingBoxRight;
		const baselineCenter = (metrics.fontBoundingBoxAscent - metrics.fontBoundingBoxDescent) / 2;
		let x = segment.upright ? advance + fontSize / 2 + baselineCenter : advance;
		let y = segment.upright ? metrics.width / 2 : baselineCenter;
		// 横組み用の句読点をそのまま中央に置くと左下へ残るため、字面を右上へ寄せる。
		// 字形を別のUnicode文字に置換しないことで、読み込んだフォントの字形を維持する。
		if (/^[、。，．]$/u.test(segment.text)) {
			x = advance + fontSize * 0.1 + metrics.actualBoundingBoxAscent;
			y = -fontSize * 0.4 + glyphRight;
		}
		runs.push({ ...segment, x, y });
		if (glyphRight > glyphLeft) {
			left = Math.min(left, x + (segment.upright ? -metrics.actualBoundingBoxAscent : glyphLeft));
			right = Math.max(right, x + (segment.upright ? metrics.actualBoundingBoxDescent : glyphRight));
			top = Math.min(top, y + (segment.upright ? -glyphRight : -metrics.actualBoundingBoxAscent));
			bottom = Math.max(bottom, y + (segment.upright ? -glyphLeft : metrics.actualBoundingBoxDescent));
		}
		advance += segment.upright ? fontSize : metrics.width;
	}
	const offset = advance * alignmentFraction;
	for (const run of runs) run.x -= offset;
	const hasInk = Number.isFinite(left);
	return {
		fontSize,
		runs,
		metrics: {
			width: advance,
			actualBoundingBoxLeft: hasInk ? offset - left : 0,
			actualBoundingBoxRight: hasInk ? right - offset : 0,
			actualBoundingBoxAscent: hasInk ? -top : 0,
			actualBoundingBoxDescent: hasInk ? bottom : 0,
			fontBoundingBoxAscent: fontSize / 2,
			fontBoundingBoxDescent: fontSize / 2,
		},
	};
}

/** 外側の90度回転と圧縮を適用済みのCanvasへ、一列の本体または輪郭を描く。 */
export function drawVerticalTextLine(context: OffscreenCanvasRenderingContext2D, line: VerticalTextLine, fontSize: number, baseline: number, stroke: boolean) {
	const scale = fontSize / line.fontSize;
	context.save();
	try {
		context.textAlign = 'left';
		for (const run of line.runs) {
			context.save();
			context.translate(run.x * scale, baseline + run.y * scale);
			if (run.upright) context.rotate(-Math.PI / 2);
			if (stroke) context.strokeText(run.text, 0, 0);
			else context.fillText(run.text, 0, 0);
			context.restore();
		}
	} finally {
		context.restore();
	}
}
