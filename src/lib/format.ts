import type { RiskLevel } from "@/types";

/** Format bytes to human-readable string */
export function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = bytes / Math.pow(k, i);
  return `${value.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

/** Format a unix timestamp to a readable date */
export function formatDate(timestamp: number): string {
  if (timestamp === 0) return "—";
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString("vi-VN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Format number with thousand separators */
export function formatNumber(num: number): string {
  return num.toLocaleString("vi-VN");
}

/** Get the file extension from a filename */
export function getExtension(filename: string): string {
  const idx = filename.lastIndexOf(".");
  if (idx <= 0) return "";
  return filename.substring(idx + 1).toLowerCase();
}

/** Get risk level badge variant */
export function getRiskVariant(
  level: RiskLevel
): "default" | "destructive" | "outline" | "secondary" {
  switch (level) {
    case "safe":
      return "default";
    case "caution":
      return "secondary";
    case "dangerous":
      return "destructive";
    default:
      return "outline";
  }
}

/** Get risk level display text */
export function getRiskLabel(
  level: RiskLevel,
  t: any
): string {
  switch (level) {
    case "safe":
      return `🟢 ${t("disk.safe", "An toàn")}`;
    case "caution":
      return `🟡 ${t("disk.caution", "Cảnh báo")}`;
    case "dangerous":
      return `🔴 ${t("disk.dangerous", "Nguy hiểm")}`;
    default:
      return `⚪ ${t("disk.unknown", "Chưa phân loại")}`;
  }
}

/** Get risk level CSS class */
export function getRiskClass(level: RiskLevel): string {
  switch (level) {
    case "safe":
      return "risk-safe";
    case "caution":
      return "risk-caution";
    case "dangerous":
      return "risk-dangerous";
    default:
      return "risk-unknown";
  }
}

/** Get file type icon name (lucide-react) */
export function getFileTypeIcon(extension: string): string {
  const iconMap: Record<string, string> = {
    // Documents
    pdf: "file-text",
    doc: "file-text",
    docx: "file-text",
    txt: "file-text",
    md: "file-text",
    // Images
    jpg: "image",
    jpeg: "image",
    png: "image",
    gif: "image",
    svg: "image",
    webp: "image",
    // Videos
    mp4: "video",
    mkv: "video",
    avi: "video",
    mov: "video",
    // Audio
    mp3: "music",
    wav: "music",
    flac: "music",
    // Archives
    zip: "archive",
    rar: "archive",
    "7z": "archive",
    tar: "archive",
    gz: "archive",
    // Code
    js: "file-code",
    ts: "file-code",
    tsx: "file-code",
    jsx: "file-code",
    py: "file-code",
    rs: "file-code",
    cpp: "file-code",
    c: "file-code",
    // Data
    json: "file-json",
    xml: "file-code",
    csv: "table",
    // System
    exe: "cog",
    msi: "cog",
    dll: "cog",
    sys: "cog",
    // Disk images
    iso: "disc",
    vhd: "disc",
    vhdx: "disc",
  };

  return iconMap[extension] || "file";
}

/** Treemap color palette */
export const TREEMAP_COLORS = [
  "oklch(0.65 0.18 250)", // Blue
  "oklch(0.70 0.16 180)", // Teal
  "oklch(0.68 0.17 145)", // Green
  "oklch(0.72 0.15 80)",  // Yellow-Green
  "oklch(0.70 0.18 55)",  // Orange
  "oklch(0.65 0.20 25)",  // Red
  "oklch(0.62 0.22 310)", // Purple
  "oklch(0.68 0.15 290)", // Violet
  "oklch(0.60 0.16 220)", // Deep Blue
  "oklch(0.72 0.12 130)", // Light Green
];

/** Get a deterministic color for a treemap node based on index */
export function getTreemapColor(index: number): string {
  return TREEMAP_COLORS[index % TREEMAP_COLORS.length];
}

/** Calculate size percentage relative to parent */
export function sizePercent(size: number, total: number): number {
  if (total === 0) return 0;
  return (size / total) * 100;
}
