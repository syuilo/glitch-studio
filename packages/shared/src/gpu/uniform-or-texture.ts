/** 空間的に一定の値。フレームごとに値が変わってもよい。 */
export type UniformValue = { kind: 'uniform'; value: readonly number[] };

/** テクスチャへの参照。値の受け渡しによって所有権は移らない。 */
export type TextureValue = { kind: 'texture'; texture: GPUTexture };

/**
 * ノード・レイヤーなどの生成元や用途によらない、定数またはテクスチャの値。
 * サンプリング設定は受け取り側が指定するため、この値には含めない。
 * 色は両形式ともpremultiply済み。スカラー・ベクトルなどのデータには乗算しない。
 */
export type UniformOrTexture = UniformValue | TextureValue;
