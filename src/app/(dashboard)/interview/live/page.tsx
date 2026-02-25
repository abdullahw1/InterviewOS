'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Mic, MicOff, Video, VideoOff, Loader2, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';

type InterviewState = 'setup' | 'starting' | 'active' | 'processing' | 'complete';

export default function LiveInterviewPage() {
  const router = useRouter();
  const [state, setState] = useState<InterviewState>('setup');
  const [company, setCompany] = useState('');
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [interviewType, setInterviewType] = useState('behavioral');
  
  const [isMicEnabled, setIsMicEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [currentQuestion, setCurrentQuestion] = useState('');
  const [aiSpeaking, setAiSpeaking] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [questionCount, setQuestionCount] = useState(0);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pendingTranscriptRef = useRef<string>('');

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
      }
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, []);

  const startInterview = async () => {
    if (!company.trim()) {
      toast.error('Please enter a company name');
      return;
    }

    setState('starting');
    
    try {
      // Request media permissions
      const stream = await navigator.mediaDevices.getUserMedia({
        video: isVideoEnabled,
        audio: true,
      });
      
      mediaStreamRef.current = stream;
      
      if (videoRef.current && isVideoEnabled) {
        videoRef.current.srcObject = stream;
      }

      // Initialize interview session
      const response = await fetch('/api/interview/live/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company,
          difficulty,
          interviewType,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('Start interview error:', errorData);
        toast.error(errorData.error || 'Failed to start interview');
        throw new Error(errorData.error || 'Failed to start interview');
      }

      const { sessionId: newSessionId, firstQuestion } = await response.json();
      
      setSessionId(newSessionId);
      setState('active');
      setCurrentQuestion(firstQuestion);
      speakText(firstQuestion);

      // Start recording audio
      startAudioRecording(stream);
      
      // Start polling for AI responses
      startPolling(newSessionId);
      
    } catch (error) {
      console.error('Error starting interview:', error);
      toast.error('Failed to start interview. Please check permissions.');
      setState('setup');
    }
  };

  const startPolling = (sid: string) => {
    pollingIntervalRef.current = setInterval(async () => {
      if (pendingTranscriptRef.current) {
        const transcriptToSend = pendingTranscriptRef.current;
        pendingTranscriptRef.current = '';
        
        try {
          const response = await fetch('/api/interview/live/poll', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionId: sid,
              userTranscript: transcriptToSend,
            }),
          });

          if (response.ok) {
            const data = await response.json();
            
            if (data.type === 'question' || data.type === 'final_question') {
              setCurrentQuestion(data.text);
              setQuestionCount(data.questionCount);
              speakText(data.text);
              
              if (data.shouldEnd) {
                setTimeout(() => endInterview(), 3000);
              }
            }
          }
        } catch (error) {
          console.error('Polling error:', error);
        }
      }
    }, 3000); // Poll every 3 seconds
  };

  const startAudioRecording = (stream: MediaStream) => {
    const audioStream = new MediaStream(stream.getAudioTracks());
    const mediaRecorder = new MediaRecorder(audioStream, {
      mimeType: 'audio/webm',
    });

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunksRef.current.push(event.data);
      }
    };

    mediaRecorder.onstop = async () => {
      const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      audioChunksRef.current = [];
      
      // Send audio for transcription
      await transcribeAndRespond(audioBlob);
    };

    mediaRecorderRef.current = mediaRecorder;
    mediaRecorder.start();
    
    // Record in 5-second chunks for real-time processing
    setInterval(() => {
      if (mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        mediaRecorder.start();
      }
    }, 5000);
  };

  const transcribeAndRespond = async (audioBlob: Blob) => {
    try {
      const formData = new FormData();
      formData.append('audio', audioBlob);

      const response = await fetch('/api/interview/live/transcribe', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) return;

      const { transcript: newTranscript } = await response.json();
      
      if (newTranscript && newTranscript.trim()) {
        setTranscript(prev => prev + ' ' + newTranscript);
        pendingTranscriptRef.current += ' ' + newTranscript;
      }
    } catch (error) {
      console.error('Transcription error:', error);
    }
  };

  const speakText = async (text: string) => {
    setAiSpeaking(true);
    
    try {
      const response = await fetch('/api/interview/live/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) throw new Error('TTS failed');

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      
      audio.onended = () => {
        setAiSpeaking(false);
        URL.revokeObjectURL(audioUrl);
      };
      
      await audio.play();
    } catch (error) {
      console.error('TTS error:', error);
      setAiSpeaking(false);
    }
  };

  const endInterview = async () => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
    }
    
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }

    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
    }

    setState('processing');

    try {
      const response = await fetch('/api/interview/live/poll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          action: 'end',
        }),
      });

      if (response.ok) {
        const data = await response.json();
        router.push(`/interview/${data.sessionId}`);
      }
    } catch (error) {
      console.error('Error ending interview:', error);
      toast.error('Failed to end interview');
    }
  };

  const toggleMic = () => {
    if (mediaStreamRef.current) {
      const audioTrack = mediaStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMicEnabled(audioTrack.enabled);
      }
    }
  };

  const toggleVideo = () => {
    if (mediaStreamRef.current) {
      const videoTrack = mediaStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoEnabled(videoTrack.enabled);
      }
    }
  };

  if (state === 'setup') {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Live AI Interview</h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            Practice with a real-time AI interviewer
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Interview Setup</CardTitle>
            <CardDescription>
              Configure your interview session
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="company">Company Name</Label>
              <input
                id="company"
                type="text"
                className="w-full px-3 py-2 border rounded-md"
                placeholder="e.g., Google, Amazon, Meta"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="difficulty">Difficulty Level</Label>
              <Select value={difficulty} onValueChange={(v: any) => setDifficulty(v)}>
                <SelectTrigger id="difficulty">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="easy">Easy - Entry Level</SelectItem>
                  <SelectItem value="medium">Medium - Mid Level</SelectItem>
                  <SelectItem value="hard">Hard - Senior Level</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="type">Interview Type</Label>
              <Select value={interviewType} onValueChange={setInterviewType}>
                <SelectTrigger id="type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="behavioral">Behavioral</SelectItem>
                  <SelectItem value="technical">Technical</SelectItem>
                  <SelectItem value="system_design">System Design</SelectItem>
                  <SelectItem value="mixed">Mixed</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center space-x-4 pt-4">
              <Button
                variant={isVideoEnabled ? 'default' : 'outline'}
                onClick={() => setIsVideoEnabled(!isVideoEnabled)}
              >
                {isVideoEnabled ? <Video className="w-4 h-4 mr-2" /> : <VideoOff className="w-4 h-4 mr-2" />}
                Camera
              </Button>
              <Button
                variant={isMicEnabled ? 'default' : 'outline'}
                onClick={() => setIsMicEnabled(!isMicEnabled)}
              >
                {isMicEnabled ? <Mic className="w-4 h-4 mr-2" /> : <MicOff className="w-4 h-4 mr-2" />}
                Microphone
              </Button>
            </div>

            <Button
              className="w-full mt-6"
              size="lg"
              onClick={startInterview}
              disabled={!company.trim()}
            >
              Start Interview
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (state === 'starting') {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-4">
          <Loader2 className="w-12 h-12 animate-spin mx-auto" />
          <p className="text-lg">Preparing your interview...</p>
        </div>
      </div>
    );
  }

  if (state === 'active') {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold">{company} Interview</h1>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {difficulty.charAt(0).toUpperCase() + difficulty.slice(1)} • {interviewType} • Question {questionCount}
            </p>
          </div>
          <Button variant="destructive" onClick={endInterview}>
            End Interview
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            {isVideoEnabled && (
              <Card>
                <CardContent className="p-4">
                  <video
                    ref={videoRef}
                    autoPlay
                    muted
                    className="w-full rounded-lg bg-black"
                    style={{ maxHeight: '400px' }}
                  />
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <MessageSquare className="w-5 h-5 mr-2" />
                  Current Question
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-lg">{currentQuestion}</p>
                {aiSpeaking && (
                  <div className="mt-4 flex items-center text-blue-600">
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    <span className="text-sm">AI is speaking...</span>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Controls</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button
                  variant={isMicEnabled ? 'default' : 'outline'}
                  className="w-full"
                  onClick={toggleMic}
                >
                  {isMicEnabled ? <Mic className="w-4 h-4 mr-2" /> : <MicOff className="w-4 h-4 mr-2" />}
                  {isMicEnabled ? 'Mute' : 'Unmute'}
                </Button>
                {isVideoEnabled && (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={toggleVideo}
                  >
                    {isVideoEnabled ? <Video className="w-4 h-4 mr-2" /> : <VideoOff className="w-4 h-4 mr-2" />}
                    {isVideoEnabled ? 'Hide Camera' : 'Show Camera'}
                  </Button>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Live Transcript</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="max-h-64 overflow-y-auto text-sm">
                  {transcript || 'Start speaking...'}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  if (state === 'processing') {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-4">
          <Loader2 className="w-12 h-12 animate-spin mx-auto" />
          <p className="text-lg">Processing your interview...</p>
          <p className="text-sm text-gray-600">Analyzing responses and generating feedback</p>
        </div>
      </div>
    );
  }

  return null;
}
