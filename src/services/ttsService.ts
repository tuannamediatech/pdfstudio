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

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Audio) throw new Error("No audio data generated (cloning)");

      return base64ToBlobUrl(base64Audio);
    } else {
      // Standard TTS
      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-tts-preview",
        contents: [{ parts: [{ text: `Đọc văn bản này (tốc độ ${options.speed}x, cao độ ${options.pitch}): ${text}` }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: options.voice },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Audio) throw new Error("No audio data generated");

      return base64ToBlobUrl(base64Audio);
    }
  } catch (error) {
    console.error("TTS generation failed", error);
    throw error;
  }
}

function base64ToBlobUrl(base64: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: 'audio/mpeg' });
  return URL.createObjectURL(blob);
}
