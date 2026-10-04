import type { SVGProps } from "react";

const base: SVGProps<SVGSVGElement> = {
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
};

export const MicIcon = () => (
  <svg {...base}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
);
export const MicOffIcon = () => (
  <svg {...base}>
    <path d="M9 9v2a3 3 0 0 0 5.1 2.1M15 10.5V6a3 3 0 0 0-5.7-1.3" />
    <path d="M5 11a7 7 0 0 0 11.2 5.6M19 11a7 7 0 0 1-.6 2.8M12 18v3M3 3l18 18" />
  </svg>
);
export const CameraIcon = () => (
  <svg {...base}>
    <rect x="3" y="6" width="13" height="12" rx="3" />
    <path d="m16 10.5 5-3v9l-5-3" />
  </svg>
);
export const CameraOffIcon = () => (
  <svg {...base}>
    <path d="M7 6h6a3 3 0 0 1 3 3v3.5M16 15a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V9a3 3 0 0 1 1.2-2.4" />
    <path d="m16 10.5 5-3v9l-3.2-1.9M3 3l18 18" />
  </svg>
);
export const LeaveIcon = () => (
  <svg {...base}>
    <path d="M4 14.5c4.5-4 11.5-4 16 0l-2 2.5-3-1.5v-2.2a11 11 0 0 0-6 0v2.2L6 17z" />
  </svg>
);
export const ScreenShareIcon = () => (
  <svg {...base}>
    <rect x="3" y="4" width="18" height="12" rx="2.5" />
    <path d="M8 20h8M12 16v4M9.5 11l2.5-2.5 2.5 2.5M12 8.5V13" />
  </svg>
);
export const BoardIcon = () => (
  <svg {...base}>
    <rect x="3" y="4" width="18" height="13" rx="2.5" />
    <path d="M7 13c2-4 3 1 5-2s3 0 5-3M9 21h6M12 17v4" />
  </svg>
);
export const PenIcon = () => (
  <svg {...base}>
    <path d="M4 20l1-4L16.5 4.5a2 2 0 0 1 3 3L8 19z" />
    <path d="m14.5 6.5 3 3" />
  </svg>
);
export const EraserIcon = () => (
  <svg {...base}>
    <path d="M9 20h10M5.5 14.5l8-8a2 2 0 0 1 3 0l2.5 2.5a2 2 0 0 1 0 3L11 20H8l-2.5-2.5a2 2 0 0 1 0-3z" />
  </svg>
);
export const UndoIcon = () => (
  <svg {...base}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
  </svg>
);
export const RedoIcon = () => (
  <svg {...base}>
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9H10a6 6 0 0 0 0 12h3" />
  </svg>
);
export const TrashIcon = () => (
  <svg {...base}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
  </svg>
);
export const PaperclipIcon = () => (
  <svg {...base}>
    <path d="m20 11-8.6 8.6a5 5 0 0 1-7.1-7.1l9-9a3.3 3.3 0 0 1 4.7 4.7l-9 9a1.7 1.7 0 0 1-2.4-2.4L14.5 6" />
  </svg>
);
export const DownloadIcon = () => (
  <svg {...base}>
    <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 20h14" />
  </svg>
);
export const CloseIcon = () => (
  <svg {...base}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);
export const FileIcon = () => (
  <svg {...base}>
    <path d="M7 3h6.5L19 8.5V19a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
    <path d="M13 3v6h6" />
  </svg>
);
