import assert from 'node:assert/strict';
import { test } from 'node:test';
import jsQR from 'jsqr';
import { encodeQrCode, getQrCodeCenterImageLayout, QR_CODE_CELL_ROLES } from '../src/fx/qrCode/qr-code.ts';

function decode(qrCode) {
	const scale = 6;
	const quietZone = 4;
	const width = (qrCode.size + quietZone * 2) * scale;
	const pixels = new Uint8ClampedArray(width * width * 4).fill(255);
	for (let y = 0; y < qrCode.size; y++) {
		for (let x = 0; x < qrCode.size; x++) {
			if (qrCode.cells[(y * qrCode.size + x) * 2] === 0) continue;
			for (let dy = 0; dy < scale; dy++) {
				for (let dx = 0; dx < scale; dx++) {
					const offset = (((y + quietZone) * scale + dy) * width + (x + quietZone) * scale + dx) * 4;
					pixels.set([0, 0, 0, 255], offset);
				}
			}
		}
	}
	return jsQR(pixels, width, width)?.data;
}

// 【独立したデコーダーで文字列を復元し、空白・改行・日本語・絵文字の意味を保つ】
// 符号化ライブラリとの同値比較だけでは同じ誤りを見逃すため、別実装で読み取る。
// Textの描画と異なり、前後の空白を削ったりUnicodeを正規化してはならない。
test('round-trips exact text through an independent decoder at every correction level', () => {
	for (const content of ['1234567890', 'https://example.com/?q=Glitch+Studio#QR', '  Glitch Studio\r\nQRコード 👩‍💻 e\u0301  ', ' \n ']) {
		for (const correction of ['L', 'M', 'Q', 'H']) assert.equal(decode(encodeQrCode(content, correction, 0)), content);
	}
});

// 【型番固定を守り、容量不足で別の型番や切り詰めた内容へ置き換えない】
// 固定した格子の密度をアニメーション中も保つ契約を、最小・最大型番と容量境界で確認する。
test('honors fixed versions and rejects capacity overflow and invalid versions', () => {
	for (const version of [1, 7, 40]) {
		const qrCode = encodeQrCode('GS', 'M', version);
		assert.equal(qrCode.version, version);
		assert.equal(qrCode.size, version * 4 + 17);
		assert.equal(qrCode.cells.length, qrCode.size * qrCode.size * 2);
	}
	assert.throws(() => encodeQrCode('a'.repeat(100), 'H', 1));
	for (const version of [-1, 1.5, 41, NaN, Infinity]) assert.throws(() => encodeQrCode('GS', 'M', version), /version/);
	assert.equal(encodeQrCode('', 'M', 0), null);
	assert.deepEqual(encodeQrCode('GS', 'M', 0), encodeQrCode('GS', 'M', 0));
});

// 【三隅だけを領域として分類し、その他の機能パターンにもセル設定を適用できるようにする】
// 暗いマスだけを分類すると、枠全体の角丸で必要な内側の白い領域を正しく描けない。
// 位置合わせ・タイミング・形式情報・バージョン情報を別扱いすると装飾されないセルが残るため、
// これらも同じセルの役割としてGPUへ渡すことを確認する。
test('packs cell values and semantic roles without including the quiet zone', () => {
	const qrCode = encodeQrCode('GS', 'M', 7);
	const role = (x, y) => qrCode.cells[(y * qrCode.size + x) * 2 + 1];
	const dark = (x, y) => qrCode.cells[(y * qrCode.size + x) * 2];
	assert.equal(role(0, 0), QR_CODE_CELL_ROLES.finder);
	assert.equal(dark(0, 0), 1);
	assert.equal(role(1, 1), QR_CODE_CELL_ROLES.finder);
	assert.equal(dark(1, 1), 0);
	assert.equal(role(7, 0), QR_CODE_CELL_ROLES.cell);
	assert.equal(dark(7, 0), 0);
	assert.equal(role(6, 12), QR_CODE_CELL_ROLES.cell);
	assert.equal(role(8, 0), QR_CODE_CELL_ROLES.cell);
	assert.equal(role(qrCode.size - 11, 0), QR_CODE_CELL_ROLES.cell);
	assert.equal(role(22, 22), QR_CODE_CELL_ROLES.cell);
	assert.equal(role(qrCode.size - 1, qrCode.size - 1), QR_CODE_CELL_ROLES.cell);
});

// 【画像の矩形と余白に重なるセルを外側へ丸め、左右対称のくり抜きを作る】
// 画像のalphaには依存せず、端に少しでも重なるマスを途中で切らずに除去する。
// 画像サイズはquiet zoneを含まない本体基準で、縦横比の異なる矩形も扱う。
test('expands the center image rectangle and padding to complete cells', () => {
	assert.deepEqual(getQrCodeCenterImageLayout(21, true, [0.2, 0.1], 1), { imageHalfSize: [2.1, 1.05], cutoutBounds: [7, 8, 14, 13] });
	assert.deepEqual(getQrCodeCenterImageLayout(21, true, [0.2, 0.1], 0).cutoutBounds, [8, 9, 13, 12]);
	assert.deepEqual(getQrCodeCenterImageLayout(21, true, [1, 1], 100).cutoutBounds, [0, 0, 21, 21]);
	for (const imageSize of [[0, 0.2], [0.2, 0], [NaN, 1]]) assert.deepEqual(getQrCodeCenterImageLayout(21, true, imageSize, 1).cutoutBounds, [0, 0, 0, 0]);
	assert.deepEqual(getQrCodeCenterImageLayout(21, false, [0.2, 0.2], 1).cutoutBounds, [0, 0, 0, 0]);
});
