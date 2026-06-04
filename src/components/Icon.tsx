import alertTriangle from "../assets/icons/alert-triangle.svg";
import calendar from "../assets/icons/calendar.svg";
import clock from "../assets/icons/clock.svg";
import download from "../assets/icons/download.svg";
import eye from "../assets/icons/eye.svg";
import folderOpen from "../assets/icons/folder-open.svg";
import lock from "../assets/icons/lock.svg";
import upload from "../assets/icons/upload.svg";

// Marken-SVGs (eigener Blau→Grün-Verlauf). Als <img> eingebunden, damit die
// gleichlautende Gradient-ID nicht zwischen mehreren Inline-SVGs kollidiert.
const ICONS = {
  "alert-triangle": alertTriangle,
  calendar,
  clock,
  download,
  eye,
  "folder-open": folderOpen,
  lock,
  upload,
} as const;

export type IconName = keyof typeof ICONS;

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
    <img
      src={ICONS[name]}
      width={size}
      height={size}
      className={className}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}
