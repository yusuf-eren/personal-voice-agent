import { WebSocketServer } from 'ws';
import { OpenAI } from 'openai';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import { v4 as uuid } from 'uuid';
import mime from 'mime-types';
import 'dotenv/config';
import { transcribe } from './asr/transcribe';
import { createOptimalTTSChunks } from './tts/chunk-text';

interface WebSocketMessage {
  type: 'user_audio_start' | 'user_audio_chunk' | 'user_audio_end';
  chunk?: string;
}

const openai = new OpenAI();
const wss = new WebSocketServer({ port: 8080 });

const TMP_DIR = 'tmp';
fs.mkdirSync(TMP_DIR, { recursive: true });

console.log(
  `[${new Date().toISOString()}] ✅ WebSocket server started on ws://localhost:8080`
);

wss.on('connection', (ws) => {
  console.log(`[${new Date().toISOString()}] 🔌 New client connected`);

  let audioChunks: string[] = [];
  let inProgress = false;
  let currentSessionId: string | null = null;

  ws.on('message', async (msg) => {
    const data: WebSocketMessage = JSON.parse(msg.toString());

    if (data.type === 'user_audio_start') {
      if (inProgress) {
        console.log(
          `[${new Date().toISOString()}] 🛑 Session in progress, ignoring start`
        );
        return;
      }

      currentSessionId = uuid();
      audioChunks = [];
      inProgress = false; // Don't block streaming
      console.log(
        `[${new Date().toISOString()}] 🎙️ Started new audio session: ${currentSessionId}`
      );
      return;
    }

    if (data.type === 'user_audio_chunk') {
      if (!currentSessionId) {
        console.warn(`[WARN] Received chunk without session start`);
        return;
      }

      // Store the base64 chunk
      if (data.chunk) {
        audioChunks.push(data.chunk);
        console.log(
          `[${new Date().toISOString()}] 📦 Received chunk ${
            audioChunks.length
          } (session: ${currentSessionId})`
        );
      }
      return;
    }

    if (data.type === 'user_audio_end') {
      if (!currentSessionId) {
        console.warn(`[WARN] Received end without session start`);
        return;
      }

      if (inProgress) {
        console.log(
          `[${new Date().toISOString()}] 🛑 Already processing. Skipping...`
        );
        return;
      }

      inProgress = true;
      console.log(
        `[${new Date().toISOString()}] 🛑 Processing ${
          audioChunks.length
        } chunks for session: ${currentSessionId}`
      );

      if (audioChunks.length === 0) {
        console.warn(`[WARN] No audio chunks received. Skipping.`);
        inProgress = false;
        currentSessionId = null;
        return;
      }

      const fileId = currentSessionId;
      const filePath = path.join(TMP_DIR, `${fileId}.webm`);

      try {
        // Convert base64 chunks back to binary data and combine them
        const binaryChunks = audioChunks.map((chunk) =>
          Buffer.from(chunk, 'base64')
        );
        const completeBuffer = Buffer.concat(binaryChunks);

        if (completeBuffer.length < 1000) {
          console.warn(
            `[WARN] File too small (${completeBuffer.length} bytes). Skipping.`
          );
          inProgress = false;
          currentSessionId = null;
          return;
        }

        await fsPromises.writeFile(filePath, completeBuffer);
        const type = mime.lookup(filePath);
        console.log(
          `[${new Date().toISOString()}] 💾 Saved audio: ${filePath} (${type}, ${
            completeBuffer.length
          } bytes)`
        );

        let transcript = '';
        let finalResponse = '';

        const t0 = Date.now();

        // Transcribe audio
        const transcription = await transcribe(filePath);
        transcript = transcription.text;

        const t1 = Date.now();
        console.log(
          `[${new Date().toISOString()}] 📝 Transcription done: "${transcript}"`
        );
        console.log(`🕒 Transcription Time: ${t1 - t0} ms`);

        // Generate response
        const chatStream = await openai.chat.completions.create({
          model: 'gpt-3.5-turbo',
          messages: [
            {
              role: 'system',
              content:
                'You are a helpful voice assistant. Keep responses concise and conversational.'
            },
            { role: 'user', content: transcript }
          ],
          stream: true
        });

        for await (const chunk of chatStream) {
          const delta = chunk.choices[0]?.delta?.content || '';
          finalResponse += delta;
        }

        const t2 = Date.now();
        console.log(
          `[${new Date().toISOString()}] 🤖 Chat response done: "${finalResponse}"`
        );
        console.log(`🕒 Generation Time: ${t2 - t1} ms`);

        // Improved sentence splitting and chunking for better TTS performance
        const chunks = createOptimalTTSChunks(finalResponse);

        console.log('---chunks', chunks);

        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          const isLast = i === chunks.length - 1;
          const tts = await openai.audio.speech.create({
            model: 'tts-1',
            voice: 'nova',
            input: chunk
          });

          const audioBuffer = Buffer.from(await tts.arrayBuffer());
          const base64 = audioBuffer.toString('base64');
          ws.send(
            JSON.stringify({
              type: 'ai_audio',
              chunk: base64,
              done: isLast
            })
          );
        }

        const t3 = Date.now();
        console.log(`🕒 TTS + Stream Time: ${t3 - t2} ms`);
        console.log(`✅ Total Time: ${t3 - t0} ms`);
      } catch (err) {
        const error = err as Error;
        console.error(
          `[${new Date().toISOString()}] ❌ ERROR: ${error.message}`
        );
        ws.send(JSON.stringify({ type: 'error', message: error.message }));
      } finally {
        try {
          // Uncomment to keep files for debugging
          // await fsPromises.unlink(filePath);
        } catch {
          console.warn(`[WARN] Could not delete file: ${filePath}`);
        }
        audioChunks = [];
        inProgress = false;
        currentSessionId = null;
      }
    }
  });

  ws.on('close', () => {
    console.log(`[${new Date().toISOString()}] 🔌 Client disconnected`);
    // Clean up any ongoing session
    audioChunks = [];
    inProgress = false;
    currentSessionId = null;
  });
});
