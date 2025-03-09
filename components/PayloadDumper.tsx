'use client'

import { useState, useRef } from 'react'
import { CloudArrowUpIcon, GlobeAltIcon } from '@heroicons/react/24/outline'
import { PayloadHandler } from '@/lib/payloadHandler'

interface PartitionDownload {
  name: string;
  url: string;
}

export default function PayloadDumper() {
  const [inputType, setInputType] = useState<'file' | 'url'>('file')
  const [url, setUrl] = useState('')
  const [selectedPartitions, setSelectedPartitions] = useState<string[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [downloads, setDownloads] = useState<PartitionDownload[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const commonPartitions = [
    'boot',
    'init_boot',
    'vendor_boot',
    'dtbo',
    'vbmeta',
    'system',
    'vendor',
    'product',
  ]

  const handlePartitionToggle = (partition: string) => {
    setSelectedPartitions(prev =>
      prev.includes(partition)
        ? prev.filter(p => p !== partition)
        : [...prev, partition]
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (selectedPartitions.length === 0) {
      alert('请至少选择一个分区')
      return
    }

    const file = fileInputRef.current?.files?.[0]
    if (inputType === 'file' && !file) {
      alert('请选择文件')
      return
    }

    if (inputType === 'url' && !url) {
      alert('请输入URL')
      return
    }

    setIsProcessing(true)
    setDownloads([])

    try {
      const handler = PayloadHandler.getInstance()
      
      // 设置进度回调
      handler.onProgress = (partition: string, url: string) => {
        setDownloads(prev => [...prev, { name: partition, url }])
      }

      await handler.processPayload({
        type: inputType,
        source: inputType === 'file' ? file! : url,
        partitions: selectedPartitions,
      })
    } catch (error) {
      console.error('Error:', error)
      alert('处理失败，请重试')
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div className="bg-white shadow sm:rounded-lg p-6">
      <div className="space-y-6">
        <div>
          <div className="flex space-x-4">
            <button
              type="button"
              onClick={() => setInputType('file')}
              className={`flex items-center px-4 py-2 rounded-md ${
                inputType === 'file'
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-100 text-gray-700'
              }`}
            >
              <CloudArrowUpIcon className="h-5 w-5 mr-2" />
              上传文件
            </button>
            <button
              type="button"
              onClick={() => setInputType('url')}
              className={`flex items-center px-4 py-2 rounded-md ${
                inputType === 'url'
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-100 text-gray-700'
              }`}
            >
              <GlobeAltIcon className="h-5 w-5 mr-2" />
              输入URL
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {inputType === 'file' ? (
            <div>
              <label className="block text-sm font-medium text-gray-700">
                选择 payload.bin 文件或包含它的 ZIP 文件
              </label>
              <input
                type="file"
                ref={fileInputRef}
                accept=".bin,.zip"
                className="mt-1 block w-full text-sm text-gray-500
                          file:mr-4 file:py-2 file:px-4
                          file:rounded-md file:border-0
                          file:text-sm file:font-semibold
                          file:bg-blue-50 file:text-blue-700
                          hover:file:bg-blue-100"
                required
              />
            </div>
          ) : (
            <div>
              <label
                htmlFor="url"
                className="block text-sm font-medium text-gray-700"
              >
                输入 payload.bin 或 ZIP 文件的URL
              </label>
              <input
                type="url"
                id="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                placeholder="https://example.com/payload.bin"
                required
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              选择要提取的分区
            </label>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {commonPartitions.map((partition) => (
                <label
                  key={partition}
                  className="inline-flex items-center"
                >
                  <input
                    type="checkbox"
                    checked={selectedPartitions.includes(partition)}
                    onChange={() => handlePartitionToggle(partition)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="ml-2 text-sm text-gray-700">{partition}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <button
              type="submit"
              disabled={isProcessing}
              className={`w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white ${
                isProcessing
                  ? 'bg-blue-400 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              {isProcessing ? '处理中...' : '开始提取'}
            </button>
          </div>
        </form>

        {downloads.length > 0 && (
          <div className="mt-8">
            <h3 className="text-lg font-medium text-gray-900 mb-4">
              可下载的分区文件
            </h3>
            <div className="space-y-4">
              {downloads.map((download) => (
                <div
                  key={download.name}
                  className="flex items-center justify-between p-4 bg-gray-50 rounded-md"
                >
                  <span className="text-sm font-medium text-gray-700">
                    {download.name}
                  </span>
                  <a
                    href={download.url}
                    download={`${download.name}.img`}
                    className="text-sm text-blue-600 hover:text-blue-500"
                  >
                    下载
                  </a>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
} 