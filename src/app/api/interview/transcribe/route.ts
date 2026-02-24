import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getModelConfig } from '@/lib/config/models';
import { trackedOpenAICall } from '@/lib/services/cost-tracker';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const audioFile = formData.get('audio') as File;

    if (!audioFile) {
      return NextResponse.json(
        { error: 'No audio file provided' },
        { status: 400 }
      );
    }

    const modelConfig = getModelConfig();

    // Convert File to Buffer for OpenAI API
    const buffer = Buffer.from(await audioFile.arrayBuffer());
    const file = new File([buffer], 'audio.webm', { type: 'audio/webm' });

    const transcription = await trackedOpenAICall(
      'interview-transcription',
      modelConfig.transcription,
      async () => {
        return await openai.audio.transcriptions.create({
          file: file,
          model: modelConfig.transcription,
        });
      },
      (result) => ({
        inputTokens: Math.ceil(audioFile.size / 1000), // Approximate
        outputTokens: result.text.split(' ').length,
      })
    );

    return NextResponse.json({ transcript: transcription.text });
  } catch (error) {
    console.error('Transcription error:', error);
    return NextResponse.json(
      { error: 'Failed to transcribe audio' },
      { status: 500 }
    );
  }
}
