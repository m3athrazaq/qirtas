// Built-in page covers: plain ink tones and a few geometric patterns drawn from
// Arabic architecture and notebook paper. All are CSS so they cost nothing offline.

const svg = (s: string) => `url("data:image/svg+xml,${encodeURIComponent(s)}")`

function khatam(bg: string, fg: string) {
  // eight-pointed star (khatam) tessellation
  return `${svg(
    `<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 80 80'><g fill='none' stroke='${fg}' stroke-width='1.4'><path d='M40 12 L48 32 L68 40 L48 48 L40 68 L32 48 L12 40 L32 32 Z'/><path d='M20 20 L40 28 L60 20 L52 40 L60 60 L40 52 L20 60 L28 40 Z'/><path d='M0 0 L8 20 M80 0 L72 20 M0 80 L8 60 M80 80 L72 60 M0 0 L20 8 M80 0 L60 8 M0 80 L20 72 M80 80 L60 72'/></g></svg>`,
  )} ${bg}`
}

function ruled(bg: string, line: string, margin: string, side: 'right' | 'left') {
  const x = side === 'right' ? 'calc(100% - 64px)' : '64px'
  return `linear-gradient(90deg, transparent ${x}, ${margin} ${x}, ${margin} calc(${x} + 2px), transparent calc(${x} + 2px)), repeating-linear-gradient(180deg, ${bg} 0 27px, ${line} 27px 28px)`
}

function arches(bg: string, fg: string) {
  return `${svg(
    `<svg xmlns='http://www.w3.org/2000/svg' width='48' height='64' viewBox='0 0 48 64'><path d='M4 64 V30 Q4 10 24 4 Q44 10 44 30 V64' fill='none' stroke='${fg}' stroke-width='1.3'/><path d='M12 64 V34 Q12 20 24 15 Q36 20 36 34 V64' fill='none' stroke='${fg}' stroke-width='0.9' opacity='.6'/></svg>`,
  )} ${bg}`
}

function lattice(bg: string, fg: string) {
  return `${svg(
    `<svg xmlns='http://www.w3.org/2000/svg' width='36' height='36' viewBox='0 0 36 36'><g fill='none' stroke='${fg}' stroke-width='1.2'><path d='M0 18 L18 0 L36 18 L18 36 Z'/><circle cx='18' cy='18' r='5'/></g></svg>`,
  )} ${bg}`
}

function dunes(bg: string, fg: string) {
  return `${svg(
    `<svg xmlns='http://www.w3.org/2000/svg' width='120' height='40' viewBox='0 0 120 40'><path d='M0 30 Q30 10 60 30 T120 30' fill='none' stroke='${fg}' stroke-width='1.3'/><path d='M0 18 Q30 -2 60 18 T120 18' fill='none' stroke='${fg}' stroke-width='0.8' opacity='.55'/></svg>`,
  )} ${bg}`
}

function dots(bg: string, fg: string) {
  return `radial-gradient(${fg} 1.3px, transparent 1.6px) 0 0 / 18px 18px, ${bg}`
}

export const COVER_COLORS: Record<string, string> = {
  ink: '#1d2740',
  lapis: '#2c4bb4',
  teal: '#1f6f6b',
  sage: '#8fa58a',
  sand: '#d8c39a',
  dates: '#7a4a2c',
  plum: '#5b3a5e',
  rubric: '#b5443a',
  slate: '#5e6675',
  dawn: 'linear-gradient(120deg, #f0d9b5 0%, #e8a87c 45%, #9b5d73 100%)',
  dusk: 'linear-gradient(135deg, #1d2740 0%, #2c4bb4 60%, #8fa7ff 100%)',
  oasis: 'linear-gradient(135deg, #1f6f6b 0%, #8fa58a 70%, #d8c39a 100%)',
}

export function coverPatterns(rtl: boolean): Record<string, string> {
  return {
    khatam: khatam('#1d2740', '#c9a96a'),
    khatamLight: khatam('#efe9dc', '#2c4bb4'),
    ruled: ruled('#fbfbf8', '#c9d3ea', '#d2564b', rtl ? 'right' : 'left'),
    arches: arches('#2c4bb4', '#e8eeff'),
    lattice: lattice('#1f6f6b', '#d8c39a'),
    dunes: dunes('#d8c39a', '#7a4a2c'),
    dots: dots('#f3f1ea', '#1d2740'),
    night: dots('#14171f', '#8fa7ff'),
  }
}

export function coverBackground(cover: { kind: 'color' | 'pattern'; value: string }, rtl: boolean): string {
  if (cover.kind === 'color') return COVER_COLORS[cover.value] ?? cover.value
  return coverPatterns(rtl)[cover.value] ?? COVER_COLORS.ink
}
