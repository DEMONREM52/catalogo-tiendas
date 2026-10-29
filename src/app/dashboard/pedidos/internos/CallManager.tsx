"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronUp, Maximize2, Mic, MicOff, Minimize2, Phone, PhoneOff, RefreshCw, Video, VideoOff, Volume1, Volume2 } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { inOneTab } from "@/lib/sounds/one-tab";

/**
 * Llamadas y videollamadas de los pedidos internos (20261268). La voz y el video van directo entre los equipos
 * (WebRTC); la base solo conecta (oferta y respuesta) y avisa en vivo. Si quien recibe no tiene RemHub abierta,
 * le llega la notificación de llamada con «Contestar» (api/push/call).
 */

export const START_CALL_EVENT = "remhub:start-call";
/** Llamar al otro punto de un pedido interno (lo usa el botón 📞 / 🎥 del pedido). */
type CallTarget = { requestId?: string; threadId?: string; video: boolean; to?: string[] };
export function startCall(requestId: string, video: boolean, to?: string[]) {
  window.dispatchEvent(new CustomEvent<CallTarget>(START_CALL_EVENT, { detail: { requestId, video, to } }));
}
/** Llamar desde un chat del equipo (20261271): a los demás del chat o a los escogidos. */
export function startChatCall(threadId: string, video: boolean, to?: string[]) {
  window.dispatchEvent(new CustomEvent<CallTarget>(START_CALL_EVENT, { detail: { threadId, video, to } }));
}

type CallRow = { id: string; store_id: string; request_id: string | null; caller_id: string; caller_name: string | null; video: boolean; status: string; offer: RTCSessionDescriptionInit | null; answer: RTCSessionDescriptionInit | null; answered_name: string | null };
type Phase = "idle" | "outgoing" | "incoming" | "connecting" | "active" | "ended";
type Channel = ReturnType<ReturnType<typeof supabaseBrowser>["channel"]>;

const RING_SECONDS = 45;
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

async function iceServers(): Promise<RTCIceServer[]> {
  try {
    const { data } = await supabaseBrowser().auth.getSession();
    const res = await fetch("/api/calls/ice", { headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` }, cache: "no-store" });
    const j = (await res.json()) as { iceServers?: RTCIceServer[] };
    if (j.iceServers?.length) return j.iceServers;
  } catch { /* se usa el STUN público */ }
  return [{ urls: ["stun:stun.l.google.com:19302"] }];
}

/** Espera a tener los caminos de conexión (máx. 2,5 s): así no hace falta ir y volver por cada candidato. */
function gathered(pc: RTCPeerConnection, ms = 2500) {
  return new Promise<void>((resolve) => {
    if (pc.iceGatheringState === "complete") return resolve();
    const t = window.setTimeout(resolve, ms);
    pc.addEventListener("icegatheringstatechange", () => { if (pc.iceGatheringState === "complete") { window.clearTimeout(t); resolve(); } });
  });
}

/** Timbre generado (no necesita archivos): «ring ring» para quien recibe y tono de espera para quien llama. */
function useRingtone() {
  const ctx = useRef<AudioContext | null>(null);
  const timer = useRef(0);
  const stop = useCallback(() => {
    window.clearInterval(timer.current);
    timer.current = 0;
    void ctx.current?.close().catch(() => undefined);
    ctx.current = null;
    navigator.vibrate?.(0);
  }, []);
  const start = useCallback((kind: "incoming" | "outgoing") => {
    stop();
    try {
      const ac = new AudioContext();
      ctx.current = ac;
      const beep = (f1: number, f2: number, dur: number, at: number, vol: number) => {
        for (const f of [f1, f2]) {
          const o = ac.createOscillator(), g = ac.createGain();
          o.frequency.value = f;
          g.gain.setValueAtTime(0, ac.currentTime + at);
          g.gain.linearRampToValueAtTime(vol, ac.currentTime + at + 0.03);
          g.gain.setValueAtTime(vol, ac.currentTime + at + dur - 0.05);
          g.gain.linearRampToValueAtTime(0, ac.currentTime + at + dur);
          o.connect(g).connect(ac.destination);
          o.start(ac.currentTime + at);
          o.stop(ac.currentTime + at + dur + 0.05);
        }
      };
      const ring = () => {
        if (kind === "incoming") { beep(880, 988, 0.35, 0, 0.12); beep(880, 988, 0.35, 0.5, 0.12); navigator.vibrate?.([400, 200, 400]); }
        else beep(425, 440, 1.0, 0, 0.05);
      };
      ring();
      timer.current = window.setInterval(ring, kind === "incoming" ? 2500 : 4000);
    } catch { /* sin audio: queda la vibración y la pantalla */ }
  }, [stop]);
  useEffect(() => stop, [stop]);
  return { start, stop };
}

export function CallManager({ storeId }: { storeId: string }) {
  const [me, setMe] = useState<string | null>(null);
  const [call, setCall] = useState<CallRow | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [note, setNote] = useState("");
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [mini, setMini] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [hasRemoteVideo, setHasRemoteVideo] = useState(false);
  // Altavoz o normal. Donde el navegador deja escoger la salida (computador, Android con Chrome) se cambia de verdad;
  // donde no (iPhone), «normal» baja el volumen de la llamada.
  const [speaker, setSpeaker] = useState(false);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [outputId, setOutputId] = useState<string | null>(null);
  const [showOutputs, setShowOutputs] = useState(false);
  const outputsRef = useRef<MediaDeviceInfo[]>([]);
  const pc = useRef<RTCPeerConnection | null>(null);
  const local = useRef<MediaStream | null>(null);
  const channel = useRef<Channel | null>(null);
  const ringTimeout = useRef(0);
  // Cada llamada tiene su número; colgar o terminar lo cambia y así la preparación que siga en curso se detiene.
  const attempt = useRef(0);
  const tick = useRef(0);
  const facing = useRef<"user" | "environment">("user");
  const callRef = useRef<CallRow | null>(null);
  const phaseRef = useRef<Phase>("idle");
  const localVideo = useRef<HTMLVideoElement>(null);
  const remoteVideo = useRef<HTMLVideoElement>(null);
  const remoteAudio = useRef<HTMLAudioElement>(null);
  const remote = useRef<MediaStream | null>(null);
  const ring = useRingtone();

  const go = useCallback((p: Phase) => { phaseRef.current = p; setPhase(p); }, []);
  const setCallBoth = useCallback((c: CallRow | null) => { callRef.current = c; setCall(c); }, []);

  useEffect(() => { void supabaseBrowser().auth.getUser().then(({ data }) => setMe(data.user?.id ?? null)); }, []);

  /** Limpia todo y muestra cómo terminó (2,5 s). */
  const finish = useCallback((text: string) => {
    attempt.current += 1;
    ring.stop();
    window.clearTimeout(ringTimeout.current);
    window.clearInterval(tick.current);
    local.current?.getTracks().forEach((t) => t.stop());
    local.current = null;
    pc.current?.close();
    pc.current = null;
    remote.current = null;
    if (channel.current) void supabaseBrowser().removeChannel(channel.current);
    channel.current = null;
    setNote(text);
    go("ended");
    setMini(false);
    window.setTimeout(() => { if (phaseRef.current === "ended") { go("idle"); setCallBoth(null); setElapsed(0); setMuted(false); setCamOff(false); setHasRemoteVideo(false); setSpeaker(false); setOutputId(null); setShowOutputs(false); } }, 2500);
  }, [go, ring, setCallBoth]);

  const endCall = useCallback(async (reason: string, text: string) => {
    const c = callRef.current;
    const wasRinging = phaseRef.current === "outgoing";
    finish(text);
    if (!c) return;
    await supabaseBrowser().rpc("erp_call_end", { p_call: c.id, p_reason: reason });
    // Si timbraba en celulares, se cambia la notificación por «Llamada perdida» (sin «Contestar»).
    if (wasRinging && c.caller_id === me) {
      const { data: s } = await supabaseBrowser().auth.getSession();
      void fetch("/api/push/call", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.session?.access_token ?? ""}` }, body: JSON.stringify({ call_id: c.id, ended: true }) });
    }
  }, [finish, me]);

  /** Altavoz (true) o normal (false); o una salida concreta (Bluetooth, audífonos…). */
  const applyOutput = useCallback(async (on: boolean, deviceId?: string) => {
    const el = remoteAudio.current;
    if (!el) return;
    // Safari y algunos navegadores de celular no tienen setSinkId (no dejan escoger la salida).
    const canPick = typeof (el as { setSinkId?: unknown }).setSinkId === "function";
    let id = deviceId;
    if (!id && canPick) {
      const list = outputsRef.current;
      const pick = list.find((d) => (on ? /speaker|altavoz|bocina|parlante/i : /earpiece|auricular|receiver|handset/i).test(d.label));
      id = pick?.deviceId ?? (on ? "default" : undefined);
    }
    if (id && canPick) {
      try { await el.setSinkId(id); setOutputId(id); } catch { /* el navegador no dejó cambiar la salida */ }
    }
    // Sin poder cambiar la salida, «normal» es más bajo (para tenerlo cerca del oído).
    el.volume = on || deviceId ? 1 : 0.5;
    setSpeaker(on);
  }, []);

  /** Salidas de audio del equipo (con permiso de micrófono ya tienen nombre). */
  const loadOutputs = useCallback(async () => {
    try {
      const list = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audiooutput" && d.deviceId);
      outputsRef.current = list;
      setOutputs(list);
    } catch { /* sin lista */ }
  }, []);

  /** Conexión WebRTC con el audio/video de este equipo. */
  const setup = useCallback(async (video: boolean) => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: video ? { facingMode: facing.current, width: { ideal: 1280 }, height: { ideal: 720 } } : false,
    });
    local.current = stream;
    void loadOutputs();
    if (localVideo.current) localVideo.current.srcObject = stream;
    const conn = new RTCPeerConnection({ iceServers: await iceServers() });
    stream.getTracks().forEach((t) => conn.addTrack(t, stream));
    conn.ontrack = (e) => {
      const s = e.streams[0] ?? new MediaStream([e.track]);
      remote.current = s;
      if (remoteVideo.current) remoteVideo.current.srcObject = s;
      if (remoteAudio.current) { remoteAudio.current.srcObject = s; void remoteAudio.current.play().catch(() => undefined); }
      // Como en el celular: la videollamada empieza en altavoz y la de voz en normal.
      if (e.track.kind === "audio") void applyOutput(Boolean(callRef.current?.video));
      if (e.track.kind === "video") setHasRemoteVideo(true);
    };
    conn.onconnectionstatechange = () => {
      if (conn.connectionState === "connected" && phaseRef.current !== "active") {
        ring.stop();
        go("active");
        const t0 = Date.now();
        window.clearInterval(tick.current);
        tick.current = window.setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
      }
      if (conn.connectionState === "failed") void endCall("sin conexión", phaseRef.current === "active" ? "Se cortó la llamada" : "No se pudo conectar. Revisa el internet de los dos equipos.");
      // El otro equipo se fue (colgó o perdió la señal): si en 8 s no vuelve, se cuelga.
      if (conn.connectionState === "disconnected") {
        window.setTimeout(() => {
          if (pc.current === conn && (conn.connectionState === "disconnected" || conn.connectionState === "failed")) void endCall("se cortó", "Se cortó la llamada");
        }, 8000);
      }
    };
    pc.current = conn;
    return conn;
  }, [applyOutput, endCall, go, loadOutputs, ring]);

  /** Escucha en vivo los cambios de esta llamada (contestó, colgó, rechazó…). */
  /** Aplica el estado de la llamada (llegue en vivo o por la revisión cada 3 s). */
  const onRow = useCallback((row: CallRow) => {
        const prev = callRef.current;
        if (!prev || prev.id !== row.id) return;
        setCallBoth({ ...prev, ...row });
        if (row.status === "active" && row.answer && pc.current && !pc.current.currentRemoteDescription && prev?.caller_id === me) {
          ring.stop();
          go("connecting");
          void pc.current.setRemoteDescription(row.answer);
        }
        if (row.status === "active" && phaseRef.current === "incoming") finish("Otra persona contestó");
        if (["ended", "missed", "declined"].includes(row.status) && phaseRef.current !== "ended" && phaseRef.current !== "idle") {
          finish(row.status === "declined" ? "Llamada rechazada" : row.status === "missed" ? (prev?.caller_id === me ? "No contestaron" : "Llamada perdida") : "Llamada terminada");
        }
  }, [finish, go, me, ring, setCallBoth]);

  /** Escucha en vivo los cambios de esta llamada (contestó, colgó, rechazó…). */
  const watch = useCallback((id: string) => {
    const ch = supabaseBrowser()
      .channel(`call-${id}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "erp_calls", filter: `id=eq.${id}` }, (msg) => onRow(msg.new as CallRow))
      .subscribe();
    channel.current = ch;
  }, [onRow]);

  // Respaldo del aviso en vivo: cada 3 s se revisa la llamada en la base (nadie se queda en una llamada que ya terminó).
  const liveId = call?.id ?? null;
  const inCall = phase === "outgoing" || phase === "incoming" || phase === "connecting" || phase === "active";
  useEffect(() => {
    if (!liveId || !inCall) return;
    const t = window.setInterval(() => {
      void supabaseBrowser().from("erp_calls").select("id,store_id,request_id,caller_id,caller_name,video,status,offer,answer,answered_name").eq("id", liveId).maybeSingle()
        .then(({ data }) => { if (data) onRow(data as CallRow); });
    }, 3000);
    return () => window.clearInterval(t);
  }, [liveId, inCall, onRow]);

  /** Llamar. */
  const outgoing = useCallback(async ({ requestId, threadId, video, to }: CallTarget) => {
    if (phaseRef.current !== "idle") return;
    const mine = ++attempt.current;
    go("outgoing");
    setNote(video ? "Videollamada…" : "Llamando…");
    // ¿Colgó mientras se preparaba? Entonces se apaga lo que se alcanzó a abrir y no se sigue.
    const cancelled = (conn?: RTCPeerConnection) => {
      if (attempt.current === mine && phaseRef.current === "outgoing") return false;
      conn?.getSenders().forEach((x) => x.track?.stop());
      conn?.close();
      return true;
    };
    try {
      const conn = await setup(video);
      if (cancelled(conn)) return;
      const offer = await conn.createOffer();
      await conn.setLocalDescription(offer);
      await gathered(conn);
      if (cancelled(conn)) return;
      const sdp = conn.localDescription!;
      const p_offer = { type: sdp.type, sdp: sdp.sdp };
      const pick = to?.length ? { p_to: to } : {};
      const { data, error } = threadId
        ? await supabaseBrowser().rpc("erp_call_start_dm", { p_thread: threadId, p_video: video, p_offer, ...pick })
        : await supabaseBrowser().rpc("erp_call_start", { p_request: requestId, p_video: video, p_offer, ...pick });
      if (error) throw new Error(/Could not find the function|schema cache/i.test(error.message) ? `Falta ejecutar en Supabase la migración ${threadId || to?.length ? "20261271_mensajes_directos.sql" : "20261268_llamadas.sql"}.` : error.message);
      const res = data as { id: string };
      // Colgó justo mientras se creaba: se cierra sin timbrar a nadie.
      if (cancelled(conn)) { void supabaseBrowser().rpc("erp_call_end", { p_call: res.id, p_reason: "canceló" }); return; }
      setCallBoth({ id: res.id, store_id: storeId, request_id: requestId ?? null, caller_id: me ?? "", caller_name: null, video, status: "ringing", offer: null, answer: null, answered_name: null });
      watch(res.id);
      ring.start("outgoing");
      // Timbre en los celulares de quienes reciben, aunque tengan RemHub cerrada.
      const { data: s } = await supabaseBrowser().auth.getSession();
      void fetch("/api/push/call", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.session?.access_token ?? ""}` }, body: JSON.stringify({ call_id: res.id }) });
      ringTimeout.current = window.setTimeout(() => { if (phaseRef.current === "outgoing") void endCall("sin respuesta", "No contestaron"); }, RING_SECONDS * 1000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (attempt.current !== mine) return;
      finish(/Permission|NotAllowed/i.test(msg) ? "Permite el micrófono (y la cámara) para este sitio y vuelve a intentar." : msg || "No se pudo llamar.");
    }
  }, [endCall, finish, go, me, ring, setCallBoth, setup, storeId, watch]);

  /** Llega una llamada: se muestra y timbra. */
  const incoming = useCallback(async (id: string, autoAnswer = false) => {
    if (phaseRef.current !== "idle") return;
    const { data } = await supabaseBrowser().from("erp_calls").select("id,store_id,request_id,caller_id,caller_name,video,status,offer,answer,answered_name").eq("id", id).maybeSingle();
    const c = data as CallRow | null;
    if (!c || c.status !== "ringing" || c.caller_id === me) return;
    setCallBoth(c);
    go("incoming");
    watch(c.id);
    if (autoAnswer) void accept(c);
    // La pantalla de llamada sale en todas las pestañas, pero el timbre suena en una sola.
    else void inOneTab(`ring:${c.id}`, () => { if (phaseRef.current === "incoming") ring.start("incoming"); }, 60_000);
    // Respaldo: si no llega el aviso en vivo de que la cancelaron, deja de timbrar sola.
    const mine = attempt.current;
    window.clearTimeout(ringTimeout.current);
    ringTimeout.current = window.setTimeout(() => { if (attempt.current === mine && phaseRef.current === "incoming") finish("Llamada perdida"); }, (RING_SECONDS + 5) * 1000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [go, me, ring, setCallBoth, watch]);

  async function accept(c = callRef.current) {
    if (!c?.offer) return;
    ring.stop();
    go("connecting");
    setNote("Conectando…");
    try {
      const conn = await setup(c.video);
      await conn.setRemoteDescription(c.offer);
      const answer = await conn.createAnswer();
      await conn.setLocalDescription(answer);
      await gathered(conn);
      const sdp = conn.localDescription!;
      const { error } = await supabaseBrowser().rpc("erp_call_answer", { p_call: c.id, p_answer: { type: sdp.type, sdp: sdp.sdp } });
      if (error) throw new Error(error.message);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      finish(/Permission|NotAllowed/i.test(msg) ? "Permite el micrófono (y la cámara) para contestar." : msg || "No se pudo contestar.");
    }
  }

  async function decline() {
    ring.stop();
    await endCall("rechazó", "Rechazaste la llamada");
  }

  // Timbre en vivo: me invitan a una llamada.
  useEffect(() => {
    if (!me) return;
    const ch = supabaseBrowser()
      .channel(`call-invites-${me}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "erp_call_invites", filter: `user_id=eq.${me}` }, (msg) => {
        const row = msg.new as { call_id: string };
        void incoming(row.call_id);
      })
      .subscribe();
    return () => { void supabaseBrowser().removeChannel(ch); };
  }, [me, incoming]);

  // Abrió desde la notificación (…&llamada=<id>&contestar=1), botones de los pedidos y avisos del celular.
  useEffect(() => {
    if (!me) return;
    const q = new URLSearchParams(window.location.search);
    const id = q.get("llamada");
    if (id && /^[0-9a-f-]{36}$/i.test(id)) {
      void incoming(id, q.get("contestar") === "1");
      q.delete("llamada");
      q.delete("contestar");
      window.history.replaceState(null, "", `${window.location.pathname}${q.toString() ? `?${q}` : ""}`);
    }
    const onStart = (e: Event) => { void outgoing((e as CustomEvent<CallTarget>).detail); };
    const onSw = (e: MessageEvent) => {
      const m = e.data as { type?: string; id?: string; payload?: { call?: { id: string } } };
      if (m?.type === "REMHUB_CALL_DECLINE" && m.id && callRef.current?.id === m.id && phaseRef.current === "incoming") void decline();
      if (m?.type === "REMHUB_PUSH" && m.payload?.call?.id) void incoming(m.payload.call.id);
    };
    window.addEventListener(START_CALL_EVENT, onStart);
    navigator.serviceWorker?.addEventListener("message", onSw);
    return () => { window.removeEventListener(START_CALL_EVENT, onStart); navigator.serviceWorker?.removeEventListener("message", onSw); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, incoming, outgoing]);

  // Las ventanas de video se montan después: se les vuelve a poner su imagen.
  useEffect(() => {
    if (localVideo.current && local.current) localVideo.current.srcObject = local.current;
    if (remoteVideo.current && remote.current) remoteVideo.current.srcObject = remote.current;
  }, [phase, mini, hasRemoteVideo]);

  function toggleMute() {
    const v = !muted;
    local.current?.getAudioTracks().forEach((t) => (t.enabled = !v));
    setMuted(v);
  }
  function toggleCam() {
    const v = !camOff;
    local.current?.getVideoTracks().forEach((t) => (t.enabled = !v));
    setCamOff(v);
  }
  async function flipCam() {
    const conn = pc.current;
    if (!conn || !local.current) return;
    facing.current = facing.current === "user" ? "environment" : "user";
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing.current } });
      const track = s.getVideoTracks()[0];
      const sender = conn.getSenders().find((x) => x.track?.kind === "video");
      await sender?.replaceTrack(track);
      local.current.getVideoTracks().forEach((t) => { t.stop(); local.current?.removeTrack(t); });
      local.current.addTrack(track);
      if (localVideo.current) localVideo.current.srcObject = local.current;
    } catch { /* un solo lente */ }
  }

  if (phase === "idle" || typeof document === "undefined") return <audio ref={remoteAudio} autoPlay hidden />;
  const video = Boolean(call?.video);
  const who = call?.caller_id === me ? (call?.answered_name ?? "el otro punto") : (call?.caller_name ?? "Tu equipo");
  const status = phase === "incoming" ? (video ? "Videollamada entrante" : "Llamada entrante")
    : phase === "outgoing" ? (video ? "Videollamada · timbrando…" : "Llamando… timbrando")
    : phase === "connecting" ? "Conectando…"
    : phase === "active" ? clock(elapsed)
    : note;

  return createPortal(
    <>
      <audio ref={remoteAudio} autoPlay playsInline hidden />
      <AnimatePresence>
        {mini && phase === "active" ? (
          <motion.button key="mini" type="button" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} drag dragMomentum={false} onClick={() => setMini(false)}
            className="fixed bottom-24 right-4 z-[400] flex items-center gap-2 rounded-full bg-emerald-600 py-2 pl-2 pr-4 text-sm font-bold text-white shadow-2xl">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-white/20"><Phone size={16} /></span>
            {who} · {clock(elapsed)} <Maximize2 size={14} />
          </motion.button>
        ) : (
          <motion.div key="call" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[400] flex flex-col items-center justify-between overflow-hidden text-white"
            style={{ background: "radial-gradient(circle at 50% 20%, #3b1a66, #0b0716 70%)" }}>
            {/* video del otro (o su inicial) */}
            {video && hasRemoteVideo ? <video ref={remoteVideo} autoPlay playsInline muted className="absolute inset-0 h-full w-full object-cover" /> : null}
            {video && hasRemoteVideo ? <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-black/70" /> : null}

            <div className="relative z-10 mt-14 flex flex-col items-center px-6 text-center">
              {!(video && hasRemoteVideo) ? (
                <div className="relative mb-6 grid h-28 w-28 place-items-center">
                  {phase === "incoming" || phase === "outgoing" ? [0, 1, 2].map((i) => (
                    <motion.span key={i} className="absolute inset-0 rounded-full border-2 border-fuchsia-400/60" animate={{ scale: [1, 1.9], opacity: [0.7, 0] }} transition={{ repeat: Infinity, duration: 2.2, delay: i * 0.7 }} />
                  )) : null}
                  <span className="grid h-28 w-28 place-items-center rounded-full text-4xl font-black" style={{ background: "linear-gradient(135deg, #8b5cf6, #ec4899)" }}>{(who.trim()[0] ?? "R").toUpperCase()}</span>
                </div>
              ) : null}
              <p className="text-2xl font-black drop-shadow">{who}</p>
              <p className="mt-1 text-sm opacity-85">{status}</p>
            </div>

            {/* mi cámara */}
            {video && phase !== "incoming" ? (
              <video ref={localVideo} autoPlay playsInline muted className="absolute right-4 top-4 z-20 h-40 w-28 rounded-2xl border-2 border-white/30 bg-black object-cover shadow-xl sm:h-48 sm:w-36" style={{ transform: facing.current === "user" ? "scaleX(-1)" : undefined, opacity: camOff ? 0.25 : 1 }} />
            ) : null}

            <div className="relative z-10 mb-12 flex items-center gap-4">
              {phase === "incoming" ? (
                <>
                  <button type="button" onClick={() => void decline()} className="grid h-16 w-16 place-items-center rounded-full bg-red-500 shadow-xl transition active:scale-95" aria-label="Rechazar"><PhoneOff size={26} /></button>
                  <motion.button type="button" onClick={() => void accept()} animate={{ scale: [1, 1.1, 1] }} transition={{ repeat: Infinity, duration: 1.2 }} className="grid h-16 w-16 place-items-center rounded-full bg-emerald-500 shadow-xl" aria-label="Contestar">
                    {video ? <Video size={26} /> : <Phone size={26} />}
                  </motion.button>
                </>
              ) : phase === "ended" ? null : (
                <>
                  <button type="button" onClick={toggleMute} className={`grid h-14 w-14 place-items-center rounded-full ${muted ? "bg-white text-black" : "bg-white/15"}`} aria-label={muted ? "Activar micrófono" : "Silenciar"}>{muted ? <MicOff size={22} /> : <Mic size={22} />}</button>
                  {video ? <button type="button" onClick={toggleCam} className={`grid h-14 w-14 place-items-center rounded-full ${camOff ? "bg-white text-black" : "bg-white/15"}`} aria-label="Cámara">{camOff ? <VideoOff size={22} /> : <Video size={22} />}</button> : null}
                  {video ? <button type="button" onClick={() => void flipCam()} className="grid h-14 w-14 place-items-center rounded-full bg-white/15" aria-label="Cambiar cámara"><RefreshCw size={20} /></button> : null}
                  <button type="button" onClick={() => void endCall(phase === "outgoing" ? "canceló" : "colgó", phase === "outgoing" ? "Llamada cancelada" : "Llamada terminada")} className="grid h-16 w-16 place-items-center rounded-full bg-red-500 shadow-xl transition active:scale-95" aria-label="Colgar"><PhoneOff size={26} /></button>
                  <div className="relative">
                    <button type="button" onClick={() => void applyOutput(!speaker)} className={`grid h-14 w-14 place-items-center rounded-full ${speaker ? "bg-white text-black" : "bg-white/15"}`} aria-label={speaker ? "Quitar altavoz" : "Altavoz"} aria-pressed={speaker} title={speaker ? "Altavoz" : "Normal"}>
                      {speaker ? <Volume2 size={22} /> : <Volume1 size={22} />}
                    </button>
                    {outputs.length > 1 && "setSinkId" in HTMLMediaElement.prototype ? (
                      <button type="button" onClick={() => setShowOutputs((v) => !v)} className="absolute -right-1 -top-1 grid h-6 w-6 place-items-center rounded-full bg-white text-black shadow" aria-label="Elegir salida de audio"><ChevronUp size={14} /></button>
                    ) : null}
                    {showOutputs ? (
                      <div className="absolute bottom-16 left-1/2 w-64 -translate-x-1/2 overflow-hidden rounded-2xl bg-white p-1 text-sm text-slate-900 shadow-2xl">
                        <p className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">Escuchar por</p>
                        {outputs.map((d) => (
                          <button key={d.deviceId} type="button" onClick={() => { setShowOutputs(false); void applyOutput(/speaker|altavoz|bocina|parlante/i.test(d.label), d.deviceId); }}
                            className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left ${outputId === d.deviceId ? "bg-violet-100 font-bold" : "hover:bg-slate-100"}`}>
                            {/bluetooth|airpods|buds/i.test(d.label) ? "🎧" : /speaker|altavoz|bocina|parlante/i.test(d.label) ? "🔊" : "🔈"} <span className="truncate">{d.label || "Salida de audio"}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  {phase === "active" ? <button type="button" onClick={() => setMini(true)} className="grid h-14 w-14 place-items-center rounded-full bg-white/15" aria-label="Minimizar"><Minimize2 size={20} /></button> : null}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>,
    document.body,
  );
}
