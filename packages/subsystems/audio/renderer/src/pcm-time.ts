/**
 * Scene時刻から秒への変換や逆方向の加減算で、同じPCM境界が数ULPずれることがある。
 * 読み出しを分割した場所によって境界のサンプルが無音にならないよう、演算誤差だけを吸収する。
 * 素材の本来の小数時刻をサンプルグリッドへ丸める処理ではない。
 */
export function isPcmTimeBefore(time: number, boundary: number): boolean {
	if (!Number.isFinite(boundary)) return time < boundary;
	return time - boundary < -8 * Number.EPSILON * Math.max(1, Math.abs(time), Math.abs(boundary));
}
