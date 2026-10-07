/** 描画側の入力契約。レイヤー種別・Binding・発話キーを持たず、評価済みの文字と装飾だけを受け取る。 */
export type TextRenderValues = {
	text: string;
	font: string | null;
	size: number;
	overflow: 'none' | 'shrink' | 'compress';
	maxWidth: number;
	color: [number, number, number, number];
	outlineWidth: number;
	outlineColor: [number, number, number, number];
	shadowEnabled: boolean;
	shadowColor: [number, number, number, number];
	shadowOffset: [number, number];
	shadowBlur: number;
	position: [number, number];
	align: 'left' | 'center' | 'right';
	lineHeight: number;
};
