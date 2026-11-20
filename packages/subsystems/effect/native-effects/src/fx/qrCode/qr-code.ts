// uqrの配布ESMにはライセンスコメントが残っていないため、Web書き出しの単独JSにも
// 通知が同梱されるよう、この依存を使う境界にlegal commentを保持する。
/*!
 * QR encoding: uqr (MIT License)
 * Copyright (c) Project Nayuki
 * Copyright (c) 2023 Anthony Fu <https://github.com/antfu>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import { encode } from 'uqr';

// shader.wgslへ渡すrg8uintのG。三隅の検出パターンだけを領域単位で描き、
// 位置合わせ・タイミング・形式情報なども含め、それ以外には同じセル設定を適用する。
export const QR_CODE_CELL_ROLES = { cell: 0, finder: 1 } as const;

export type EncodedQrCode = {
	size: number;
	version: number;
	cells: Uint8Array;
};

export function encodeQrCode(content: string, errorCorrection: 'L' | 'M' | 'Q' | 'H', version: number): EncodedQrCode | null {
	if (!Number.isInteger(version) || version < 0 || version > 40) throw new Error('QR Code version must be an integer from 0 (Auto) to 40.');
	if (content.length === 0) return null;
	// quiet zoneはGPUで描く。色・寸法・装飾を変えても、この符号化結果は再利用できる。
	const qrCode = encode(content, { ecc: errorCorrection, boostEcc: false, border: 0, minVersion: version === 0 ? 1 : version, maxVersion: version === 0 ? 40 : version });
	const { size } = qrCode;
	const cells = new Uint8Array(size * size * 2);
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const offset = (y * size + x) * 2;
			cells[offset] = Number(qrCode.data[y][x]);
			// uqrのPositionは周囲の白いseparatorも含む。枠全体のSDFで置き換えるのは7×7だけにし、
			// separatorを通常のマス装飾へ巻き込まない。枠内の白い部分にもfinderの役割を保持する。
			const isFinder = (x < 7 && y < 7) || (x >= size - 7 && y < 7) || (x < 7 && y >= size - 7);
			cells[offset + 1] = isFinder ? QR_CODE_CELL_ROLES.finder : QR_CODE_CELL_ROLES.cell;
		}
	}
	return { size, version: qrCode.version, cells };
}

/** 画像の矩形と余白に少しでも重なるセルを丸ごと除く。原点はQRコード本体の左上。 */
export function getQrCodeCenterImageLayout(size: number, enabled: boolean, imageSize: readonly [number, number], padding: number) {
	const imageHalfSize = imageSize.map(value => Number.isFinite(value) ? Math.min(1, Math.max(0, value)) * size / 2 : 0) as [number, number];
	if (!enabled || imageHalfSize.some(value => value <= 0)) return { imageHalfSize: [0, 0] as [number, number], cutoutBounds: [0, 0, 0, 0] as [number, number, number, number] };
	const margin = Number.isFinite(padding) ? Math.max(0, padding) : 0;
	const center = size / 2;
	return {
		imageHalfSize,
		cutoutBounds: [
			Math.max(0, Math.floor(center - imageHalfSize[0] - margin)),
			Math.max(0, Math.floor(center - imageHalfSize[1] - margin)),
			Math.min(size, Math.ceil(center + imageHalfSize[0] + margin)),
			Math.min(size, Math.ceil(center + imageHalfSize[1] + margin)),
		] as [number, number, number, number],
	};
}
