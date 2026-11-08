# Fourier画像処理の共通部品

effect/shared内で使う、バッチ化した2次元FFTと画像解析領域の定義。個々のエフェクトやGlitch Studioのプロジェクト・再生状態には依存しない。

- `definitions.wgsl`：32byteの複素RGB、FourierTransformUniforms、添字・bit反転・等方的な帯域重み。
- `transform.wgsl`：8×8のdispatchで各ブロックの一段のradix-2 butterflyを実行。入力と出力のbufferを分け、逆変換は各段で1/2へ正規化する。
- `layout.ts`：出力解像度に依存しないGlobal・反射拡張・50%重なるBlocksの領域と、個別buffer・dispatchの容量検証。

FFTを使う側は`definitions.wgsl`と`transform.wgsl`を結合し、binding 0へFourierTransformUniforms、binding 1へ読み取り専用の複素buffer、binding 2へ書き込み先を渡す。複数のブロックはdispatchのZ方向へ並べる。入力値は両軸ともbit反転した順序で準備する。

親のuniformへ組み込む場合は、先頭のフィールドとしてFourierTransformUniformsを配置する。FFT側はその先頭部分だけを読み、エフェクト固有のパラメータを知らない。入力のサンプリング・係数の加工・差分の合成・bufferの寿命やパス順序は利用側が所有する。
