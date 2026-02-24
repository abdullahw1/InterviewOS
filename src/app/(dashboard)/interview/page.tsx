'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRecorder } from '@/hooks/useRecorder';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Mic, Square, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import Link from 'next/link';

export default function InterviewPage() {
  const router = useRouter();
  const { isRecording, transcript: liveTranscript, startRecording, stopRecording } = useRecorder();
  
  const [interviewType, setInterviewType] = useState('behavioral');
  const [question, setQuestion] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const handleStartRecording = async () => {
    try {
      await startRecording();
      toast.success('Recording started');
    } catch (error) {
      toast.error('Failed to start recording. Please check microphone permissions.');
    }
  };

  const handleStopRecording = async () => {
    setIsProcessing(true);
    try {
      const { audioBlob, transcript: browserTranscript } = await stopRecording();
      
      // Transcribe using OpenAI
      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.webm');
      
      const transcribeRes = await fetch('/api/interview/transcribe', {
        method: 'POST',
        body: formData,
      });
      
      if (!transcribeRes.ok) {
        throw new Error('Transcription failed');
      }
      
      const { transcript } = await transcribeRes.json();
      const finalTranscript = transcript || browserTranscript || 'No transcript available';
      
      // Grade the interview
      const gradeRes = await fetch('/api/interview/grade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript: finalTranscript,
          interviewType,
          question: question || undefined,
        }),
      });
      
      if (!gradeRes.ok) {
        throw new Error('Grading failed');
      }
      
      const { sessionId } = await gradeRes.json();
      
      toast.success('Interview graded successfully!');
      router.push(`/interview/${sessionId}`);
    } catch (error) {
      console.error('Error processing interview:', error);
      toast.error('Failed to process interview');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">Interview Practice</h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            Record your answer and get AI-powered feedback
          </p>
        </div>
        <Link href="/interview/history">
          <Button variant="outline">View History</Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New Interview Session</CardTitle>
          <CardDescription>
            Select interview type, optionally add a question, then record your answer
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="interview-type">Interview Type</Label>
            <Select value={interviewType} onValueChange={setInterviewType}>
              <SelectTrigger id="interview-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="behavioral">Behavioral</SelectItem>
                <SelectItem value="system_design">System Design</SelectItem>
                <SelectItem value="technical">Technical</SelectItem>
                <SelectItem value="general">General</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="question">Question (Optional)</Label>
            <Textarea
              id="question"
              placeholder="e.g., Tell me about a time when you had to deal with a difficult team member"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              rows={3}
            />
          </div>

          <div className="flex flex-col items-center space-y-4 py-8">
            {!isRecording && !isProcessing && (
              <Button
                size="lg"
                onClick={handleStartRecording}
                className="w-48"
              >
                <Mic className="w-5 h-5 mr-2" />
                Start Recording
              </Button>
            )}

            {isRecording && (
              <>
                <div className="flex items-center space-x-2 text-red-600">
                  <div className="w-3 h-3 bg-red-600 rounded-full animate-pulse" />
                  <span className="font-medium">Recording...</span>
                </div>
                <Button
                  size="lg"
                  variant="destructive"
                  onClick={handleStopRecording}
                  className="w-48"
                >
                  <Square className="w-5 h-5 mr-2" />
                  Stop & Grade
                </Button>
              </>
            )}

            {isProcessing && (
              <div className="flex items-center space-x-2 text-blue-600">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="font-medium">Processing your answer...</span>
              </div>
            )}
          </div>

          {liveTranscript && (
            <div className="mt-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <Label className="text-sm font-medium mb-2 block">Live Transcript:</Label>
              <p className="text-sm text-gray-700 dark:text-gray-300">{liveTranscript}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
