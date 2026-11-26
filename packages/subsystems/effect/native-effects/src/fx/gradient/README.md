# Gradient

`Start Position` と `End Position` で位置を補間の進行率に変換し、`Frequency`・`Phase`・`Skew`・`Mirror Repeat` を適用します。`Interpolation` の Function Curve はこの進行率をXとし、Yが0で `Value A`、1で `Value B` になるように `scalar` を出力します。既定値は Linear です。Smooth Pulseを選ぶと1区間で A → B → A と変化します。Yが0〜1を越えると、A・Bの外側の値も出力します。

`vector` は `scalar` の空間勾配です。カーブの傾きと、進行率・`Value A`・`Value B` の空間変化を反映します。ミラー反復ではカーブを逆向きに辿る側の進行率の勾配が反転します。曲線の段差や周期の継ぎ目では、不連続な変化から生じる勾配を0とします。
