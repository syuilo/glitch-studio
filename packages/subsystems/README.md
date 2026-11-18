これらのパッケージは一機能にすぎず、「プロジェクト」の状態などの上位概念を知っていてはならない。

Glitch Studioとは関係ないライブラリとして提供できるレベルで、Glitch Studioのコンテキストから分離されているのが理想。

もちろんglitch-studio層へは依存しないが、他のsubsystemへの一方向への依存や、トップレベルのsharedへの依存はあってもいい。

`image-codec`はGPU・Canvas・Asset・Sceneに依存しない画像形式の入出力を担当する。現在はTinyEXR/WASMによるHALF RGBAのOpenEXRエンコードを提供する。呼び出し側がブロック単位で画素を渡し、進捗や中断を管理する。

[`effect-new`](./effect-new/README.md)は、Native Effect・Custom Node Graph Effect・Custom Shader Effect の定義と実行を統一する基盤。配置ごとに使用する入力の表現・出力ポート・描画順を初期化時に決める。
