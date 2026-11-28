import test from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

const entry = new URL('./history-and-preparation-browser.mjs', import.meta.url);
const options = { skip: process.env.CHROME_PATH == null };

// 【Position Trailは単独出力でも同じ軌跡を保持し、シークで消去できる】
// 省略したポートに履歴を確保せず、左右へ動かした場合の強度とリセット後の初回描画を確認する。
test('retains and resets scalar trail history on its own', options, () => runEffectGpuTest(entry, 'positionTrail'));

for (const id of ['pointerTrail', 'positionTrail']) {
	// 【高速な直線移動でもフレームレートによらず連続した軌跡を生成する】
	// 1フレームでブラシの直径以上を進む場合も、同一時刻の両出力が複数のFPSで一致することを確認する。
	// 半減期がフレーム間隔より短い場合は、フレーム内の通過時刻に応じた減衰も必要になる。
	test(`${id} integrates fast motion independently of frame rate`, options, async () => {
		for (const enable32bitDataTextures of [false, true]) {
			await runEffectGpuTest(entry, 'trailFrameRate', 45000, [id, enable32bitDataTextures]);
		}
	});
}

// 【Pointer Trailは未入力区間をまたいでストロークを繋がない】
// ポインターが再び有効になっても、途切れる前の履歴には経過時間分の減衰だけを適用する。
test('decays pointer trail history without bridging missing input', options, () => runEffectGpuTest(entry, 'pointerTrailMissingInput'));

// 【同じフレームに届いた曲がり角・ストロークの切れ目・線分ごとの時刻を使う】
// フレーム両端の位置からは復元できない形状を読み戻し、半減期ぶん古い線分の強さが半分になることも確認する。
test('accumulates separate timed pointer segments in one render pass', options, () => runEffectGpuTest(entry, 'pointerTrailSegments'));

// 【QR Codeで符号化に失敗しても直前の有効な内容に戻せる】
// セルの寸法だけが壊れると、同じ内容のキャッシュを再利用した次の描画が空になる。
test('restores previously encoded QR cells after an encoding failure', options, () => runEffectGpuTest(entry, 'recoverQrCode'));

// 【古い音声窓の遅延到着が現在のPCMを上書きしない】
// ファイルの読み出し中にライブ入力へ切り替え、同じ窓を同期で再利用できることを確認する。
test('keeps current live PCM when a previous audio read completes', options, () => runEffectGpuTest(entry, 'supersededAudio'));

// 【Video Frameのシークを追い越した要求や範囲外の画像が残らない】
// 先頭のデコード中に末尾へ切り替えた後、透明区間と先頭の実フレームを続けて読み取る。
test('renders the latest video seek and clears out-of-range frames', options, () => runEffectGpuTest(entry, 'seekVideo'));
