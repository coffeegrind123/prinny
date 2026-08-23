import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MAX_DURATION_SECONDS,
  VoiceRecorder,
  VoiceRecording,
  WAVEFORM_SAMPLES,
  WARN_SECONDS_LEFT,
} from '../../../plugins/voice-recorder';
import { describeCaptureError } from '../../../utils/capture';

export enum VoiceRecordStatus {
  Idle = 'idle',
  Starting = 'starting',
  Recording = 'recording',
  Preview = 'preview',
  Sending = 'sending',
}

export type VoiceRecorderControls = {
  status: VoiceRecordStatus;
  waveform: number[];
  durationSeconds: number;
  /** Set once recording stops, cleared on discard/send. */
  recording?: VoiceRecording;
  error?: string;
  /** True inside the last `WARN_SECONDS_LEFT` before the hard cap. */
  endingSoon: boolean;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  discard: () => void;
  setSending: (sending: boolean) => void;
  clearError: () => void;
};

const emptyWaveform = () => new Array(WAVEFORM_SAMPLES).fill(0) as number[];

/**
 * @param scopeKey Recording is abandoned whenever this changes. Pass the room
 * id: RoomInput is not remounted when you switch rooms (only the timeline is
 * keyed), so without this a recording started in one room stays live in the
 * next one — and pressing send would post it to whichever room you had ended
 * up in.
 */
export function useVoiceRecorder(scopeKey: string): VoiceRecorderControls {
  const recorderRef = useRef<VoiceRecorder | undefined>(undefined);
  /**
   * Bumped by anything that abandons a take — cancel, unmount, room switch, a
   * second `start()`.
   *
   * `start()` awaits `getUserMedia`, which is where the permission prompt
   * lives, and the recorder only reaches `recorderRef` *after* that await. So
   * for the whole time the prompt is on screen there is a recorder nothing can
   * reach: `cancel()` found an empty ref and did nothing, and when the promise
   * finally resolved the microphone opened anyway — into a UI that had already
   * moved on. The result is a recording indicator on a room you left, and a mic
   * that stays live until the tab is closed. A generation counter is the fix:
   * a start whose generation has been superseded releases what it just
   * acquired instead of publishing it.
   */
  const startGenerationRef = useRef(0);
  /** A start is between `getUserMedia` and its ref assignment. */
  const startingRef = useRef(false);
  const [status, setStatus] = useState(VoiceRecordStatus.Idle);
  const [waveform, setWaveform] = useState<number[]>(emptyWaveform);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [recording, setRecording] = useState<VoiceRecording>();
  const [error, setError] = useState<string>();

  const discard = useCallback(() => {
    startGenerationRef.current += 1;
    recorderRef.current?.cancel();
    recorderRef.current = undefined;
    setRecording(undefined);
    setWaveform(emptyWaveform());
    setDurationSeconds(0);
    setStatus(VoiceRecordStatus.Idle);
  }, []);

  const stop = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    try {
      const result = await recorder.stop();
      recorderRef.current = undefined;
      setRecording(result);
      setWaveform(result.waveform);
      setDurationSeconds(result.durationSeconds);
      setStatus(VoiceRecordStatus.Preview);
    } catch (e) {
      recorderRef.current = undefined;
      setError(e instanceof Error ? e.message : 'Recording failed.');
      setStatus(VoiceRecordStatus.Idle);
    }
  }, []);

  // `stop` is recreated on every render, but the recorder's max-duration
  // callback is registered once — keep a live ref so the auto-stop always calls
  // the current one.
  const stopRef = useRef(stop);
  stopRef.current = stop;

  const start = useCallback(async () => {
    // The ref alone is not enough to make this idempotent — see
    // `startGenerationRef`. Two quick taps used to open two microphone streams,
    // of which only the second was ever released.
    if (recorderRef.current || startingRef.current) return;
    const generation = startGenerationRef.current + 1;
    startGenerationRef.current = generation;
    startingRef.current = true;
    setError(undefined);
    setRecording(undefined);
    setWaveform(emptyWaveform());
    setDurationSeconds(0);
    setStatus(VoiceRecordStatus.Starting);

    const recorder = new VoiceRecorder();
    recorder.onUpdate = (update) => {
      setWaveform(update.waveform);
      setDurationSeconds(update.durationSeconds);
    };
    recorder.onMaxDuration = () => {
      stopRef.current();
    };

    try {
      await recorder.start();
      if (generation !== startGenerationRef.current) {
        // Cancelled, unmounted or superseded while the permission prompt was
        // up. The microphone is open at this point, so it has to be released
        // here — nothing else holds a reference to this recorder.
        recorder.cancel();
        return;
      }
      recorderRef.current = recorder;
      setStatus(VoiceRecordStatus.Recording);
    } catch (e) {
      // A denial that arrives after the take was abandoned is not an error the
      // user needs to see; the composer they would see it in is gone.
      if (generation !== startGenerationRef.current) return;
      setError(describeCaptureError(e));
      setStatus(VoiceRecordStatus.Idle);
    } finally {
      startingRef.current = false;
    }
  }, []);

  const setSending = useCallback((sending: boolean) => {
    setStatus(sending ? VoiceRecordStatus.Sending : VoiceRecordStatus.Preview);
  }, []);

  // Closing the app, or unmounting the composer, must not leave the mic open.
  useEffect(
    () => () => {
      startGenerationRef.current += 1;
      recorderRef.current?.cancel();
      recorderRef.current = undefined;
    },
    [],
  );

  // Switching rooms abandons the take. Losing a recording is annoying; sending
  // it to the wrong room is worse, and there is no undo for that.
  useEffect(() => {
    discard();
    // `discard` is stable, and re-running this on anything else would wipe a
    // recording mid-take.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);

  return {
    status,
    waveform,
    durationSeconds,
    recording,
    error,
    endingSoon:
      status === VoiceRecordStatus.Recording &&
      durationSeconds >= MAX_DURATION_SECONDS - WARN_SECONDS_LEFT,
    start,
    stop,
    discard,
    setSending,
    clearError: useCallback(() => setError(undefined), []),
  };
}
