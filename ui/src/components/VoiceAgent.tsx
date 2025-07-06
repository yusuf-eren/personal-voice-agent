'use client';

import { useRef, useCallback, useEffect, useState } from 'react';
import { usePlayer } from '../hooks/usePlayer';

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
type RecordingStatus = 'idle' | 'recording' | 'processing' | 'playing';

interface VoiceAgentProps {
  wsUrl?: string;
}

export default function VoiceAgent({ wsUrl = 'ws://localhost:8080' }: VoiceAgentProps) {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [recordingStatus, setRecordingStatus] = useState<RecordingStatus>('idle');
  const [volume, setVolume] = useState(0);
  const [statusMessage, setStatusMessage] = useState('Ready to connect');
  const [isRecording, setIsRecording] = useState(false);
  const [canRecord, setCanRecord] = useState(true);

  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const volumeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const VOLUME_THRESHOLD = 0.1;
  const SILENCE_DURATION = 1500; // 1.5 seconds of silence to trigger end

  const { queueAudio, stopPlayback } = usePlayer({
    onPlaybackStart: () => {
      setRecordingStatus('playing');
      setStatusMessage('🎵 Playing AI response...');
      setCanRecord(false);
    },
    onPlaybackEnd: () => {
      setRecordingStatus('idle');
      setStatusMessage('✅ Ready to record');
      setCanRecord(true);
    },
  });

  // Initialize audio context and analyzer
  const initAudio = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioContext = new AudioContextClass();
      const analyser = audioContext.createAnalyser();
      const source = audioContext.createMediaStreamSource(stream);
      
      analyser.fftSize = 256;
      source.connect(analyser);
      
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm; codecs=opus'
      });
      
      // Stream chunks in real-time
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          // Convert blob to base64 and send immediately
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64 = (reader.result as string).split(',')[1];
            
            if (wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({
                type: 'user_audio_chunk',
                chunk: base64
              }));
            }
          };
          reader.readAsDataURL(event.data);
        }
      };
      
      mediaRecorderRef.current = mediaRecorder;
      return true;
    } catch (error) {
      console.error('Failed to initialize audio:', error);
      setStatusMessage('❌ Failed to access microphone');
      return false;
    }
  }, []);

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    
    setConnectionStatus('connecting');
    setStatusMessage('🔄 Connecting to server...');
    
    const ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
      setConnectionStatus('connected');
      setStatusMessage('✅ Connected to server');
      console.log('Connected to WebSocket server');
    };
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.type === 'ai_audio') {
        console.log('Received AI audio chunk', data.done ? '(final)' : '(streaming)');
        queueAudio(data.chunk);
      } else if (data.type === 'error') {
        console.error('Server error:', data.message);
        setStatusMessage(`❌ Server error: ${data.message}`);
        setRecordingStatus('idle');
        setCanRecord(true);
      }
    };
    
    ws.onclose = () => {
      setConnectionStatus('disconnected');
      setStatusMessage('❌ Disconnected from server');
      console.log('Disconnected from WebSocket server');
    };
    
    ws.onerror = (error) => {
      setConnectionStatus('error');
      setStatusMessage('❌ Connection error');
      console.error('WebSocket error:', error);
    };
    
    wsRef.current = ws;
  }, [wsUrl, queueAudio]);

  // Disconnect from WebSocket
  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    stopRecording();
  }, []);

  // Start recording
  const startRecording = useCallback(async () => {
    if (!canRecord || !mediaRecorderRef.current) {
      if (!mediaRecorderRef.current) {
        const success = await initAudio();
        if (!success) return;
      }
      if (!canRecord) {
        setStatusMessage('⏳ Please wait for AI response to finish');
        return;
      }
    }
    
    if (connectionStatus !== 'connected') {
      setStatusMessage('❌ Please connect to server first');
      return;
    }
    
    // Stop any ongoing AI audio playback when user starts recording
    stopPlayback();
    
    setIsRecording(true);
    setRecordingStatus('recording');
    setStatusMessage('🎙️ Recording... Speak now!');
    
    // Send start signal
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'user_audio_start'
      }));
    }
    
    mediaRecorderRef.current?.start(100); // Stream in 100ms chunks
    startVolumeMonitoring();
  }, [canRecord, connectionStatus, initAudio, stopPlayback]);

  // Stop recording
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setRecordingStatus('processing');
      setStatusMessage('⏳ Processing your speech...');
      
      // Send end signal
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'user_audio_end'
        }));
      }
      
      stopVolumeMonitoring();
    }
  }, [isRecording]);

  // Start volume monitoring
  const startVolumeMonitoring = useCallback(() => {
    if (!analyserRef.current) return;
    
    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    
    const updateVolume = () => {
      if (!analyserRef.current || !isRecording) return;
      
      analyserRef.current.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
      const normalizedVolume = average / 255;
      
      setVolume(normalizedVolume);
      
      // Check for silence
      if (normalizedVolume < VOLUME_THRESHOLD) {
        if (!volumeTimeoutRef.current) {
          volumeTimeoutRef.current = setTimeout(() => {
            console.log('Silence detected, ending recording');
            stopRecording();
          }, SILENCE_DURATION);
        }
      } else {
        // Clear silence timeout if speaking
        if (volumeTimeoutRef.current) {
          clearTimeout(volumeTimeoutRef.current);
          volumeTimeoutRef.current = null;
        }
      }
      
      animationFrameRef.current = requestAnimationFrame(updateVolume);
    };
    
    updateVolume();
  }, [isRecording, stopRecording]);

  // Stop volume monitoring
  const stopVolumeMonitoring = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (volumeTimeoutRef.current) {
      clearTimeout(volumeTimeoutRef.current);
      volumeTimeoutRef.current = null;
    }
    setVolume(0);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
      stopVolumeMonitoring();
    };
  }, [disconnect, stopVolumeMonitoring]);

  // Status color helper
  const getStatusColor = (status: ConnectionStatus | RecordingStatus) => {
    switch (status) {
      case 'connected':
      case 'idle':
        return 'text-green-600';
      case 'connecting':
      case 'recording':
        return 'text-blue-600';
      case 'processing':
      case 'playing':
        return 'text-purple-600';
      case 'error':
      case 'disconnected':
        return 'text-red-600';
      default:
        return 'text-gray-600';
    }
  };

  return (
    <div className="max-w-md mx-auto p-6 bg-white rounded-lg shadow-lg">
      <div className="text-center mb-6">
        <h1 className="text-2xl font-bold text-gray-800 mb-2">Voice Agent</h1>
        <p className={`text-sm font-medium ${getStatusColor(connectionStatus)}`}>
          {statusMessage}
        </p>
      </div>

      {/* Connection Status */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-gray-600">Connection:</span>
          <span className={`text-sm font-medium ${getStatusColor(connectionStatus)}`}>
            {connectionStatus.charAt(0).toUpperCase() + connectionStatus.slice(1)}
          </span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={connect}
            disabled={connectionStatus === 'connected' || connectionStatus === 'connecting'}
            className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            Connect
          </button>
          <button
            onClick={disconnect}
            disabled={connectionStatus === 'disconnected'}
            className="flex-1 px-4 py-2 bg-red-500 text-white rounded-md hover:bg-red-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            Disconnect
          </button>
        </div>
      </div>

      {/* Recording Status */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-gray-600">Recording:</span>
          <span className={`text-sm font-medium ${getStatusColor(recordingStatus)}`}>
            {recordingStatus.charAt(0).toUpperCase() + recordingStatus.slice(1)}
          </span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={startRecording}
            disabled={isRecording || connectionStatus !== 'connected' || !canRecord}
            className="flex-1 px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            🎙️ Start Recording
          </button>
          <button
            onClick={stopRecording}
            disabled={!isRecording}
            className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-md hover:bg-orange-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            ⏹️ Stop Recording
          </button>
        </div>
      </div>

      {/* Volume Indicator */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-gray-600">Volume:</span>
          <span className="text-sm text-gray-600">{Math.round(volume * 100)}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-4">
          <div
            className={`h-4 rounded-full transition-all duration-150 ${
              volume > VOLUME_THRESHOLD ? 'bg-green-500' : 'bg-gray-400'
            }`}
            style={{ width: `${Math.min(volume * 100, 100)}%` }}
          />
        </div>
        <div className="text-xs text-gray-500 mt-1">
          Threshold: {Math.round(VOLUME_THRESHOLD * 100)}%
        </div>
      </div>

      {/* Recording Indicator */}
      {isRecording && (
        <div className="text-center">
          <div className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-red-100 text-red-800">
            <div className="w-2 h-2 bg-red-500 rounded-full mr-2 animate-pulse"></div>
            Recording...
          </div>
        </div>
      )}

      {/* Processing/Playing Indicator */}
      {(recordingStatus === 'processing' || recordingStatus === 'playing') && (
        <div className="text-center">
          <div className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
            recordingStatus === 'processing' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'
          }`}>
            <div className="w-2 h-2 bg-purple-500 rounded-full mr-2 animate-pulse"></div>
            {recordingStatus === 'processing' ? 'Processing...' : 'Playing...'}
          </div>
        </div>
      )}
    </div>
  );
} 