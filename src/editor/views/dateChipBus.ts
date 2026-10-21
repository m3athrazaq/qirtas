// Lets the "date" slash command open the picker of the chip it just inserted.
let openNext = false
export function openDateChipNext() {
  openNext = true
}
export function consumeOpenNext(): boolean {
  const v = openNext
  openNext = false
  return v
}
