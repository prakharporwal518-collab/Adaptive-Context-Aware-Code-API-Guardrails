/* Minimal 16px stroke icon set. Only glyphs that label something real. */
const s = (d, extra = '') =>
  `<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}${extra}</svg>`;

export const icons = {
  overview: s('<path d="M2 9.5h4v4H2zM2 2.5h4v4H2zM10 2.5h4v8h-4zM10 12.5h4v1h-4z"/>'),
  code: s('<path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5"/>'),
  api: s('<path d="M2 4h12M2 8h12M2 12h12"/><circle cx="5" cy="4" r="1.3" fill="currentColor" stroke="none"/><circle cx="9" cy="8" r="1.3" fill="currentColor" stroke="none"/><circle cx="6" cy="12" r="1.3" fill="currentColor" stroke="none"/>'),
  risk: s('<path d="M8 1.8 2.3 4.4v4c0 3.1 2.4 5.3 5.7 5.9 3.3-.6 5.7-2.8 5.7-5.9v-4z"/><path d="M8 5.6v3M8 10.6v.5"/>'),
  policy: s('<path d="M3 2.5h7l3 3v8H3z"/><path d="M9.5 2.5v3.5H13"/><path d="M5.5 8.5h5M5.5 11h3"/>'),
  copilot: s('<path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"/><path d="M5.5 6.2h5M5.5 8.2h3"/>'),
  audit: s('<circle cx="8" cy="8" r="6"/><path d="M8 4.6V8l2.4 1.6"/>'),
  file: s('<path d="M4 2h5l3 3v9H4z"/><path d="M8.7 2v3.2H12"/>'),
  folder: s('<path d="M2 4.2h4l1.2 1.5H14v7.3H2z"/>'),
  chevron: s('<path d="M6 4l4 4-4 4"/>'),
  close: s('<path d="M4 4l8 8M12 4l-8 8"/>'),
  check: s('<path d="M3.5 8.4l3 3 6-6.8"/>'),
  copy: s('<path d="M5.5 5.5h8v8h-8z"/><path d="M10.5 5.5v-3h-8v8h3"/>'),
  ext: s('<path d="M9 2.5h4.5V7"/><path d="M13.5 2.5 7 9"/><path d="M11.5 9.5v4h-9v-9h4"/>'),
  filter: s('<path d="M2.5 3.5h11l-4.2 5v4.2l-2.6-1.3V8.5z"/>'),
  search: s('<circle cx="7" cy="7" r="4.2"/><path d="M10.2 10.2 14 14"/>'),
  play: s('<path d="M5 3.2 12 8l-7 4.8z"/>'),
  shield: s('<path d="M8 1.8 2.3 4.4v4c0 3.1 2.4 5.3 5.7 5.9 3.3-.6 5.7-2.8 5.7-5.9v-4z"/><path d="M5.6 8.1 7.3 9.8l3.2-3.4"/>'),
};

/* Wordmark. A bracketed shield — the guard rail closing around a payload.
   Drawn, not clip-arted; it scales to 16px without turning to mush. */
export const mark = (size = 18) => `
<svg class="mark" width="${size}" height="${size}" viewBox="0 0 20 20" fill="none" aria-hidden="true">
  <path d="M10 1.6 3.2 4.3v5.2c0 4 2.7 6.9 6.8 8 4.1-1.1 6.8-4 6.8-8V4.3z"
        stroke="#5a9fd4" stroke-width="1.5" stroke-linejoin="round"/>
  <path d="M7.2 7.2 5 10l2.2 2.8M12.8 7.2 15 10l-2.2 2.8"
        stroke="#e4e8ef" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
