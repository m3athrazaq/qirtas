// Images live in IndexedDB on the device; pages refer to them as "asset:<id>".
import { useEffect, useState } from 'react'
import { uid } from '../lib/ids'
import { getAsset, putAsset } from './idb'

const urlCache = new Map<string, string>()
type RemoteResolver = (id: string) => Promise<string | null>
let remoteResolver: RemoteResolver | null = null
export function setRemoteAssetResolver(fn: RemoteResolver | null) {
  remoteResolver = fn
}

type UploadHook = (id: string, blob: Blob) => void
let uploadHook: UploadHook | null = null
export function setAssetUploadHook(fn: UploadHook | null) {
  uploadHook = fn
}

export async function importImage(file: Blob, maxSide = 1800): Promise<string> {
  const blob = await downscale(file, maxSide)
  const id = uid(16)
  await putAsset({ id, blob, type: blob.type, createdAt: Date.now() })
  uploadHook?.(id, blob)
  return `asset:${id}`
}

async function downscale(file: Blob, maxSide: number): Promise<Blob> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.type === 'image/svg+xml') return file
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
    if (scale === 1 && file.size < 1_500_000) return file
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * scale)
    canvas.height = Math.round(bmp.height * scale)
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
    return await new Promise<Blob>((res) => canvas.toBlob((b) => res(b ?? file), type, 0.86))
  } catch {
    return file
  }
}

export async function resolveAsset(src: string | null | undefined): Promise<string | null> {
  if (!src) return null
  if (!src.startsWith('asset:')) return src
  const id = src.slice(6)
  const hit = urlCache.get(id)
  if (hit) return hit
  const a = await getAsset(id)
  if (a) {
    const url = URL.createObjectURL(a.blob)
    urlCache.set(id, url)
    return url
  }
  if (remoteResolver) {
    const url = await remoteResolver(id)
    if (url) {
      urlCache.set(id, url)
      return url
    }
  }
  return null
}

export function useAssetUrl(src: string | null | undefined): { url: string | null; loading: boolean } {
  const [state, setState] = useState<{ url: string | null; loading: boolean }>(() => {
    if (!src) return { url: null, loading: false }
    if (!src.startsWith('asset:')) return { url: src, loading: false }
    const hit = urlCache.get(src.slice(6))
    return { url: hit ?? null, loading: !hit }
  })
  useEffect(() => {
    let alive = true
    if (!src) {
      setState({ url: null, loading: false })
      return
    }
    void resolveAsset(src).then((url) => alive && setState({ url, loading: false }))
    return () => {
      alive = false
    }
  }, [src])
  return state
}

export function pickFile(accept = 'image/*'): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.addEventListener('cancel', () => resolve(null))
    input.click()
  })
}
