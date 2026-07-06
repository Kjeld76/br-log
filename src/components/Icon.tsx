import alertTriangle from "../assets/icons/alert-triangle.svg";
import barChart from "../assets/icons/bar-chart.svg";
import calendar from "../assets/icons/calendar.svg";
import clock from "../assets/icons/clock.svg";
import download from "../assets/icons/download.svg";
import eye from "../assets/icons/eye.svg";
import folderOpen from "../assets/icons/folder-open.svg";
import info from "../assets/icons/info.svg";
import lock from "../assets/icons/lock.svg";
import moreVertical from "../assets/icons/more-vertical.svg";
import printer from "../assets/icons/printer.svg";
import settings from "../assets/icons/settings.svg";
import upload from "../assets/icons/upload.svg";

// Marken-SVGs (eigener Blau→Grün-Verlauf). Als <img> eingebunden, damit die
// gleichlautende Gradient-ID nicht zwischen mehreren Inline-SVGs kollidiert.
const ICONS = {
  "alert-triangle": alertTriangle,
  "bar-chart": barChart,
  calendar,
  clock,
  download,
  eye,
  "folder-open": folderOpen,
  info,
  lock,
  "more-vertical": moreVertical,
  printer,
  settings,
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
