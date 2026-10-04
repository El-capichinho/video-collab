import { useEffect, useState, type CSSProperties } from "react";
import { AuthForm } from "./features/auth/AuthForm";
import { authClient } from "./features/auth/authClient";
import { useAuth } from "./features/auth/useAuth";
import { ControlBar } from "./features/call/ControlBar";
import { gridColumns } from "./features/call/layout";
import { useActiveSpeaker } from "./features/call/useActiveSpeaker";
import { VideoTile } from "./features/call/VideoTile";
import { useLocalMedia } from "./features/call/useLocalMedia";
import { WhiteboardPanel } from "./features/board/WhiteboardPanel";
import { FilesPanel } from "./features/files/FilesPanel";
import { useFileShelf } from "./features/files/useFileShelf";
import { useWhiteboard } from "./features/board/useWhiteboard";
import { JoinForm } from "./features/room/JoinForm";
import { useRoom } from "./features/room/useRoom";

function connectionNote(state: RTCPeerConnectionState): string | undefined {
  if (state === "connected") return undefined;
  if (state === "disconnected") return "Reconnecting…";
  if (state === "failed") return "Couldn't connect";
  return "Connecting…";
}

function suggestRoom(): string {
  return new URLSearchParams(window.location.search).get("room") ?? crypto.randomUUID().slice(0, 8);
}

export function App() {
  const auth = useAuth();
  const media = useLocalMedia();
  const { board, snapshot: boardState } = useWhiteboard();
  const { shelf, snapshot: shelfState } = useFileShelf(authClient.getAccessToken);
  const room = useRoom(media.stream, authClient.getAccessToken, { micOn: media.micOn, camOn: media.camOn }, {
    board,
    files: shelf,
  });
  const [filesOpen, setFilesOpen] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const [seenActivity, setSeenActivity] = useState(0);
  const [initialRoom] = useState(suggestRoom);
  const [copied, setCopied] = useState(false);

  const live = media.status === "live";
  const joined = room.status === "joined";
  const inCall = joined && room.peers.length > 0;
  const speaker = useActiveSpeaker(
    inCall
      ? [
          { id: "local", stream: media.stream, enabled: media.micOn },
          ...room.peers.map((p) => ({ id: p.id, stream: p.stream, enabled: p.micOn })),
        ]
      : [],
  );
  const participantCount = 1 + room.peers.length;

  // The board closes with the call; a badge shows if others draw while it's closed.
  useEffect(() => {
    if (!joined) setBoardOpen(false);
  }, [joined]);
  useEffect(() => {
    if (boardOpen) setSeenActivity(boardState.remoteActivity);
  }, [boardOpen, boardState.remoteActivity]);
  const boardBadge = !boardOpen && boardState.remoteActivity > seenActivity;

  // Same for the files panel: it closes with the call, and a badge shows new files from others.
  useEffect(() => {
    if (!joined) setFilesOpen(false);
  }, [joined]);
  useEffect(() => {
    if (filesOpen && shelfState.unseen > 0) shelf.markSeen();
  }, [filesOpen, shelfState.unseen, shelf]);
  const filesBadge = !filesOpen && shelfState.unseen > 0;

  const presenter = room.peers.find((p) => p.screenStream) ?? null;

  useEffect(() => {
    if (!room.notice) return;
    const timer = setTimeout(room.clearNotice, 5000);
    return () => clearTimeout(timer);
  }, [room.notice, room.clearNotice]);

  const tiles = [
    <VideoTile
      key="local"
      stream={media.stream}
      label={auth.user?.displayName ?? "You"}
      camOn={media.camOn}
      micOn={media.micOn}
      mirrored
      muted
      speaking={speaker === "local"}
    />,
    ...room.peers.map((peer) => (
      <VideoTile
        key={peer.id}
        stream={peer.stream}
        label={peer.displayName}
        camOn={peer.camOn}
        micOn={peer.micOn}
        note={connectionNote(peer.state)}
        speaking={speaker === peer.id}
      />
    )),
  ];
  const signedIn = auth.status === "signed-in" && auth.user !== null;

  async function signOut() {
    room.leave();
    media.stop();
    await auth.signOut();
  }

  async function copyInvite() {
    const link = `${window.location.origin}${window.location.pathname}?room=${room.roomId}`;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const subtitle = !signedIn
    ? "Sign in to start"
    : joined
      ? `Room ${room.roomId}`
      : live
        ? "Camera preview"
        : "Check your camera and microphone";

  return (
    <div className="shell">
      <header className="topbar">
        <h1>Video Collab</h1>
        <p>{subtitle}</p>
        {signedIn && (
          <div className="account">
            <span>{auth.user?.displayName}</span>
            <button className="link-button" onClick={signOut}>Sign out</button>
          </div>
        )}
      </header>

      <main className="stage">
        {auth.status === "loading" && (
          <p className="loading" role="status">Checking your session…</p>
        )}

        {auth.status === "signed-out" && (
          <AuthForm busy={auth.busy} error={auth.error} onSignIn={auth.signIn} onSignUp={auth.signUp} />
        )}

        {signedIn && live && (
          <div className="stack">
            {room.localScreen && (
              <div className="share-banner" role="status">
                <span>You're sharing your screen</span>
                <button className="secondary" onClick={room.stopShare}>Stop sharing</button>
              </div>
            )}

            {boardOpen && joined ? (
              <div className="spotlight">
                <WhiteboardPanel board={board} snapshot={boardState} />
                <div className="strip">{tiles}</div>
              </div>
            ) : presenter?.screenStream ? (
              <div className="spotlight">
                <VideoTile
                  stream={presenter.screenStream}
                  label={`${presenter.displayName}'s screen`}
                  camOn
                  micOn
                  muted
                  fit="contain"
                />
                <div className="strip">{tiles}</div>
              </div>
            ) : (
              <div
                className="grid"
                data-count={participantCount}
                style={{ "--cols": gridColumns(participantCount) } as CSSProperties}
              >
                {tiles}
              </div>
            )}

            {room.notice && (
              <p className="notice" role="status">{room.notice}</p>
            )}

            {joined ? (
              <div className="call-actions">
                <span className="status" data-state="connected" role="status">
                  {room.peers.length + 1} in room
                </span>
                <button className="secondary" onClick={copyInvite}>
                  {copied ? "Link copied" : "Copy invite link"}
                </button>
              </div>
            ) : (
              <JoinForm
                initialRoom={initialRoom}
                joining={room.status === "joining"}
                error={room.error}
                onJoin={room.join}
              />
            )}
          </div>
        )}

        {signedIn && !live && (
          <section className="card" aria-live="polite">
            {media.status === "failed" && media.error ? (
              <>
                <h2>{media.error.title}</h2>
                <p>{media.error.hint}</p>
                <button className="primary" onClick={media.start}>Try again</button>
              </>
            ) : (
              <>
                <h2>Ready when you are</h2>
                <p>Turn on your camera and microphone to see how you'll appear to others.</p>
                <button className="primary" onClick={media.start} disabled={media.status === "requesting"}>
                  {media.status === "requesting" ? "Waiting for permission…" : "Turn on camera"}
                </button>
              </>
            )}
          </section>
        )}
      </main>

      {signedIn && joined && filesOpen && (
        <FilesPanel
          shelf={shelf}
          snapshot={shelfState}
          selfId={auth.user?.id ?? null}
          onClose={() => setFilesOpen(false)}
        />
      )}

      {signedIn && live && (
        <ControlBar
          micOn={media.micOn}
          camOn={media.camOn}
          onToggleMic={media.toggleMic}
          onToggleCam={media.toggleCam}
          onLeave={joined ? room.leave : media.stop}
          canShare={joined && room.canShare}
          sharing={room.localScreen !== null}
          onToggleShare={room.localScreen ? room.stopShare : room.startShare}
          canBoard={joined}
          boardOpen={boardOpen}
          boardBadge={boardBadge}
          onToggleBoard={() => setBoardOpen((open) => !open)}
          canFiles={joined}
          filesOpen={filesOpen}
          filesBadge={filesBadge}
          onToggleFiles={() => setFilesOpen((open) => !open)}
        />
      )}
    </div>
  );
}
