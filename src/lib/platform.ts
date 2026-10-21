import { Capacitor, registerPlugin } from '@capacitor/core'

export const isNative = () => Capacitor.isNativePlatform()
export const isAndroid = () => Capacitor.getPlatform() === 'android'

interface QirtasNativePlugin {
  print(options: { name: string }): Promise<void>
  getSharedContent(): Promise<{ text?: string; subject?: string; image?: string } | null>
  setWidgetData(options: { json: string }): Promise<void>
}

export const QirtasNative = registerPlugin<QirtasNativePlugin>('QirtasNative')

export async function printWebView(name: string) {
  try {
    await QirtasNative.print({ name })
  } catch {
    window.print()
  }
}

/** Save a text or binary file: download on the web, share sheet on Android. */
export async function saveFile(filename: string, data: string | Blob, mime = 'text/plain') {
  if (isNative()) {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
    const { Share } = await import('@capacitor/share')
    let written
    if (typeof data === 'string') {
      written = await Filesystem.writeFile({ path: filename, data, directory: Directory.Cache, encoding: Encoding.UTF8 })
    } else {
      const base64 = await blobToBase64(data)
      written = await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache })
    }
    await Share.share({ files: [written.uri], title: filename })
    return
  }
  const blob = typeof data === 'string' ? new Blob([data], { type: `${mime};charset=utf-8` }) : data
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  }
}
