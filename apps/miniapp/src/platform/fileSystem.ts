import Taro from '@tarojs/taro'

/**
 * 读取本地临时文件为 base64 —— 头像与内容图两条链路共用。
 *
 * 为什么单独一个文件：`Taro.getFileSystemManager().readFile` 是回调风格，
 * 且它的 `fail` 回调给的是 `{ errMsg }` 而不是 Error。这段适配写两遍
 * 必然会出现一处忘了包 Error、于是抛出的东西没有 message 的情况。
 */
export function readFileAsBase64(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    Taro.getFileSystemManager().readFile({
      filePath,
      encoding: 'base64',
      success: (result) => resolve(String(result.data ?? '')),
      fail: (error) => reject(new Error(error.errMsg ?? '读取文件失败')),
    })
  })
}
