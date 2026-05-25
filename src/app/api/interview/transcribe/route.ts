import { NextRequest, NextResponse } from 'next/server';

// Audio transcription requires a speech-to-text service.
// The new drill system uses Vapi/Deepgram for voice transcription.
// This legacy route is not active; re-enable by integrating a STT service.
export async function POST(_request: NextRequest) {
  return NextResponse.json(
    { error: 'Audio transcription is not available. Use the voice drill feature instead.' },
    { status: 501 }
  );
}
