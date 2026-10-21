import * as Y from 'yjs'
import { allAssets, dumpAll, putAsset } from './idb'
import { flushWrites, getDoc } from './docs'
import { useStore } from './store'

function toB64(u: Uint8Array): string {
  let s = ''
  const chunk = 0x8000
  for (let i = 0; i < u.length; i += chunk) s += String.fromCharCode(...u.subarray(i, i + chunk))
  return btoa(s)
}
function fromB64(b: string): Uint8Array {
  const s = atob(b)
  const u = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i)
  return u
}

export async function buildBackup(): Promise<string> {
  await flushWrites()
  const updates = await dumpAll()
  const byDoc = new Map<string, Uint8Array[]>()
  updates.forEach((u) => {
    const l = byDoc.get(u.docId) ?? []
    l.push(u.update)
    byDoc.set(u.docId, l)
  })
  const docs: Record<string, string> = {}
  byDoc.forEach((list, id) => (docs[id] = toB64(list.length === 1 ? list[0] : Y.mergeUpdates(list))))
  const assets = await Promise.all(
    (await allAssets()).map(async (a) => ({ id: a.id, type: a.type, data: toB64(new Uint8Array(await a.blob.arrayBuffer())) })),
  )
  return JSON.stringify({ app: 'qirtas', version: 1, exportedAt: new Date().toISOString(), workspaceId: useStore.getState().ws?.id, docs, assets })
}

export async function restoreBackup(json: string): Promise<number> {
  const data = JSON.parse(json) as { app: string; docs: Record<string, string>; assets?: { id: string; type: string; data: string }[] }
  if (data.app !== 'qirtas') throw new Error('not a qirtas backup')
  const ws = useStore.getState().ws
  let n = 0
  for (const [docId, b64] of Object.entries(data.docs)) {
    const target = docId.startsWith('ws:') && ws ? ws.doc : await getDoc(docId)
    Y.applyUpdate(target, fromB64(b64))
    n++
  }
  for (const a of data.assets ?? []) {
    await putAsset({ id: a.id, type: a.type, blob: new Blob([fromB64(a.data) as BlobPart], { type: a.type }), createdAt: Date.now() })
  }
  await flushWrites()
  return n
}
