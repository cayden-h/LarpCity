// UI sprites share a 20 × 20 integer grid. Filled shapes avoid subpixel SVG
// strokes, so the icons stay sharp at the 2× sizes used by the HUD.
const art: Record<string, string> = {
  pin: `
    <path fill="#101a23" d="M6 1h8v2h2v2h2v8h-2v2h-2v2h-2v2H8v-2H6v-2H4v-2H2V5h2V3h2z"/>
    <path fill="#f04b50" d="M6 3h8v2h2v7h-2v2h-2v2h-1v2H9v-2H8v-2H6v-2H4V5h2z"/>
    <path fill="#ff8b85" d="M6 4h6v2H8v2H6z"/>
    <path fill="#172a38" d="M8 6h5v5H7V7h1z"/>
    <path fill="#fff2d1" d="M9 7h3v3H8V8h1z"/>`,
  calendar: `
    <path fill="#101a23" d="M2 3h4V1h3v2h3V1h3v2h3v16H2z"/>
    <path fill="#f45155" d="M4 5h12v4H4z"/>
    <path fill="#fff7dd" d="M4 9h12v8H4z"/>
    <path fill="#173b59" d="M6 11h3v2H6zM11 11h3v2h-3zM6 14h3v2H6zM11 14h3v2h-3z"/>
    <path fill="#fff" d="M5 5h10v1H5z"/>`,
  home: `
    <path fill="#101a23" d="M9 1h3v2h2v2h2v2h2v3h-2v9H4v-9H2V7h2V5h2V3h3z"/>
    <path fill="#ed514d" d="M9 3h3v2h2v2h2v2h-3V7h-2V5H9v2H7v2H4V8h2V6h2V4h1z"/>
    <path fill="#fff7dd" d="M6 10h8v7h-3v-5H9v5H6z"/>
    <path fill="#cfe9e4" d="M7 11h2v3H7zM11 9h2v2h-2z"/>`,
  map: `
    <path fill="#101a23" d="M1 3h6l6-2 6 2v15h-6l-6 2-6-2z"/>
    <path fill="#42bde8" d="M3 5h3v12H3zM8 5l4-2v12l-4 2zM14 3l3 1v12h-3z"/>
    <path fill="#71ba3b" d="M3 5h3v4H5v3H3zM8 6h4v4h-2v3H8zM14 4h3v6h-2v3h-1z"/>
    <path fill="#ffe052" d="M5 13h3v3H5zM11 3h3v4h-3zM14 13h3v3h-3z"/>`,
  weather: `
    <path fill="#ffd83d" d="M12 1h2v3h-2zM12 16h2v3h-2zM5 8h3v2H5zM18 8h2v2h-2zM7 3h2v2H7zM16 3h2v2h-2z"/>
    <path fill="#f1a719" d="M10 5h6v2h2v6h-2v2h-6v-2H8V7h2z"/>
    <path fill="#ffe86b" d="M10 6h5v2h2v4h-2v2h-5V12H9V8h1z"/>
    <path fill="#587b91" d="M4 10h8v2h3v5H2v-2H1v-3h3z"/>
    <path fill="#dff6ff" d="M5 9h6v2h3v4H2v-3h3z"/>
    <path fill="#fff" d="M5 10h5v2H4v2H2v-2h3z"/>`,
  stocks: `
    <path fill="#18362f" d="M1 1h18v18H1z"/>
    <path fill="#2cf04a" d="M2 16h3v-4h3v2h2V9h3V6h3V3h3v4h-2V6h-1v2h-3v4h-2v4H7v-2H6v4H2z"/>
    <path fill="#70ff82" d="M3 15h2v-2H4zM11 10h2V8h-1zM14 6h2V5h-1z"/>`,
  goals: `
    <path fill="#101a23" d="M4 1h3v18H4z"/>
    <path fill="#f0b51c" d="M7 2h11v9H7z"/>
    <path fill="#0877cf" d="M8 3h8v2h-2v2h2v2H8z"/>
    <path fill="#84dfff" d="M9 4h5v1h-2v2H9z"/>`,
  news: `
    <path fill="#101a23" d="M2 1h16v18H2z"/>
    <path fill="#fff7dd" d="M4 3h12v14H4z"/>
    <path fill="#e54c50" d="M5 5h5v5H5z"/>
    <path fill="#fff" d="M6 6h3v2H6z"/>
    <path fill="#4d7082" d="M11 5h4v2h-4zM11 8h4v2h-4zM5 12h10v2H5zM5 15h7v1H5z"/>`,
  mail: `
    <path fill="#101a23" d="M1 4h18v13H1z"/>
    <path fill="#eaf8ff" d="M3 6h14v9H3z"/>
    <path fill="#4ba7e6" d="M3 6h2l5 4 5-4h2v2l-7 5-7-5z"/>
    <path fill="#a9ddfa" d="M3 10l5 4H3zM17 10v4h-5z"/>`,
  bank: `
    <path fill="#101a23" d="M9 1h2v1h3v2h3v2h2v3H1V6h2V4h3V2h3zM2 17h16v2H2z"/>
    <path fill="#fff7dd" d="M4 9h3v7H4zM9 9h3v7H9zM14 9h3v7h-3z"/>
    <path fill="#d8ead6" d="M5 10h1v5H5zM10 10h1v5h-1zM15 10h1v5h-1z"/>
    <path fill="#fff7dd" d="M4 6l6-3 6 3z"/>`,
  taxes: `
    <path fill="#101a23" d="M3 1h10l4 4v14H3z"/>
    <path fill="#fff7dd" d="M5 3h7v4h4v10H5z"/>
    <path fill="#cfe9e4" d="M10 3l4 4h-4z"/>
    <path fill="#4d7082" d="M7 9h6v1H7zM7 11h6v1H7zM7 13h4v1H7z"/>
    <path fill="#e54c50" d="M7 15h5v2H7z"/>`,
  "face-happy": `
    <path fill="#101a23" d="M6 2h8v2h2v2h2v8h-2v2h-2v2H6v-2H4v-2H2V6h2V4h2z"/>
    <path fill="#ffd83d" d="M6 4h8v2h2v8h-2v2H6v-2H4V6h2z"/>
    <path fill="#101a23" d="M6 8h2v3H6zM12 8h2v3h-2zM6 13h8v1H6zM6 14h1v1H6zM13 14h1v1h-1z"/>
    <path fill="#101a23" d="M7 15h6v1H7z"/>`,
  "face-neutral": `
    <path fill="#101a23" d="M6 2h8v2h2v2h2v8h-2v2h-2v2H6v-2H4v-2H2V6h2V4h2z"/>
    <path fill="#ffd83d" d="M6 4h8v2h2v8h-2v2H6v-2H4V6h2z"/>
    <path fill="#101a23" d="M6 8h2v3H6zM12 8h2v3h-2zM6 14h8v1H6z"/>`,
  "face-sad": `
    <path fill="#101a23" d="M6 2h8v2h2v2h2v8h-2v2h-2v2H6v-2H4v-2H2V6h2V4h2z"/>
    <path fill="#7fb5d6" d="M6 4h8v2h2v8h-2v2H6v-2H4V6h2z"/>
    <path fill="#101a23" d="M6 8h2v3H6zM12 8h2v3h-2zM6 15h1v1H6zM13 15h1v1h-1zM7 14h6v1H7z"/>`,
};

export function pixelIcon(name: string, className = ""): string {
  return `<svg class="pixel-icon ${className}" viewBox="0 0 20 20" aria-hidden="true" focusable="false" shape-rendering="crispEdges">${art[name] ?? art.map}</svg>`;
}
