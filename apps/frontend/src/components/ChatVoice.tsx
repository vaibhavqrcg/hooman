import { useState, useRef, useCallback, useEffect } from "react";
import { Mic, X, Check, Loader2 } from "lucide-react";
import { getRealtimeClientSecret } from "../api";
import { Button } from "./Button";

export interface VoiceState {
  active: boolean;
  transcript: string;
  segment: string;
  error: string | null;
  connecting: boolean;
}

export function useVoice(onConfirm: (text: string) => void) {
  const [voiceActive, setVoiceActive] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [voiceSegment, setVoiceSegment] = useState("");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceConnecting, setVoiceConnecting] = useState(false);
  const voicePcRef = useRef<RTCPeerConnection | null>(null);
  const voiceStreamRef = useRef<MediaStream | null>(null);

  const endSession = useCallback(() => {
    voiceStreamRef.current?.getTracks().forEach((t) => t.stop());
    voiceStreamRef.current = null;
    voicePcRef.current?.close();
    voicePcRef.current = null;
  }, []);

  const cancel = useCallback(() => {
    endSession();
    setVoiceActive(false);
    setVoiceTranscript("");
    setVoiceSegment("");
    setVoiceError(null);
  }, [endSession]);

  const confirm = useCallback(() => {
    const full = [voiceTranscript, voiceSegment]
      .filter(Boolean)
      .join(" ")
      .trim();
    endSession();
    setVoiceActive(false);
    setVoiceTranscript("");
    setVoiceSegment("");
    setVoiceError(null);
    if (full) onConfirm(full);
  }, [voiceTranscript, voiceSegment, endSession, onConfirm]);

  const start = useCallback(async () => {
    setVoiceError(null);
    setVoiceTranscript("");
    setVoiceConnecting(true);
    try {
      const { value: ephemeralKey } = await getRealtimeClientSecret();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      voiceStreamRef.current = stream;
      const pc = new RTCPeerConnection();
      voicePcRef.current = pc;
      const dc = pc.createDataChannel("oai-events");
      pc.addTrack(stream.getTracks()[0], stream);
      dc.addEventListener("message", (e) => {
        try {
          const event = JSON.parse(e.data) as {
            type?: string;
            delta?: string;
            transcript?: string;
          };
          if (
            event.type ===
              "conversation.item.input_audio_transcription.delta" &&
            event.delta
          )
            setVoiceSegment((prev) => prev + event.delta);
          if (
            event.type ===
              "conversation.item.input_audio_transcription.completed" &&
            event.transcript != null
          ) {
            const final = String(event.transcript).trim();
            if (final)
              setVoiceTranscript((prev) => (prev ? `${prev} ${final}` : final));
            setVoiceSegment("");
          }
        } catch {
          // ignore parse errors
        }
      });
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const sdpResponse = await fetch(
        "https://api.openai.com/v1/realtime/calls",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${ephemeralKey}`,
            "Content-Type": "application/sdp",
          },
          body: offer.sdp ?? "",
        },
      );
      if (!sdpResponse.ok) {
        const err = await sdpResponse.text();
        throw new Error(err || "Realtime session failed");
      }
      const answerSdp = await sdpResponse.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
      setVoiceActive(true);
    } catch (err) {
      setVoiceError((err as Error).message || "Could not start voice input");
      endSession();
    } finally {
      setVoiceConnecting(false);
    }
  }, [endSession]);

  useEffect(() => {
    return () => endSession();
  }, [endSession]);

  return {
    active: voiceActive,
    transcript: voiceTranscript,
    segment: voiceSegment,
    error: voiceError,
    connecting: voiceConnecting,
    start,
    cancel,
    confirm,
  };
}

export function VoiceBar({
  transcript,
  segment,
  onCancel,
  onConfirm,
}: {
  transcript: string;
  segment: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="mb-3 flex items-center gap-2 rounded-xl bg-hooman-surface border border-hooman-border px-3 py-2.5">
      <Mic className="w-4 h-4 shrink-0 text-hooman-muted" aria-hidden />
      <span className="flex-1 min-w-0 truncate text-sm text-zinc-200">
        {[transcript, segment].filter(Boolean).join(" ") || (
          <span className="text-hooman-muted">Listening…</span>
        )}
      </span>
      <Button
        variant="danger"
        iconOnly
        size="icon"
        icon={<X className="w-4 h-4" />}
        onClick={onCancel}
        title="Cancel"
        aria-label="Cancel"
        className="shrink-0"
      />
      <Button
        variant="success"
        iconOnly
        size="icon"
        icon={<Check className="w-4 h-4" />}
        onClick={onConfirm}
        title="Use as prompt"
        aria-label="Use as prompt"
        className="shrink-0"
      />
    </div>
  );
}

export function VoiceButton({
  connecting,
  active,
  onStart,
}: {
  connecting: boolean;
  active: boolean;
  onStart: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onStart}
      disabled={connecting || active}
      title="Speak (voice input)"
      aria-label="Speak"
      className="absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 md:w-9 md:h-9 rounded-full flex items-center justify-center bg-hooman-surface text-hooman-muted hover:text-zinc-200 hover:bg-hooman-surface/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {connecting ? (
        <Loader2
          className="w-4 h-4 md:w-5 md:h-5 shrink-0 animate-spin"
          aria-hidden
        />
      ) : (
        <Mic className="w-4 h-4 md:w-5 md:h-5 shrink-0" aria-hidden />
      )}
    </button>
  );
}
