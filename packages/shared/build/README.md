# WGSLの事前解析

`wgsl-shader.mjs`はNode専用のビルド処理です。Viteの通常ビルド・Workerビルドには`wgslShaderVitePlugin()`、esbuildには`wgslShaderEsbuildPlugin()`を登録します。利用側のtsconfigの`types`には`@gs/shared/wgsl-imports`を含めます。

```ts
import code, { uniforms } from './shader.wgsl?shader';
import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';

const values = createShaderBuffer(uniforms.uniforms);
values.set({ strength: 0.5 });
// codeをGPUへ渡し、values.arrayBufferをuniform bufferへ転送する。
```

default exportはWGSL文字列です。名前付きexportの`uniforms`・`storages`・`structs`は、バッファ長と各フィールドの型付き配列の位置・長さを持ちます。WGSL側の宣言が唯一の情報源であり、エフェクトごとに配置表を手書きする必要はありません。使わないexportはtree-shakingで除去できます。ソース文字列だけが必要なシェーダーでは従来の`?raw`も使えます。

複数のWGSLやTypeScript定数を組み合わせる場合は、同じディレクトリの`*.shader.ts`から完成した文字列をdefault exportし、それを`?shader`付きでimportします。

```ts
// shader.shader.ts
import common from './common.wgsl?raw';
import body from './shader.wgsl?raw';
import { sampleCount } from './constants.ts';

export default `const SAMPLE_COUNT = ${sampleCount}u;\n` + common + '\n' + body;
```

このファイルはビルド中にNodeで実行されるため、開発者が管理する純粋なソース組み立てだけを置きます。DOM・GPU・作品のパラメータ・ユーザーのコードを参照しません。依存するWGSLや定数の変更も監視し、開発時に文字列と配置情報を同時に更新します。

配置の算出にはビルド側だけで`webgpu-utils`を使用します。実行側の`createShaderBuffer()`は配置情報に従って新しいArrayBufferを作り、`set()`で部分更新します。実行時の解像度・時刻・パラメータ値やGPUのシェーダーコンパイルは従来通りです。サイズが実行時に変わるstorage bufferや動的に生成する入力bindingは、それぞれの既存の生成処理で扱います。
