import { useRef, useCallback, useEffect } from 'react';

interface UsePlayerProps {
  onPlaybackStart?: () => void;
  onPlaybackEnd?: () => void;
}

export function usePlayer({ onPlaybackStart, onPlaybackEnd }: UsePlayerProps = {}) {
  const audioContextRef = useRef<AudioContext | null>(null);
  const isPlayingRef = useRef(false);
  const audioQueueRef = useRef<string[]>([]);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);

  // Initialize AudioContext
  const initAudioContext = useCallback(async () => {
    if (!audioContextRef.current) {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioContextRef.current = new AudioContextClass();
      
      // Resume context if suspended (required for user interaction)
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }
    }
  }, []);

  // Process next audio chunk in queue
  const processNextAudio = useCallback(async () => {
    if (audioQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      onPlaybackEnd?.();
      console.log('[player] 🎵 Audio queue finished');
      return;
    }

    const nextChunk = audioQueueRef.current.shift()!;
    console.log(`[player] 🎵 Playing queued audio chunk (${audioQueueRef.current.length} remaining)`);
    
    try {
      await initAudioContext();
      
      if (!audioContextRef.current) {
        console.error('[player] AudioContext not available');
        processNextAudio(); // Try next chunk
        return;
      }

      // Convert base64 to ArrayBuffer
      const binary = atob(nextChunk);
      const bytes = new Uint8Array([...binary].map(c => c.charCodeAt(0)));
      
      // Decode audio data
      const buffer = await audioContextRef.current.decodeAudioData(bytes.buffer);
      
      // Create and play audio source
      const source = audioContextRef.current.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContextRef.current.destination);
      
      // Store reference to current source
      currentSourceRef.current = source;
      
      // Handle playback end - process next chunk
      source.onended = () => {
        console.log('[player] 🎵 Audio chunk finished, processing next');
        currentSourceRef.current = null;
        processNextAudio();
      };
      
      source.start();
      console.log('[player] ✅ Audio chunk started playing');
      
    } catch (error) {
      console.error('[player] Failed to play audio chunk:', error);
      processNextAudio(); // Try next chunk
    }
  }, [initAudioContext, onPlaybackEnd]);

  // Add audio chunk to queue and play if not already playing
  const queueAudio = useCallback(async (base64: string) => {
    console.log(`[player] 🎵 Queuing audio chunk (queue size: ${audioQueueRef.current.length})`);
    
    // Add to queue
    audioQueueRef.current.push(base64);
    
    // If not currently playing, start playback
    if (!isPlayingRef.current) {
      isPlayingRef.current = true;
      onPlaybackStart?.();
      console.log('[player] 🎵 Starting audio playback');
      processNextAudio();
    }
  }, [processNextAudio, onPlaybackStart]);

  // Stop current playback and clear queue
  const stopPlayback = useCallback(() => {
    console.log('[player] 🛑 Stopping playback and clearing queue');
    
    // Stop current audio source
    if (currentSourceRef.current) {
      currentSourceRef.current.stop();
      currentSourceRef.current = null;
    }
    
    // Clear queue
    audioQueueRef.current = [];
    
    // Reset state
    if (isPlayingRef.current) {
      isPlayingRef.current = false;
      onPlaybackEnd?.();
    }
  }, [onPlaybackEnd]);

  // Legacy method for backward compatibility
  const playAudio = useCallback(async (base64: string) => {
    return queueAudio(base64);
  }, [queueAudio]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (audioContextRef.current?.state !== 'closed') {
        audioContextRef.current?.close();
      }
    };
  }, []);

  return {
    playAudio, // Legacy method
    queueAudio, // New method for queuing
    stopPlayback,
    isPlaying: isPlayingRef.current,
    queueLength: audioQueueRef.current.length
  };
} 