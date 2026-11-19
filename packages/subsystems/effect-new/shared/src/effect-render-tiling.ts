/** 自動分割の学習結果はGPUと実行インスタンスに属し、この設定には保存しない。 */
export type EffectRenderTiling =
	| { mode: 'auto' }
	| { mode: 'disabled' }
	| { mode: 'manual'; tileSize: number };

/** 一つのエフェクト内の全Render Passを対象とする。自動分割では総数も途中で更新する。 */
export type EffectRenderTilingProgress = {
	/** GPU完了を確認済みのタイル数。送信しただけのタイルは含めない。 */
	completedTiles: number;
	totalTiles: number;
};

/** nullは、そのエフェクトのタイル描画が完了・中断・失敗したことを表す。 */
export type EffectRenderTilingProgressObserver = (progress: EffectRenderTilingProgress | null) => void;

/**
 * 同じRender Passの計算量を相対比較するためのヒント。実行時間や分割数は指定しない。
 * 画素あたりの仕事が増えたとき、前回のタイル面積をその比率だけ減らしてから実行する。
 */
export type EffectRenderWorkloadHint = {
	/** 有限の正数。同じkeyの中でのみ比較し、反復数・サンプル数などを共通の単位で表す。 */
	workPerPixel: number;
	/**
	 * workPerPixelだけでは比較できない条件（処理方式・入力内容・描画領域など）の識別子。
	 * 条件が変われば学習を破棄する。内容が変わる入力などを識別できない場合は、
	 * ヒント自体をnullにして、描画ごとに小さなタイルから確認する。
	 */
	key: string;
};
