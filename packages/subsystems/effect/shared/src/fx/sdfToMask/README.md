# SDF to Mask

内側が負・外側が正の符号付き距離場から、塗り・輪郭を表す0〜1のスカラーマスクを生成する。Shape SDF・Mask to SDFの出力を接続でき、色やRGBA画像への変換は後段のColor Ramp・Compose Colorなどで行う。

## パラメータ

- Inputはスカラーの定数またはノード出力。初期値65504は、既存SDFの空形状と同じく初期設定でマスク0になる。
- ModeはFill（初期値）またはStroke。
- Offsetは境界の移動量で初期値0。正で外側へ広げ、負で内側へ縮める。
- Stroke Widthは輪郭の全幅で初期値0.01。非正なら反転前のマスクは全て0。Fillでは使用しない。
- Stroke AlignmentはInside／Center（初期値）／Outside。Offset適用後の境界を基準に輪郭を配置する。
- Featherは0〜1へ滑らかに変化する遷移の全幅で初期値0。境界の内外へ半分ずつ広がり、負の値は0とする。
- Anti-aliasは初期値true。出力画素における距離の変化幅`fwidth(d - Offset)`とFeatherの大きい方を、実際の遷移幅に使う。Featherの幅にAA幅を加算しない。
- Invertは初期値false。透明余白の処理も含めて、最後に`1 - mask`へ反転する。

Offset・Stroke Width・FeatherはSize Referenceの基準寸法に対する比率で、既定値はLong Side。内部で基準寸法/出力高さを掛け、入力SDFの高さ単位へ換算する。以下の数式のOffset・Width・Featherは換算後の値を表す。調整パラメータは画面全体で共通の値で、式・automationなどによるアニメーションに対応する。ノード接続はInputだけで受け付ける。

## 塗り・輪郭・滑らかさ

`q = d - Offset`とする。AA無効かつFeather=0なら、Fillは`q < 0`を1にする。StrokeはInsideが`-Width < q < 0`、Centerが`-Width/2 < q < Width/2`、Outsideが`0 < q < Width`を1にする。これらの境界ちょうどの値は0になる。

遷移幅が正なら、塗りの被覆率を`C(q) = 1 - smoothstep(-遷移幅/2, 遷移幅/2, q)`とし、Strokeは上下の境界に対応する二つの被覆率の差を使う。幅0の輪郭はAA・Featherにかかわらず0。1画素未満の線やFeatherより細い線は、中心も1未満になり得る。画像をぼかすブラーや、中心を常に1へ正規化する輪郭処理ではない。

一様な入力などで微分が0になる場合も扱い、遷移幅0では明示的に二値判定する。輪郭の中央で`abs`を微分したり、距離による分岐の中で微分したりしない。

## サンプリングと出力

通常の自動解像度はInputを基準とし、定数入力では描画先を使う。入力のfit・filter・wrapを利用するが、Transparentだけは距離を0へ補間せず、距離値を端で延長して読んだ後に透明領域の被覆率をマスクへ掛ける。これにより、Containの余白に輪郭やFeatherが現れない。Invertはその後なので、反転時は余白も1になる。

距離値自体の再計算や、fitによる拡縮に応じた距離値の倍率補正は行わない。非等方拡縮などで正確なSDFでなくなった入力では、Offset・線幅・Featherが画面上の実距離と一致するとは限らない。Mask to SDFから作った入力も、その距離場から新しいマスクを描くもので、元画像の半透明値を完全には復元しない。

GPUでは追加の距離計算・中間テクスチャを使わず、1パスで描画する。出力形式は`enable32bitDataTextures`に応じた`r16float`／`r32float`。入力が同じなら履歴・時刻・乱数に依存せず、同じ結果を生成する。
