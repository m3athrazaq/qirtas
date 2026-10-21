import { useEditorState, type Editor } from '@tiptap/react'
import { colorFromValue, COLOR_NAMES, highlightValue, textColorValue } from '../lib/colors'
import { t } from '../lib/i18n'
import { MenuLabel } from '../ui/Popover'

/** Inline text color + highlight for the current selection. */
export function ColorMenu({ editor, onDone }: { editor: Editor; onDone?: () => void }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      color: colorFromValue(e.getAttributes('textStyle').color),
      bg: colorFromValue(e.getAttributes('textStyle').backgroundColor),
    }),
  })
  return (
    <div className="color-menu">
      <MenuLabel>{t('textColor')}</MenuLabel>
      <div className="swatches">
        <button
          type="button"
          className={'swatch' + (!state.color ? ' is-on' : '')}
          title={t('defaultColor')}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            editor.chain().focus().unsetColor().run()
            onDone?.()
          }}
        >
          <span className="swatch-a">A</span>
        </button>
        {COLOR_NAMES.map((c) => (
          <button
            type="button"
            key={c}
            className={'swatch' + (state.color === c ? ' is-on' : '')}
            title={t(`c_${c}`)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              editor.chain().focus().setColor(textColorValue(c)).run()
              onDone?.()
            }}
          >
            <span className="swatch-a" style={{ color: textColorValue(c) }}>
              A
            </span>
          </button>
        ))}
      </div>
      <MenuLabel>{t('bgColor')}</MenuLabel>
      <div className="swatches">
        <button
          type="button"
          className={'swatch' + (!state.bg ? ' is-on' : '')}
          title={t('defaultColor')}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            editor.chain().focus().unsetBackgroundColor().run()
            onDone?.()
          }}
        >
          <span className="swatch-bg" />
        </button>
        {COLOR_NAMES.map((c) => (
          <button
            type="button"
            key={c}
            className={'swatch' + (state.bg === c ? ' is-on' : '')}
            title={t(`c_${c}`)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              editor.chain().focus().setBackgroundColor(highlightValue(c)).run()
              onDone?.()
            }}
          >
            <span className="swatch-bg" style={{ background: highlightValue(c) }} />
          </button>
        ))}
      </div>
    </div>
  )
}

/** Whole-block color (used by the block handle menu). */
export function BlockColorMenu({ onPick }: { onPick: (v: string | null) => void }) {
  return (
    <div className="color-menu">
      <MenuLabel>{t('textColor')}</MenuLabel>
      <div className="swatches">
        <button type="button" className="swatch" title={t('defaultColor')} onClick={() => onPick(null)}>
          <span className="swatch-a">A</span>
        </button>
        {COLOR_NAMES.map((c) => (
          <button type="button" key={c} className="swatch" title={t(`c_${c}`)} onClick={() => onPick(c)}>
            <span className="swatch-a" style={{ color: textColorValue(c) }}>
              A
            </span>
          </button>
        ))}
      </div>
      <MenuLabel>{t('bgColor')}</MenuLabel>
      <div className="swatches">
        {COLOR_NAMES.map((c) => (
          <button type="button" key={c} className="swatch" title={t(`c_${c}`)} onClick={() => onPick(`${c}_bg`)}>
            <span className="swatch-bg" style={{ background: highlightValue(c) }} />
          </button>
        ))}
      </div>
    </div>
  )
}
