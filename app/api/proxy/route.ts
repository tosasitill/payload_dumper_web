import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 300 // 设置最大超时时间为 5 分钟

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url')
  if (!url) {
    return NextResponse.json({ error: 'URL is required' }, { status: 400 })
  }

  console.log('Proxying request to:', url)

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 300000) // 5 minutes timeout

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      console.error('Proxy request failed:', response.status, response.statusText)
      return NextResponse.json({
        error: `Failed to fetch: ${response.status} ${response.statusText}`
      }, { status: response.status })
    }

    const contentType = response.headers.get('Content-Type')
    const contentLength = response.headers.get('Content-Length')

    console.log('Proxy response headers:', {
      'Content-Type': contentType,
      'Content-Length': contentLength
    })

    const blob = await response.blob()
    
    return new NextResponse(blob, {
      headers: {
        'Content-Type': contentType || 'application/octet-stream',
        'Content-Length': contentLength || String(blob.size),
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    })
  } catch (error) {
    console.error('Proxy error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to fetch'
    return NextResponse.json({ error: errorMessage }, { 
      status: error instanceof Error && error.name === 'AbortError' ? 504 : 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
      }
    })
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  })
} 