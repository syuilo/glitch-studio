# SDF Boolean

内側が負・外側が正の2つの符号付き距離場を、Union・Intersection・Difference（A − B）で合成する。出力はスカラーの距離場で、SDF to Maskへ接続して塗り・輪郭を描ける。XORは含まない。

## パラメータと演算

- A・Bはスカラーの定数またはノード出力。初期値はいずれも空形状の65504。
- OperationはUnion（初期値）・Intersection・Difference（A − B）。DifferenceはAからBを除く方向に固定する。
- Smoothingは初期値0、負の値は0として扱う。描画全体で共通の値で、式・automationなどによる変更に対応する。ノード接続はA・Bのみ。
- 距離・Smoothingの単位は既存SDFと同じく描画領域の高さを1とする。出力を0〜1へ正規化しない。

Smoothingが0なら、Unionは`min(a, b)`、Intersectionは`max(a, b)`、Differenceは`max(a, -b)`。正なら次の多項式で合成する。

```text
k = Smoothing
h = max(1 - abs(a - b) / k, 0)
smoothMin(a, b) = min(a, b) - k * h² / 4
smoothMax(a, b) = -smoothMin(-a, -b)

Union        = smoothMin(a, b)
Intersection = smoothMax(a, b)
Difference   = smoothMax(a, -b)
```

`abs(a - b) >= k`の領域は通常のmin/maxと一致する。Smoothingは接合部の形状を変える混合幅で、角丸半径や画像のぼかし幅ではない。同じSDFを2つ接続しても、滑らかなUnionでは距離が`k/4`小さくなり、Intersectionでは`k/4`大きくなる。

入力値65504は空形状として予約し、Smoothingの有無によらず次を保つ。

- Union（A, 空）とUnion（空, A）はA。
- Intersectionは、いずれかが空なら空。
- Difference（A, 空）はA、Difference（空, B）は空。

## サンプリング・解像度

自動解像度は宣言したA・Bの静的な接続寸法のうち画素数が大きい方を基準にし、同数ならAを優先する。定数には固有の解像度がないため、両方とも定数なら描画先を使う。明示的な解像度指定は通常のエフェクトと同様に優先される。

入力ごとのfit・filter・wrapを利用する。Transparentの場合は距離値を0へ補間せず、端を延長して読んだ距離場と入力領域の矩形SDFとの共通部分`max(distance, rectangleDistance)`を取る。これにより、Containなどの余白では形状が切り抜かれ、領域外にも境界からの正の距離が残る。空形状65504は、この矩形処理でも空形状のまま保つ。入力が全て負の場合、Transparentは入力領域の矩形を形状として扱う。Clampは距離値を端で延長し、Repeat／Repeat Mirroredは通常の繰り返しで読む。

距離値の倍率はfitに応じて補正しない。入力は同じ座標系・距離単位に揃えることを基本とし、非等方拡縮された場で画面上の実距離が保たれるとは限らない。

## 精度・実行

合成後の最短距離を再計算する処理は含まない。出力は形状を表す場として使用できるが、接合部などで厳密なSDFとは限らず、後段の線幅・Featherが一定の実幅になることも保証しない。同じ形状同士のDifferenceは通常`abs(d)`になり、内部が消えても距離0の境界だけが残る。その境界はSDF to MaskのAAや輪郭として見える場合がある。

出力形式は`enable32bitDataTextures`に従う`r16float`／`r32float`。演算結果はそれぞれの保存形式の有限な範囲に飽和させる。16bitの上限65504に達した正の距離は、空形状の予約値と区別できない。Smoothingはf32の有限な正の範囲までを扱う。

追加の距離計算や中間テクスチャを使わず、GPUで1パス描画する。時刻・描画履歴・乱数に依存しない。他のエフェクトの実装には依存せず、矩形の距離計算だけを共通のGPU数学処理から利用する。
