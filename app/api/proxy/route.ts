import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 60 // 设置最大超时时间为 60 秒（Vercel hobby 计划的限制）

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url')
  const rangeHeader = request.headers.get('Range')
  const origin = request.headers.get('Origin') || '*'

  if (!url) {
    return NextResponse.json({ error: 'URL is required' }, { 
      status: 400,
      headers: {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Range',
      }
    })
  }

  console.log('Proxying request to:', url)

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 55000) // 55 秒超时，留出一些缓冲时间

    const headers: HeadersInit = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Accept': '*/*'
    }

    // 如果有 Range 头，则转发它
    if (rangeHeader) {
      headers['Range'] = rangeHeader
    }

    const response = await fetch(url, {
      signal: controller.signal,
      headers
    })

    clearTimeout(timeoutId)

    if (!response.ok && response.status !== 206) { // 206 是部分内容的状态码
      console.error('Proxy request failed:', response.status, response.statusText)
      return NextResponse.json({
        error: `Failed to fetch: ${response.status} ${response.statusText}`
      }, { 
        status: response.status,
        headers: {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Range',
          'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges',
        }
      })
    }

    const contentType = response.headers.get('Content-Type')
    const contentLength = response.headers.get('Content-Length')
    const contentRange = response.headers.get('Content-Range')

    console.log('Proxy response headers:', {
      'Content-Type': contentType,
      'Content-Length': contentLength,
      'Content-Range': contentRange
    })

    const blob = await response.blob()
    
    const responseHeaders: HeadersInit = {
      'Content-Type': contentType || 'application/octet-stream',
      'Content-Length': contentLength || String(blob.size),
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Range',
      'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Accept-Ranges': 'bytes',
      'Vary': 'Origin'
    }

    // 如果有 Content-Range，则转发它
    if (contentRange) {
      responseHeaders['Content-Range'] = contentRange
    }

    return new NextResponse(blob, {
      status: response.status,
      headers: responseHeaders,
    })
  } catch (error) {
    console.error('Proxy error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to fetch'
    return NextResponse.json({ error: errorMessage }, { 
      status: error instanceof Error && error.name === 'AbortError' ? 504 : 500,
      headers: {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Range',
        'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges',
        'Vary': 'Origin'
      }
    })
  }
}

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get('Origin') || '*'
  
  return new NextResponse(null, {
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Range',
      'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin'
    },
  })
} 