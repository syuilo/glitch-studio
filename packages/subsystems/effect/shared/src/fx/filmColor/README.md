# Film Color

フィルム写真をイメージした色・階調の調整。特定のフィルム銘柄の実測再現ではなく、通常の写真・動画を基準にした創作用のモデル。プリセット・フィルムプロファイル・外部LUTを持たず、全パラメータを中立にすると入力をそのまま通す。

## パラメータ

Input／Outputはcolor。全ての数値パラメータは式・キー・ノード入力に対応する。

| パラメータ | 既定値 | 作用 |
| --- | --- | --- |
| Amount | 1 | 処理済み画像とのlinear RGB上の混合量 |
| Contrast | 1.1 | 18%グレーにおける明度曲線の傾き |
| Shadow Softness | 0.25 | 黒付近の傾きを緩やかにする |
| Highlight Softness | 0.35 | 白付近の傾きと白の明度を下げる |
| Fade | 0 | 黒の明度を持ち上げる。Shadow Softnessとは独立 |
| Chroma Compression | 0.2 | 高彩度部をなめらかに圧縮する |
| Shadow Hue | 0.55 turn | 暗部の色付けの方向。既定は青緑 |
| Shadow Tint Amount | 0.1 | 暗部の色付けの強さ |
| Highlight Hue | 0.22 turn | 明部の色付けの方向。既定は琥珀色 |
| Highlight Tint Amount | 0.1 | 明部の色付けの強さ |

ContrastのUI範囲は0.5〜2、評価範囲は0.1〜4。色相は1を1周として繰り返す。それ以外の数値は0〜1へ制限する。この制限は操作量だけに適用し、画像のRGB・OklabのLを0〜1へ制限しない。

## 処理と色の規約

未乗算のlinear sRGBをOklabへ変換し、Lの階調、a/b平面のクロマ圧縮、明暗別の色付けの順に処理する。linear sRGBへ戻して元のalphaを乗算し、Amountで入力と混合する。入出力はpremultiplied alphaのlinear sRGB・rgba16float。alphaは変更しない。alpha=0の発光は変更せず通す。

Amount=0、またはContrast=1・両Softness=0・Fade=0・Chroma Compression=0・両Tint Amount=0の場合は変換を迂回する。色相はTint Amount=0なら結果へ影響しない。無彩色のa/bは変換誤差を除去して0にするが、元から微弱な色味がある画素のクロマは切り捨てない。

### 階調

18%グレーのL（`cbrt(0.18)`）を中間の固定点とし、黒→中間グレー→白を2区間の単調な有理二次曲線でつなぐ。各区間の端点の傾きは区間の縦横比で正規化する。

- 中間グレーの傾きはContrast。
- 黒の傾きは`(1 - 0.95 * Shadow Softness) / Contrast`。
- 白の傾きは`(1 - 0.95 * Highlight Softness) / Contrast`。
- 白の出力Lは`1 - 0.2 * Highlight Softness`。局所コントラストの低下だけでなく、通常のSDR素材の白にも柔らかな圧縮を効かせる。
- L<0／L>1は各端点の接線で延長する。最大Softnessでも傾きを正に保ち、範囲外の階調差を残す。
- Fadeは最後に`blackLift + (1 - blackLift) * L`を適用する。`blackLift = 0.25 * Fade`。Fade=1の黒はlinear RGBで約0.015625となる。

各接続点では値と傾きが連続する。Fadeも正の傾きの一次変換なので、全パラメータ範囲で単調性を保つ。RGB各成分に独立した曲線は適用しない。Toneだけの調整ではOklabのa/bを保持するが、明度が変わるためRGB上の輝度比や彩度が一定になるわけではない。

### 色

Chroma CompressionはC<=0.05を変更せず、それを超えた量`e = C - 0.05`を`0.05 + e / (1 + 4 * Chroma Compression * e)`へ圧縮する。しきい値では値と傾きが連続し、L・色相を保持する。入力色域へのマッピングやRGBのclampは行わない。

色付けの重みは処理前のLから求める。Shadowは黒と中間グレーで0、その中間で最大となる。負のLには色を足さない。Highlightは中間グレーからL=1までsmoothstepで増え、HDRでは最大の重みを維持する。中間グレーにはどちらの色も足さない。指定した色相方向のa/bへ、最大C=0.05にTint Amountと重みを掛けた量を加える。

画素単位の1描画パスで完結し、時刻・乱数・履歴・解像度・アスペクト比に依存しない。Exposureや全体のクロマ調整は前後に接続する各エフェクトで指定する。粒子・ハレーション・周辺減光は独立したエフェクトで組み合わせる。
