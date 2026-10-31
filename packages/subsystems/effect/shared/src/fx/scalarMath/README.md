# Scalar Math

スカラー場を画素ごとに計算する。A・B・Cはスカラーの定数またはノード出力で、初期値はそれぞれ0・0・1。出力はスカラー場で、0〜1には制限しない。

## 演算

Operationは通常パラメータで、式・アニメーションによる切り替えに対応する。初期値はAdd。

- Aのみ: Absolute、Sign、Floor、Ceil、Round、Fract、Square Root、Sine、Cosine、Tangent。
- A・B: Add、Subtract、Multiply、Divide、Minimum、Maximum、Modulo、Power、Step、Greater Than、Less Than、Equal。
- A・B・C: Smoothstep、Clamp。

三角関数の角度はturn単位で、1が1周。StepはAが閾値B以上なら1、それ以外は0。比較演算の出力も1または0になる。Moduloは`A - B * floor(A / B)`で、剰余の符号は除数Bに揃える。

Smoothstepは境界BからCへ0〜1に変化し、同一境界ではStep、逆順では1から0への変化になる。ClampはB・Cの小さい方を下限、大きい方を上限として扱う。

0除算・0によるModulo・負数の平方根・負の底の非整数乗・0の負乗・Tangentの特異点（0.25・0.75 turnとその整数周期）は0を返す。0の0乗は1。

## 解像度・実行

自動解像度は、演算で使うかどうかにかかわらず、A・B・Cの全接続の静的な計画寸法から決める。画素数が最大の入力の幅・高さを採用し、同数ならA→B→Cの順で優先する。定数には固有寸法がなく、すべて定数ならcontextを使う。ノードの倍率・context・固定寸法の指定は共通の解像度設定に従う。

旧実装は選択中の演算に必要な入力だけから解像度を求めていたが、現在は通常パラメータの評価前に解像度を確定する。そのため未使用のB・Cへの接続も算定対象にし、Operationの切り替えで寸法や`RESOLUTION`が変わらないようにする。例えばAが640×360、Bが1920×1080なら、AddでもAbsoluteでも自動解像度は1920×1080になる（ノード倍率1の場合）。

入力ごとのfit・filter・wrapを利用する。出力形式は`enable32bitDataTextures`に従う`r16float`／`r32float`。GPUで1パス描画し、演算別のパイプラインを必要になった時点で作成・キャッシュする。描画履歴には依存しない。
