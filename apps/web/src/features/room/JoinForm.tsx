import { useState, type FormEvent } from "react";
import { RoomId } from "@vc/shared";

interface Props {
  initialRoom: string;
  joining: boolean;
  error: string | null;
  onJoin: (roomId: string) => void;
}

export function JoinForm({ initialRoom, joining, error, onJoin }: Props) {
  const [room, setRoom] = useState(initialRoom);
  const [fieldError, setFieldError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = RoomId.safeParse(room.trim());
    if (!parsed.success) return setFieldError(parsed.error.issues[0]?.message ?? "Enter a room name");
    setFieldError(null);
    onJoin(parsed.data);
  }

  const message = fieldError ?? error;

  return (
    <form className="card join" onSubmit={submit}>
      <h2>Join a room</h2>
      <p>Share the room name or invite link so others can join you.</p>

      <label className="field">
        <span>Room name</span>
        <input value={room} onChange={(e) => setRoom(e.target.value)} maxLength={64} spellCheck={false} />
      </label>

      <p className="form-error" role="alert" hidden={!message}>
        {message}
      </p>
      <button className="primary" type="submit" disabled={joining}>
        {joining ? "Joining…" : "Join room"}
      </button>
    </form>
  );
}
