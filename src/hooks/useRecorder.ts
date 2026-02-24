'use client';

import { useState, useRef, useCallback } from 'react';

interface RecorderResult {
  audioBlob: Blob;
  transcript?: string;
}

export function useRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recognitionRef = useRef<any>(null);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Initialize MediaRecorder for audio capture
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus',
      });
      
      chunksRef.current = [];
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      
      mediaRecorder.start();
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);
      
      // Try to use Web Speech API for real-time transcription
      if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
        const recognition = new SpeechRecognition();
        
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';
        
        recognition.onresult = (event: any) => {
          let interimTranscript = '';
          let finalTranscript = '';
          
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
              finalTranscript += transcript + ' ';
            } else {
              interimTranscript += transcript;
            }
          }
          
          setTranscript((prev) => prev + finalTranscript);
        };
        
        recognition.start();
        recognitionRef.current = recognition;
      }
    } catch (error) {
      console.error('Error starting recording:', error);
      throw error;
    }
  }, []);

  const stopRecording = useCallback((): Promise<RecorderResult> => {
    return new Promise((resolve) => {
      if (!mediaRecorderRef.current) {
        resolve({ audioBlob: new Blob(), transcript: '' });
        return;
      }

      mediaRecorderRef.current.onstop = () => {
        const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm;codecs=opus' });
        
        // Stop speech recognition if active
        if (recognitionRef.current) {
          recognitionRef.current.stop();
          recognitionRef.current = null;
        }
        
        // Stop all tracks
        if (mediaRecorderRef.current?.stream) {
          mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
        }
        
        setIsRecording(false);
        resolve({ audioBlob, transcript });
        setTranscript('');
      };

      mediaRecorderRef.current.stop();
    });
  }, [transcript]);

  return {
    isRecording,
    transcript,
    startRecording,
    stopRecording,
  };
}
