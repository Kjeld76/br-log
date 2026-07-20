// Inline-SVG statt <img>: `currentColor` übernimmt so die geerbte Textfarbe,
// wodurch aktive/inaktive Tabs (BottomNav, Sidebar) an der Icon-Farbe selbst
// erkennbar sind -- der Zustand wird nicht mehr allein über die Pillen-
// Position vermittelt (Barrierefreiheit). Der frühere Grund für <img>
// (kollidierende Gradient-IDs zwischen mehreren Inline-SVGs) entfällt mit
// den Verläufen ersatzlos.
const PATHS = {
  "alert-triangle":
    '<path d="M10.3 4.3 2.5 18a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z"></path><path d="M12 9v4M12 17h.01"></path>',
  archive:
    '<rect x="3" y="4" width="18" height="4" rx="1"></rect><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4"></path>',
  "bar-chart":
    '<path d="M4 4v16h16"></path><path d="M8 16v-4M13 16V8M18 16v-6"></path>',
  calendar:
    '<rect x="3" y="4" width="18" height="17" rx="2.5"></rect><path d="M3 9h18"></path><path d="M8 2v4M16 2v4"></path>',
  check: '<path d="M20 6 9 17l-5-5"></path>',
  "chevron-right": '<path d="m9 6 6 6-6 6"></path>',
  clock: '<circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>',
  download: '<path d="M12 3v12m0 0 4-4m-4 4-4-4M4 21h16"></path>',
  edit: '<path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"></path>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"></path><circle cx="12" cy="12" r="3"></circle>',
  filter: '<path d="M3 5h18M6 12h12M10 19h4"></path>',
  fingerprint:
    '<path d="M12 10a2 2 0 0 0-2 2c0 3-1 5-1 5"></path><path d="M12 6a6 6 0 0 1 6 6c0 2 .5 4 1 5"></path><path d="M6 12a6 6 0 0 1 3-5.2"></path><path d="M12 14v.5c0 1.5-.3 3-1 4.5"></path>',
  folder:
    '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>',
  "folder-open":
    '<path d="M4 20a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v2"></path><path d="m2.5 19 2.4-6a1.5 1.5 0 0 1 1.4-1H21a1 1 0 0 1 1 1.3L20 19a2 2 0 0 1-1.9 1.4H4.3A1.8 1.8 0 0 1 2.5 19z"></path>',
  info: '<circle cx="12" cy="12" r="9"></circle><path d="M12 11v5"></path><path d="M12 8h.01"></path>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"></path><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01"></path>',
  lock: '<rect x="4" y="11" width="16" height="9" rx="2"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path>',
  "more-vertical":
    '<circle cx="12" cy="5" r="1.6" fill="currentColor" stroke="none"></circle><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"></circle><circle cx="12" cy="19" r="1.6" fill="currentColor" stroke="none"></circle>',
  plus: '<path d="M12 5v14M5 12h14"></path>',
  printer:
    '<path d="M6 9V2h12v7"></path><rect x="6" y="14" width="12" height="8"></rect><path d="M6 18H4a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-2"></path>',
  search: '<circle cx="11" cy="11" r="7"></circle><path d="m21 21-4.3-4.3"></path>',
  settings:
    '<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H1a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 2.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H7a1.6 1.6 0 0 0 1-1.5V1a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V7a1.6 1.6 0 0 0 1.5 1H23a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"></path>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"></path>',
  upload: '<path d="M12 21V9m0 0 4 4m-4-4-4 4M4 3h16"></path>',
  x: '<path d="M18 6 6 18M6 6l12 12"></path>',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 18,
  className = "",
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: PATHS[name] }}
    />
  );
}
