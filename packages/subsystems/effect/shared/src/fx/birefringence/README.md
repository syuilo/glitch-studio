# Birefringence

無偏光の光源 → 理想的な線偏光板 → 複屈折板 → 検光子（2枚目の線偏光板）を、光が垂直に通過するときの干渉色を生成する。応力のかかった透明なプラスチックや偏光顕微鏡の見た目を作れる。応力・変形・結晶構造自体は計算せず、厚み・複屈折量・速軸の向きを上流の場から受け取る。

## パラメータ

| パラメータ | 初期値 | 意味 |
| --- | --- | --- |
| Thickness Input | 0.5 | 0〜1をMinimum / Maximum Thicknessへ線形に対応させるスカラー場。範囲外は0〜1へ制限 |
| Minimum Thickness / Maximum Thickness | 0 / 100 µm | 厚みの両端。負値は0。大小を逆にすれば厚みの対応も反転 |
| Birefringence (Δn) | 0.01 | 速軸・遅軸の屈折率差。符号は透過強度に影響しないため絶対値を使う |
| Fast Axis Angle | 0.125 turn（45°） | 画面内の速軸の向き |
| Polarizer Angle | 0 turn | 光源側の偏光板の向き |
| Analyzer Angle | 0.25 turn（90°） | 観察側の偏光板の向き。初期値は直交偏光 |
| Light Color | 白、不透明 | 最初の偏光板へ入射する無偏光の光源色 |
| Brightness | 1 | linear RGBで適用する光量倍率。負値は0 |
| Opacity | 1 | 光源のalphaに掛ける被覆率。0〜1に制限 |

Thickness Input・Birefringence・Fast Axis Angle・Light Color・Opacityは定数とノード接続に対応する。全パラメータで式・automationを利用できる。角度は共通のangle入力と同じturn単位（右が0、時計回りに1周が1）で、各軸は半回転で同じ向きになる。

## 計算と制約

厚みを`d`（µm）、屈折率差を`Δn`、波長を`λ`（nm）とすると、光路差は`Γ = 1000 * d * abs(Δn)`、位相差は`δ = 2πΓ / λ`。Jonesベクトルを板の速軸・遅軸に分解し、それぞれの位相をずらして検光子へ射影する。

直交偏光では、偏光板に対する速軸の角度を`θ`として、入射光に対する透過率は`0.5 * sin²(2θ) * sin²(πΓ/λ)`。厚み・屈折率差が0、または速軸が偏光板と平行なら消光する。光路差0では、任意の偏光板の角度差`β`に対して`0.5 * cos²(β)`のMalusの法則になる。最初の偏光板による1/2の光量損失を含むため、必要ならBrightnessを2にして補える。

可視域380〜780nmを5nm刻みの81点で積分する。共通の`optics/spectral-samples.ts`でCIE 1931等色関数を近似し、等エネルギーの光を白に正規化する。Light Colorはその結果へのRGBの着色で、任意の光源の分光分布を再構築するものではない。RGB色域外の成分は積分後に制限する。サンプリング間隔は固定なので、スライダー範囲（最大光路差4000nm）を大幅に超える値では干渉色の精度が低下する。

単一の損失のない複屈折板を垂直入射で計算する。波長による屈折率差の変化、表面反射・屈折による像の分離、吸収、複数の板の重なりは扱わない。出力は観察されるRGB画像であり、偏光状態そのものを後続のエフェクトへ渡すものではない。

GPU上の入力色・出力色は乗算済みRGBA（色のリテラルは共通の入力処理で乗算する）。光学的な消光はRGBの暗さに反映し、alphaはLight ColorのalphaとOpacityだけで決めるため、消光した部分は不透明な黒になる。材質の切り抜きにはOpacityへマスクを接続する。

物理的な厚みは画面の解像度・縦横比・Size Referenceに依存しない。入力は通常のFit / Wrap / Filterで参照し、自動解像度はノード接続可能な入力から決まる。描画履歴・時刻・乱数を使わない1パスの処理で、出力形式は`intermediateTextureFormat`に従う。

## 使用例

- NoiseをThickness Inputへ接続し、Maximum Thicknessを50〜150µmで調整すると、厚みの変化に沿った干渉色になる。
- 厚みを一定にしてNoiseをBirefringenceへ接続すれば、屈折率差の分布による模様を作れる。入力の倍率はScalar Mathなどで調整する。
- Fast Axis Angleへ角度の場を接続すれば、厚みの色に加えて消光方向が場所ごとに変わる。Analyzer Angleを回すと模様の明暗・色が変化する。

参考: [Nikon MicroscopyU: Principles of Birefringence](https://www.microscopyu.com/techniques/polarized-light/principles-of-birefringence)、[Harvard: Photoelasticity](https://sciencedemonstrations.fas.harvard.edu/presentations/photoelasticity)。
