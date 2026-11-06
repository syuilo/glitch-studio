# Fractal Noise

Value NoiseまたはSimplex Noiseを複数の周波数・振幅で重ねるfBmの生成エフェクト。出力はスカラー場で、描画履歴には依存しない。同じ座標・Time・Seed・設定なら、描画順序やフレームレートによらず同じ値になる。

## 座標

- Coordinate Source = Screen（初期値）: 各画素の位置を使う。
- Coordinate Source = Input: Coordinatesの値を絶対座標として使う。定数・式・vectorのノード接続に対応し、定数なら画面全体で同じ位置のノイズを評価する。画面座標への変位ではない。

どちらも長辺全体=1・中央原点・右が+X・上が+Yの共通単位。入力座標に画面の端を超えた値を渡しても、その位置でノイズを直接評価する。生成済みのノイズ画像を変形する方式ではないため、ノイズ自体の画像境界や補間誤差を挟まない。ただし入力した座標場の参照には通常のfit・filter・wrapを使う。

Size Referenceで選んだ寸法をB、描画領域の長辺をLとすると、第1段のノイズ座標は次になる。

```text
noisePosition.xy = coordinates * (L / B) * Density + Offset
noisePosition.z = Time
```

Size ReferenceはDensityの見た目の基準を変え、Coordinatesの共通単位は変えない。OffsetはSnoiseと同様にノイズ内部の座標単位で、画面上の移動距離ではない。

## パラメータ

| パラメータ | 初期値 | 意味 |
| --- | --- | --- |
| Noise Type | Value Noise | 3次補間の3D Value Noise、またはSnoiseと共通の3D Simplex Noise |
| Density | [4, 4] | 基準寸法内のノイズの密度。各成分の負値は0とする |
| Offset | [0, 0] | 第1段のノイズ座標のXYオフセット |
| Octaves | 4 | 重ねる段数。四捨五入して1〜16に制限し、非有限値は4とする |
| Gain | 0.5 | 次の段の振幅倍率。0〜1に制限。0なら第1段だけになる |
| Lacunarity | 2 | 次の段の周波数倍率。0〜8に制限し、XYと時間軸に適用する |
| Octave Rotation | 0.1 turn | 次の段へ進むたびにXY座標を時計回りに回転。1 turnで1周 |
| Time | 0 | ノイズの第3軸。式に`TIME`を指定すると連続的に変化する |
| Seed | 0 | ノイズの配置を決める値 |
| Output Min / Max | 0 / 1 | 正規化したノイズの出力範囲。負値・1超・逆順にも対応する |

Coordinates・Density・Offset・Gain・Lacunarity・Output Min / Maxは画素ごとのノード入力に対応する。他は画面全体で共通の通常パラメータで、式・アニメーションを使える。Timeは長時間の再生でも16bitの場へ丸めないよう、32bitのuniformとして渡す。SeedもCPU上で扱い、32bitへ丸める前にノイズ座標のオフセットへ変換する。

第1段の振幅を1とし、各段の値を加重平均する。実際の振幅の総和で正規化するため、Octaves・Gainを変えても指定した出力範囲を保つ。Seedによるオフセットは各段の周波数変換後に加える。Value Noiseのhash・正規化・周波数倍率は汎用の仕様であり、特定のシェーダーとの完全一致は目的としない。

## 接続例

- 色を付ける: 出力をColor RampのInputへ接続する。
- 変位を作る: Offsetの異なるFractal Noiseを2個作り、Output Min / Maxを-1 / 1にしてCompose VectorのX・Yへ接続する。
- ドメインワープ: そのCompose Vectorを別のFractal NoiseのCoordinatesへ接続し、Coordinate SourceをInputにする。入力座標の倍率は受け側のDensityでも調整できる。
- 元の位置からの変位にする場合は、元の位置場と変位場を上流で加算してCoordinatesへ渡す。

## 解像度・実行

自動解像度はCoordinatesの接続の静的な計画寸法、定数の場合は描画先を使う。Coordinate Sourceは式で切り替えられるため、ScreenでもCoordinatesの接続を解像度の算定対象にし、切り替えで解像度が変わらないようにする。その他の入力は制御用の場として扱う。

1描画パスで全段を評価する。出力形式は`enable32bitDataTextures`に従う`r16float`／`r32float`。高いDensity・Lacunarity・Octavesでは画素より細かい模様が発生し、エイリアシングが生じる場合がある。自動的な周波数の打ち切りやスーパーサンプリングは行わない。

`CHROME_PATH`を指定し、`node --test packages/subsystems/effect/shared/test/fractal-noise.gpu.test.mjs`で実際のWebGPU描画を検証する。
