/** 選択済みのブラウザファイルへ書き込み、失敗時は元の内容を維持する。 */
export async function writeFileSystemFile(handle: FileSystemFileHandle, data: Uint8Array): Promise<void> {
	const writable = await handle.createWritable();
	try {
		await writable.write(new Uint8Array(data));
		await writable.close();
	} catch (error) {
		// closeが成功するまでは元ファイルへ反映されない。abortの失敗で元のエラーを隠さない。
		await writable.abort().catch(() => {});
		throw error;
	}
}
