// Icone Flaticon UIcons (regular rounded) — font in vendor/uicons, credito in Impostazioni
const MAP = {
  mic: 'microphone',
  up: 'arrow-small-up',
  plus: 'plus-small',
  search: 'search',
  gear: 'settings',
  check: 'check',
  trash: 'trash',
  x: 'cross-small',
  chevron: 'angle-small-down',
  back: 'angle-small-left',
  sparkles: 'sparkles',
  pencil: 'pencil',
  calendar: 'calendar',
  group: 'apps',
  flat: 'list',
  download: 'download',
  upload: 'upload',
  eye: 'eye',
  phone: 'mobile-notch',
  bolt: 'bolt',
  tag: 'tags',
  palette: 'palette',
  coffee: 'coffee',
  heart: 'heart',
  warn: 'triangle-warning',
  bell: 'bell',
  clock: 'clock',
  send: 'paper-plane',
  repeat: 'arrows-repeat',
  notes: 'notebook',
  copy: 'copy',
  share: 'share',
  restore: 'undo',
};

export function icon(name, cls = '') {
  return `<i class="fi-rr-${MAP[name] || name} ico ${cls}" aria-hidden="true"></i>`;
}

// Icona di una lista (nome UIcons salvato in list.icon)
export function listIcon(l, cls = '') {
  return `<i class="fi-rr-${l.icon || 'clipboard-list'} li ${cls}" aria-hidden="true"></i>`;
}
