import type { ReactNode } from "react";
import { CameraIcon, CameraOffIcon, LeaveIcon, MicIcon, MicOffIcon, ScreenShareIcon, BoardIcon, PaperclipIcon } from "../../ui/icons";

interface Props {
  micOn: boolean;
  camOn: boolean;
  onToggleMic: () => void;
  onToggleCam: () => void;
  onLeave: () => void;
  /** Shown only in a room, and only where the browser can capture a screen. */
  canShare?: boolean;
  sharing?: boolean;
  onToggleShare?: () => void;
  canBoard?: boolean;
  boardOpen?: boolean;
  /** Someone drew while the board was closed. */
  boardBadge?: boolean;
  onToggleBoard?: () => void;
  canFiles?: boolean;
  filesOpen?: boolean;
  /** Someone shared a file while the panel was closed. */
  filesBadge?: boolean;
  onToggleFiles?: () => void;
}

function RoundButton(props: {
  label: string;
  active?: boolean;
  highlighted?: boolean;
  badge?: boolean;
  danger?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`round ${props.danger ? "danger" : ""}`}
      data-off={props.active === false}
      data-active={props.highlighted}
      aria-pressed={props.highlighted}
      aria-label={props.label}
      title={props.label}
      onClick={props.onClick}
    >
      {props.children}
      {props.badge && <span className="dot" aria-hidden="true" />}
    </button>
  );
}

export function ControlBar({ micOn, camOn, onToggleMic, onToggleCam, onLeave, canShare, sharing, onToggleShare, canBoard, boardOpen, boardBadge, onToggleBoard, canFiles, filesOpen, filesBadge, onToggleFiles }: Props) {
  return (
    <div className="control-bar" role="toolbar" aria-label="Call controls">
      <RoundButton label={micOn ? "Mute microphone" : "Unmute microphone"} active={micOn} onClick={onToggleMic}>
        {micOn ? <MicIcon /> : <MicOffIcon />}
      </RoundButton>
      <RoundButton label={camOn ? "Turn camera off" : "Turn camera on"} active={camOn} onClick={onToggleCam}>
        {camOn ? <CameraIcon /> : <CameraOffIcon />}
      </RoundButton>
      {canShare && (
        <RoundButton
          label={sharing ? "Stop sharing your screen" : "Share your screen"}
          highlighted={sharing}
          onClick={() => onToggleShare?.()}
        >
          <ScreenShareIcon />
        </RoundButton>
      )}
      {canBoard && (
        <RoundButton
          label={boardOpen ? "Close the whiteboard" : "Open the whiteboard"}
          highlighted={boardOpen}
          badge={boardBadge}
          onClick={() => onToggleBoard?.()}
        >
          <BoardIcon />
        </RoundButton>
      )}
      {canFiles && (
        <RoundButton
          label={filesOpen ? "Close shared files" : "Open shared files"}
          highlighted={filesOpen}
          badge={filesBadge}
          onClick={() => onToggleFiles?.()}
        >
          <PaperclipIcon />
        </RoundButton>
      )}
      <RoundButton label="Leave call" danger onClick={onLeave}>
        <LeaveIcon />
      </RoundButton>
    </div>
  );
}
