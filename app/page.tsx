import PayloadDumper from '@/components/PayloadDumper'

export default function Home() {
  return (
    <main className="min-h-screen bg-gray-100">
      <div className="max-w-7xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-gray-900 mb-8">
            Payload Dumper Online
          </h1>
          <p className="text-xl text-gray-600 mb-12">
            在线提取 Android OTA 更新包中的分区文件
          </p>
        </div>
        <PayloadDumper />
      </div>
    </main>
  )
}
