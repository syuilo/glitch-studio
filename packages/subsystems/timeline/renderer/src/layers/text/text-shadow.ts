import type { TextLayout } from './text-layout.ts';

type TextShadowSettings = {
	blur: number;
	offset: readonly [number, number];
};

export function getTextShadowMetrics(settings: TextShadowSettings, fontSize: number) {
	// px固定にせず、描画倍率とフォント縮小を適用済みのサイズを使う。
	// +Yはアプリでは上、Canvasでは下なので、境界で符号を反転する。
	const blur = Math.max(0, settings.blur) * fontSize;
	const offsetX = settings.offset[0] * fontSize;
	const offsetY = -settings.offset[1] * fontSize;
	// Canvasのガウスぼかし用に3σと補間用の余白を確保する。
	// 描画領域外の文字から入ってくる影も作れるよう、最終画面より広く字形を描く。
	const padding = blur > 0 ? Math.ceil(blur * 3) + 2 : 0;
	if (!(fontSize > 0) || ![fontSize, blur, offsetX, offsetY, padding].every(Number.isFinite)) return null;
	return { blur, offsetX, offsetY, padding };
}

export function createTextShadowMaskRenderer() {
	const source = new OffscreenCanvas(1, 1);
	const context = source.getContext('2d');
	if (context == null) throw new Error('Could not create a text shadow canvas.');

	return {
		render(target: OffscreenCanvasRenderingContext2D, options: {
			layout: TextLayout;
			fontFamily: string;
			alignment: 'left' | 'center' | 'right';
			x: number;
			y: number;
			settings: TextShadowSettings;
		}) {
			const { width, height } = target.canvas;
			target.clearRect(0, 0, width, height);
			const shadow = getTextShadowMetrics(options.settings, options.layout.fontSize);
			if (shadow == null) return;
			const sourceWidth = width + shadow.padding * 2;
			const sourceHeight = height + shadow.padding * 2;
			// このCanvasは中間の描画元で、WebGPUへ転送するのは画面内の結果だけ。
			// GPUの最大テクスチャ寸法で制限すると、上限付近の出力で僅かなぼかしも使えなくなる。
			if (!Number.isSafeInteger(sourceWidth) || !Number.isSafeInteger(sourceHeight)) {
				throw new Error('Text shadow blur is too large for the current rendering resolution.');
			}
			if (source.width !== sourceWidth || source.height !== sourceHeight) {
				source.width = sourceWidth;
				source.height = sourceHeight;
			}
			context.clearRect(0, 0, sourceWidth, sourceHeight);
			context.save();
			try {
				const { layout } = options;
				context.font = `${layout.fontSize}px ${options.fontFamily}`;
				context.textAlign = options.alignment;
				context.textBaseline = 'alphabetic';
				context.direction = 'ltr';
				context.fillStyle = '#ffffff';
				context.strokeStyle = '#ffffff';
				context.lineJoin = 'round';
				if (layout.outlineWidth > 0) context.lineWidth = layout.outlineWidth * 2;
				// 移動後の字形を、影が表示される画面とその周囲へ直接描く。
				// 本体の画面内マスクをコピーすると、画面外へ出た文字の影が欠けてしまう。
				context.translate(options.x + shadow.offsetX + shadow.padding, options.y + shadow.offsetY + shadow.padding);
				context.scale(layout.horizontalScale, 1);
				for (let index = 0; index < layout.lines.length; index++) {
					const baseline = layout.firstBaselineOffset + index * layout.lineAdvance;
					context.fillText(layout.lines[index], 0, baseline);
					if (layout.outlineWidth > 0) context.strokeText(layout.lines[index], 0, baseline);
				}
			} finally {
				context.restore();
			}

			target.save();
			try {
				// 本体と全行の輪郭を合成してから一度だけぼかす。行ごとの影の重なりによる濃度変化を避ける。
				// blur()はCanvasの組み込み処理。横圧縮後の字形に対し、ぼかし幅・移動量は縦横同じ単位で適用する。
				// shadowBlurで本体も同時に描く方法と違い、半透明な文字の背後に必要な影も単独で保持できる。
				target.filter = shadow.blur > 0 ? `blur(${shadow.blur}px)` : 'none';
				target.drawImage(source, -shadow.padding, -shadow.padding);
			} finally {
				target.restore();
			}
		},
		dispose() {
			source.width = 1;
			source.height = 1;
		},
	};
}
