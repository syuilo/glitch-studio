# Audio Shared

取得元・再生方法に依存しないPCMの型を定義します。Asset・Player・Scene・レイヤーやGPUの状態を扱いません。

ステレオPCMはチャンネルごとのFloat32Arrayで、リサンプリング用のデコードブロックは元のサンプルレートと秒単位のタイムスタンプを保持します。

`AudioInput`は1回の描画に固定した音声入力です。`readWindow(durationSeconds, signal)`で基準時刻までのPCMを取得し、`cacheKey`で取得元・時刻・変更世代を識別します。基準時刻の意味と具体的な取得元は呼び出し側が所有します。`AudioWindow`は`sampleRate`・`frameCount`と`sample(frame, channel)`で読む固定区間です。PCM配列は公開せず、窓の先頭を0とする整数サンプル位置で読みます。範囲外は0、モノラルは左右同じ値を返します。同期の履歴入力と非同期のデコード入力の両方を扱えます。

`sourceKey`は同じサンプル座標とPCMを共有する取得元・変更世代の識別子です。通常の追記では維持し、シークによる履歴のリセット、取得元の差し替え、既存PCMの編集では変更します。`sampleRate`と、保持PCMの半開区間`[startFrame, endFrame)`を公開し、サンプル単位で解析区間を選べるようにします。任意の過去を読み出せる取得元の`startFrame`は`-Infinity`です。窓のフレーム数は`getAudioWindowFrameCount()`で決め、足りない過去のPCMは先頭をゼロで補完します。

`createAudioWindow()`は所有者が変更しない連続ステレオPCMをコピーせず包みます。ブロック形式の履歴も同じビュー契約を使い、利用側は記憶形式を知りません。`audio-capture.ts`は取得元に依存しないPCM受信メッセージを定義します。
