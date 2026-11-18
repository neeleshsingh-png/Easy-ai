import "dotenv/config";
import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer, WebSocket } from "ws";
import {
  GoogleGenAI,
  LiveServerMessage,
  Modality,
  ThinkingLevel,
  type Content,
  type Part,
} from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "API key is not configured. Please add GEMINI_API_KEY in Settings > Secrets."
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

const LANGUAGE_NAMES: Record<string, string> = {
  auto: "Auto-Detect",
  en: "English",
  hi: "Hindi",
  es: "Spanish",
  fr: "French",
  ar: "Arabic",
  zh: "Chinese (Mandarin)",
  ja: "Japanese",
  de: "German",
  pt: "Portuguese",
  ko: "Korean",
  bn: "Bengali",
  ta: "Tamil",
  te: "Telugu",
  mr: "Marathi",
  ur: "Urdu",
  it: "Italian",
  ru: "Russian",
  tr: "Turkish",
  id: "Indonesian",
  vi: "Vietnamese",
};

function buildSystemInstruction(languageCode: string, isVoice = false): string {
  const langName = LANGUAGE_NAMES[languageCode] || "English";
  const languageDirective =
    languageCode === "auto"
      ? "Detect the language of the user's message or speech and respond fluently and naturally in that same language."
      : `Respond in ${langName} unless the user explicitly asks you to translate or write in another language.`;

  if (isVoice) {
    return [
      "You are EASY AI, a fast, intelligent, and friendly conversational voice assistant.",
      "Give clear, accurate, helpful answers to any question.",
      "Keep spoken responses natural, conversational, and concise without markdown symbols, bullet syntax, or long code blocks unless asked.",
      languageDirective,
    ].join(" ");
  }

  return [
    "You are EASY AI, a brilliant, helpful, and versatile conversational AI assistant.",
    "You answer any question accurately across science, coding, writing, math, translation, planning, and everyday life.",
    "Format responses cleanly using Markdown (headings, lists, tables, and fenced code blocks with language tags when showing code).",
    "Never mention underlying API providers or unrelated model names; your name is EASY AI.",
    languageDirective,
  ].join(" ");
}

function getThinkingLevel(depth?: string): ThinkingLevel {
  if (depth === "fast") return ThinkingLevel.LOW;
  if (depth === "deep") return ThinkingLevel.HIGH;
  return ThinkingLevel.MEDIUM;
}

interface IncomingMessage {
  role: "user" | "assistant";
  content: string;
  image?: {
    mimeType: string;
    base64: string;
  };
}

function formatErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return "An unexpected error occurred while processing your request.";
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "25mb" }));

  // Health endpoint
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, service: "EASY AI" });
  });

  // Streaming chat endpoint (SSE)
  app.post("/api/chat/stream", async (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const abortController = new AbortController();
    req.on("close", () => {
      abortController.abort();
    });

    try {
      const {
        messages,
        language = "auto",
        depth = "balanced",
      } = req.body as {
        messages: IncomingMessage[];
        language?: string;
        depth?: string;
      };

      if (!Array.isArray(messages) || messages.length === 0) {
        res.write(
          `data: ${JSON.stringify({ error: "Please enter a message." })}\n\n`
        );
        res.end();
        return;
      }

      const ai = getAiClient();

      const contents: Content[] = messages
        .filter((m) => m.content.trim().length > 0 || m.image)
        .map((m) => {
          const parts: Part[] = [];
          if (m.image?.base64 && m.image?.mimeType) {
            parts.push({
              inlineData: {
                mimeType: m.image.mimeType,
                data: m.image.base64,
              },
            });
          }
          if (m.content.trim().length > 0) {
            parts.push({ text: m.content });
          }
          return {
            role: m.role === "assistant" ? "model" : "user",
            parts,
          };
        });

      const stream = await ai.models.generateContentStream({
        model: "gemini-4-hydrogen",
        contents,
        config: {
          systemInstruction: buildSystemInstruction(language, false),
          thinkingConfig: {
            thinkingLevel: getThinkingLevel(depth),
          },
        },
      });

      for await (const chunk of stream) {
        if (abortController.signal.aborted) break;
        const text = chunk.text;
        if (text) {
          res.write(`data: ${JSON.stringify({ text })}\n\n`);
        }
      }

      if (!abortController.signal.aborted) {
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      }
      res.end();
    } catch (err) {
      console.error("Chat stream error:", err);
      const message = formatErrorMessage(err);
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
        res.end();
      }
    }
  });

  // Text-to-Speech Read-Aloud endpoint
  app.post("/api/tts", async (req, res) => {
    try {
      const { text, voice = "Zephyr" } = req.body as {
        text: string;
        voice?: string;
      };

      if (!text || !text.trim()) {
        res.status(400).json({ error: "No text provided for speech." });
        return;
      }

      // Strip heavy markdown symbols so speech sounds natural
      const cleanText = text
        .replace(/```[\s\S]*?```/g, " Code snippet omitted. ")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/[#*_~>\[\]]/g, "")
        .slice(0, 3500)
        .trim();

      const validVoices = new Set(["Zephyr", "Kore", "Puck", "Charon", "Fenrir"]);
      const selectedVoice = validVoices.has(voice) ? voice : "Zephyr";

      const ai = getAiClient();
      const response = await ai.models.generateContent({
        model: "gemini-3.8-flash-lite-tts",
        contents: [
          {
            role: "user",
            parts: [
              {
                text: cleanText,
                speechMetadata: {
                  style: "Natural, clear, warm conversational assistant",
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: selectedVoice },
            },
          },
        },
      });

      const audioBase64 =
        response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

      if (!audioBase64) {
        res.status(502).json({ error: "Unable to generate speech audio." });
        return;
      }

      res.json({ audioBase64, mimeType: "audio/wav" });
    } catch (err) {
      console.error("TTS error:", err);
      res.status(500).json({ error: formatErrorMessage(err) });
    }
  });

  // Speech-to-Text Dictation Transcription endpoint
  app.post("/api/transcribe", async (req, res) => {
    try {
      const { audioBase64, mimeType = "audio/webm", language = "auto" } =
        req.body as {
          audioBase64: string;
          mimeType?: string;
          language?: string;
        };

      if (!audioBase64) {
        res.status(400).json({ error: "No audio data provided." });
        return;
      }

      const ai = getAiClient();
      const langName = LANGUAGE_NAMES[language] || "Auto-Detect";
      const promptText =
        language === "auto"
          ? "Transcribe this spoken audio accurately in its original spoken language. Return only the transcribed text without extra commentary."
          : `Transcribe this spoken audio accurately. The expected language is ${langName} (if the speaker uses another language, transcribe in the language spoken). Return only the transcribed text.`;

      const response = await ai.models.generateContent({
        model: "gemini-3.5-transcribe",
        contents: {
          parts: [
            {
              inlineData: {
                mimeType,
                data: audioBase64,
              },
            },
            { text: promptText },
          ],
        },
      });

      res.json({ text: (response.text ?? "").trim() });
    } catch (err) {
      console.error("Transcription error:", err);
      res.status(500).json({ error: formatErrorMessage(err) });
    }
  });

  // Create HTTP server so we can attach both Express and WebSocket
  const server = http.createServer(app);

  // Real-Time Live Voice WebSocket bridge
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const reqUrl = new URL(
      request.url || "/",
      `http://${request.headers.host || "localhost"}`
    );
    if (reqUrl.pathname === "/ws/live") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on("connection", async (clientWs: WebSocket, request) => {
    const reqUrl = new URL(
      request.url || "/ws/live",
      `http://${request.headers.host || "localhost"}`
    );
    const language = reqUrl.searchParams.get("language") || "auto";
    const voiceParam = reqUrl.searchParams.get("voice") || "Zephyr";
    const validVoices = new Set(["Zephyr", "Kore", "Puck", "Charon", "Fenrir"]);
    const selectedVoice = validVoices.has(voiceParam) ? voiceParam : "Zephyr";

    let liveSession: Awaited<ReturnType<GoogleGenAI["live"]["connect"]>> | null =
      null;
    let isClosed = false;

    const safeSend = (payload: Record<string, unknown>) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify(payload));
      }
    };

    try {
      const ai = getAiClient();
      liveSession = await ai.live.connect({
        model: "gemini-3.8-live",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: selectedVoice },
            },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: buildSystemInstruction(language, true),
        },
        callbacks: {
          onopen: () => {
            safeSend({ type: "ready" });
          },
          onmessage: (message: LiveServerMessage) => {
            const content = message.serverContent;
            if (!content) return;

            if (content.inputTranscription?.text) {
              safeSend({
                type: "inputTranscript",
                text: content.inputTranscription.text,
              });
            }

            if (content.outputTranscription?.text) {
              safeSend({
                type: "outputTranscript",
                text: content.outputTranscription.text,
              });
            }

            for (const part of content.modelTurn?.parts ?? []) {
              if (part.inlineData?.data) {
                safeSend({ type: "audio", data: part.inlineData.data });
              }
            }

            if (content.interrupted) {
              safeSend({ type: "interrupted" });
            }

            if (content.turnComplete) {
              safeSend({ type: "turnComplete" });
            }
          },
          onerror: (err: unknown) => {
            console.error("Live session error:", err);
            safeSend({
              type: "error",
              message: formatErrorMessage(err),
            });
          },
          onclose: () => {
            if (!isClosed) {
              safeSend({ type: "closed" });
            }
          },
        },
      });
    } catch (err) {
      console.error("Failed to open live voice session:", err);
      safeSend({
        type: "error",
        message: formatErrorMessage(err),
      });
      clientWs.close();
      return;
    }

    clientWs.on("message", (raw) => {
      if (!liveSession || isClosed) return;
      try {
        const msg = JSON.parse(raw.toString()) as {
          type?: string;
          data?: string;
          text?: string;
        };
        if (msg.type === "audio" && msg.data) {
          liveSession.sendRealtimeInput({
            audio: {
              data: msg.data,
              mimeType: "audio/pcm;rate=16000",
            },
          });
        } else if (msg.type === "text" && msg.text) {
          liveSession.sendRealtimeInput({
            text: msg.text,
          });
        }
      } catch (err) {
        console.error("Error forwarding client live message:", err);
      }
    });

    clientWs.on("close", () => {
      isClosed = true;
      try {
        liveSession?.close();
      } catch {
        // ignore close errors
      }
    });
  });

  // Mount Vite in dev or serve built assets in production
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, "dist");
    app.use(express.static(distDir));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`EASY AI server listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start EASY AI server:", err);
  process.exit(1);
});
