/// <reference types="vite/client" />

declare module 'browser-encrypt-attachment' {
  export interface EncryptedAttachmentInfo {
    v: string;
    key: {
      alg: string;
      key_ops: string[];
      kty: string;
      k: string;
      ext: boolean;
    };
    iv: string;
    hashes: {
      [alg: string]: string;
    };
  }

  export interface EncryptedAttachment {
    data: ArrayBuffer;
    info: EncryptedAttachmentInfo;
  }

  export function encryptAttachment(dataBuffer: ArrayBuffer): Promise<EncryptedAttachment>;

  export function decryptAttachment(
    dataBuffer: ArrayBuffer,
    info: EncryptedAttachmentInfo,
  ): Promise<ArrayBuffer>;
}

declare module '*.svg' {
  const content: string;
  export default content;
}

// opus-recorder ships no types. Shape taken from its README and from
// element-web's equivalent declaration (AGPL-3.0-only, same licence as this
// project). The encoder worker is loaded through Vite's `?url` import, which
// yields a plain string, so it needs no declaration of its own.
declare module 'opus-recorder/dist/recorder.min.js' {
  export default class Recorder {
    public static isRecordingSupported(): boolean;

    public constructor(config: {
      bufferLength?: number;
      encoderApplication?: number;
      encoderFrameSize?: number;
      encoderPath?: string;
      encoderSampleRate?: number;
      encoderBitRate?: number;
      encoderComplexity?: number;
      maxFramesPerPage?: number;
      mediaTrackConstraints?: boolean | MediaTrackConstraints;
      monitorGain?: number;
      numberOfChannels?: number;
      recordingGain?: number;
      resampleQuality?: number;
      streamPages?: boolean;
      wavBitDepth?: number;
      sourceNode?: MediaStreamAudioSourceNode;
    });

    public ondataavailable?(data: ArrayBuffer): void;

    public readonly encodedSamplePosition: number;

    public start(): Promise<void>;

    public stop(): Promise<void>;

    public close(): void;
  }
}
