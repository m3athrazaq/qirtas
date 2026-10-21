import { Shuffle } from 'lucide-react'
import { useMemo, useState } from 'react'
import { t, type Key } from '../lib/i18n'

const CATS: { key: Key; icon: string; list: string }[] = [
  {
    key: 'e_smileys',
    icon: '😊',
    list: '😀 😃 😄 😁 😊 🙂 😉 😍 🥰 😘 😎 🤓 🧐 🤔 🤗 🤩 🥳 😇 🙃 😌 😴 🤤 😮 😲 😳 🥺 😢 😭 😤 😡 🤯 😱 🤫 🤭 🫡 🫣 😬 🙄 😅 😂 🤣 😐 😶 🤐',
  },
  {
    key: 'e_people',
    icon: '🤲',
    list: '🤲 🙏 👍 👎 👏 🙌 👋 🤝 ✌️ 🤞 👌 🫶 💪 🧠 👀 🫀 👶 🧒 👦 👧 🧑 👨 👩 🧓 👴 👵 🧕 👳 🧔 👨‍💻 👩‍💻 👨‍🏫 👩‍🏫 👨‍⚕️ 👩‍⚕️ 👨‍🍳 👨‍🌾 👷 🧑‍🎓 👪 🏃 🚶 🧘 🏋️ 🤸',
  },
  {
    key: 'e_nature',
    icon: '🌙',
    list: '🌙 🌛 🌕 ⭐ 🌟 ✨ ☀️ 🌤️ ⛅ 🌧️ ⛈️ ❄️ 🌈 🔥 💧 🌊 🌴 🌵 🌳 🌲 🌱 🌿 🍀 🌾 🌸 🌹 🌺 🌻 🌷 🍂 🍁 🐪 🐫 🐑 🐐 🐄 🐎 🦅 🐦 🕊️ 🐈 🐕 🐟 🐬 🦋 🐝',
  },
  {
    key: 'e_food',
    icon: '☕',
    list: '☕ 🫖 🍵 🥛 🧃 🍯 🧆 🥙 🌯 🥗 🍲 🍛 🍚 🍞 🥖 🥐 🧀 🍳 🥩 🍗 🍖 🐟 🍤 🍕 🍔 🍟 🌭 🥪 🍝 🍜 🍣 🍰 🎂 🍪 🍫 🍩 🍦 🍉 🍇 🍎 🍊 🍋 🍌 🍓 🥭 🍍 🥥 🫒 🌰 🥜',
  },
  {
    key: 'e_activity',
    icon: '⚽',
    list: '⚽ 🏀 🏈 ⚾ 🎾 🏐 🏓 🏸 🥊 🏊 🚴 🏇 ⛳ 🎯 🎳 🎮 🧩 ♟️ 🎨 🎬 🎤 🎧 🎼 🎹 📷 🏆 🥇 🥈 🥉 🎖️ 🎁 🎉 🎊 🎈 🪅 🧵 🧶 🪁',
  },
  {
    key: 'e_travel',
    icon: '🕌',
    list: '🕌 🕋 🏠 🏡 🏢 🏫 🏥 🏦 🏨 🏪 🏬 🏭 🏗️ 🏛️ ⛺ 🏝️ 🏜️ 🏔️ 🗺️ 🧭 ✈️ 🛫 🛬 🚗 🚕 🚙 🚌 🚆 🚇 🚢 ⛴️ 🛳️ ⚓ 🚀 🛰️ 🚲 🛵 ⛽ 🚦 🗽 🗼 🌍 🌏 🧳',
  },
  {
    key: 'e_objects',
    icon: '📖',
    list: '📖 📚 📕 📗 📘 📙 📓 📒 📔 📝 ✏️ ✒️ 🖋️ 🖊️ 📎 📌 📍 📂 📁 🗂️ 🗃️ 🗄️ 📋 📊 📈 📉 🗓️ 📅 📆 ⏰ ⏳ ⌛ 🕰️ 💡 🔦 🔑 🗝️ 🔒 🔓 💼 💰 💵 💳 🧾 🪙 📱 💻 ⌨️ 🖥️ 🖨️ 🎓 📿 🧭 🛒 🎒 🧳 📦 ✉️ 📮 📣 🔔 🧰 🔧 🔨 ⚙️ 🧪 🔬 🩺 💊 🧴 🧹',
  },
  {
    key: 'e_symbols',
    icon: '✅',
    list: '✅ ☑️ ✔️ ❌ ❎ ⭕ 🔴 🟠 🟡 🟢 🔵 🟣 🟤 ⚫ ⚪ 🟥 🟧 🟨 🟩 🟦 🟪 ❤️ 🧡 💛 💚 💙 💜 🤍 🖤 💯 ❗ ❓ ⚠️ 🚫 ♻️ ☪️ ☮️ 🔆 💤 🆕 🆗 🔝 ▶️ ⏸️ ⏹️ 🔁 ➕ ➖ ✳️ ❇️ 🔶 🔷 🔸 🔹 💠 🏁 🚩',
  },
  {
    key: 'e_flags',
    icon: '🇰🇼',
    list: '🇰🇼 🇸🇦 🇦🇪 🇶🇦 🇧🇭 🇴🇲 🇾🇪 🇮🇶 🇯🇴 🇸🇾 🇱🇧 🇵🇸 🇪🇬 🇸🇩 🇱🇾 🇹🇳 🇩🇿 🇲🇦 🇲🇷 🇹🇷 🇮🇷 🇵🇰 🇮🇳 🇲🇾 🇮🇩 🇬🇧 🇺🇸 🇫🇷 🇩🇪 🇮🇹 🇪🇸 🇧🇷 🇦🇷 🇺🇾 🇦🇺 🇿🇦 🇨🇳 🇯🇵 🇰🇷',
  },
]

const RECENT_KEY = 'qirtas.recentEmoji'

function getRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
  } catch {
    return []
  }
}

export const ALL_EMOJI = CATS.flatMap((c) => c.list.split(' '))

export function randomEmoji(): string {
  const pool = CATS.filter((c) => ['e_nature', 'e_objects', 'e_travel', 'e_food', 'e_activity'].includes(c.key)).flatMap((c) => c.list.split(' '))
  return pool[Math.floor(Math.random() * pool.length)]
}

export function EmojiPicker({ onPick, onRemove }: { onPick: (e: string) => void; onRemove?: () => void }) {
  const recent = useMemo(getRecent, [])
  const [cat, setCat] = useState(recent.length ? -1 : 0)
  const list = cat === -1 ? recent : CATS[cat].list.split(' ')

  const pick = (e: string) => {
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify([e, ...getRecent().filter((x) => x !== e)].slice(0, 24)))
    } catch {
      /* ignore */
    }
    onPick(e)
  }

  return (
    <div className="emoji-picker">
      <div className="emoji-toolbar">
        <button type="button" className="btn-text" onClick={() => pick(randomEmoji())}>
          <Shuffle size={14} /> {t('random')}
        </button>
        {onRemove && (
          <button type="button" className="btn-text" onClick={onRemove}>
            {t('removeIcon')}
          </button>
        )}
      </div>
      <div className="emoji-tabs" role="tablist">
        {recent.length > 0 && (
          <button type="button" role="tab" aria-selected={cat === -1} title={t('emojiRecent')} className={cat === -1 ? 'is-active' : ''} onClick={() => setCat(-1)}>
            🕘
          </button>
        )}
        {CATS.map((c, i) => (
          <button type="button" role="tab" key={c.key} aria-selected={cat === i} title={t(c.key)} className={cat === i ? 'is-active' : ''} onClick={() => setCat(i)}>
            {c.icon}
          </button>
        ))}
      </div>
      <div className="emoji-label">{cat === -1 ? t('emojiRecent') : t(CATS[cat].key)}</div>
      <div className="emoji-grid">
        {list.map((e, i) => (
          <button type="button" key={e + i} onClick={() => pick(e)} className="emoji-cell">
            {e}
          </button>
        ))}
      </div>
    </div>
  )
}
