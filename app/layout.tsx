import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Payload Dumper Online',
  description: '在线提取 Android OTA 更新包中的分区文件',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh">
      <body>{children}</body>
    </html>
  )
}
