import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createKernel } from '@sublate/kernel'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { ctx, plugins } = await createKernel(resolve(root, 'profiles/default/cordis.yml'))

console.table(plugins)

const demo = ctx.get('demo') as { ping(message: string): string } | undefined
if (!demo) {
  console.error('demo 服务未注册，插件树加载失败')
  process.exitCode = 1
} else {
  console.log(demo.ping('SublateMaze'))
}
