/**
 * 测试夹具：生成最小可解析的 PDF，避免把二进制样本文档提交进仓库。
 *
 * 只支持 ASCII 文本与 Helvetica；用于验证文本提取链路，不追求排版效果。
 */
export function createMinimalPdf(text: string): Uint8Array {
  const encoder = new TextEncoder()
  const stream = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`

  const objects: string[] = [
    '',
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
      '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]

  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []

  for (let index = 1; index < objects.length; index += 1) {
    offsets[index] = encoder.encode(pdf).length
    pdf += `${index} 0 obj\n${objects[index]!}\nendobj\n`
  }

  const xrefOffset = encoder.encode(pdf).length
  pdf += `xref\n0 ${objects.length}\n`
  pdf += '0000000000 65535 f \n'
  for (let index = 1; index < objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`

  return encoder.encode(pdf)
}
