# Audio Shared

取得元・再生方法に依存しないPCMの型を定義します。Asset・Player・Scene・レイヤーやGPUの状態を扱いません。

ステレオPCMはチャンネルごとのFloat32Arrayで、リサンプリング用のデコードブロックは元のサンプルレートと秒単位のタイムスタンプを保持します。
