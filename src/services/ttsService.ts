import { GoogleGenAI, Modality } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export type VoiceName = 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr';

export interface TTSOptions {
  voice: VoiceName;
  speed: number;
  pitch: number;
  voiceSampleBase64?: string; // If present, used for voice cloning/mimicking
  clonedVoiceId?: string;
}

export async function generateAudioFromText(text: string, options: TTSOptions): Promise<string> {
  try {
    if (options.voiceSampleBase64) {
      // Use multimodal synthesis with gemini-3.1-flash-live-preview for "cloning"
      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-live-preview",
        contents: [
          {
            parts: [
              {
                inlineData: {
                  data: options.voiceSampleBase64,
                  mimeType: "audio/mpeg", // Or detected type
                },
              },
              {
                text: `Hãy đọc đoạn văn bản sau đây với ĐÚNG giọng điệu, âm sắc và phong cách của mẫu âm thanh bên trên. 
Tốc độ: ${options.speed}x, Cao độ điều chỉnh: ${options.pitch - 1}.
Văn bản cần đọc: "${text}"`,
              },
            ],
          },
        ],
        config: {
          responseModalities: [Modality.AUDIO],
        },
      });

      const inlineData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
      const base64Audio = inlineData?.data;
      const mimeType = inlineData?.mimeType || 'audio/wav';
      if (!base64Audio) throw new Error("No audio data generated (cloning)");

      return base64ToBlobUrl(base64Audio, mimeType);
    } else {
      // Standard TTS
      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-tts-preview",
        contents: [{ parts: [{ text: text }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: options.voice },
            },
          },
        },
      });

      const inlineData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
      const base64Audio = inlineData?.data;
      const mimeType = inlineData?.mimeType || 'audio/wav';
      if (!base64Audio) throw new Error("No audio data generated");

      return base64ToBlobUrl(base64Audio, mimeType);
    }
  } catch (error) {
    console.error("TTS generation failed", error);
    throw error;
  }
}

function base64ToBlobUrl(base64: string, mimeType: string = 'audio/wav'): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  let finalBytes = bytes;

  // If it's raw PCM, wrap it in a WAV header so the browser's <audio> element can play it natively.
  if (mimeType.includes("audio/pcm")) {
    let sampleRate = 24000;
    const match = mimeType.match(/rate=(\d+)/);
    if (match) {
      sampleRate = parseInt(match[1], 10);
    }
    
    const numChannels = 1; // mono
    const bitsPerSample = 16; // 16-bit
    const wavHeader = new ArrayBuffer(44);
    const view = new DataView(wavHeader);
    
    const writeString = (view: DataView, offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + bytes.length, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * 2, true);
    view.setUint16(32, numChannels * 2, true);
    view.setUint16(34, bitsPerSample, true);
    writeString(view, 36, 'data');
    view.setUint32(40, bytes.length, true);

    finalBytes = new Uint8Array(44 + bytes.length);
    finalBytes.set(new Uint8Array(wavHeader), 0);
    finalBytes.set(bytes, 44);
    mimeType = 'audio/wav';
  }

  const blob = new Blob([finalBytes], { type: mimeType });
  return URL.createObjectURL(blob);
}
