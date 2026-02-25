# Live Interview System - Setup Guide

## Quick Start

### 1. Database is Ready ✅
The migration has been applied successfully. Your database now includes:
- Enhanced InterviewSession model with company, difficulty, and skill tracking
- InterviewQuestion model for question-by-question feedback
- ProjectSummary and ProjectChunk models for project embeddings

### 2. Index Your Projects

Visit the projects management page:
```
http://localhost:3000/projects/manage
```

Click "Start Indexing" to create embeddings for your 5 projects:
- defendai
- defendai-agents
- hackathon-projects
- wawsdb
- wozway

This will take 2-5 minutes and only needs to be done once (or when projects change significantly).

### 3. Start Your First Live Interview

Visit the live interview page:
```
http://localhost:3000/interview/live
```

Steps:
1. Enter a company name (e.g., "Google", "Amazon", "Meta")
2. Select difficulty level (Easy, Medium, or Hard)
3. Choose interview type (Behavioral, Technical, System Design, or Mixed)
4. Enable camera and microphone
5. Click "Start Interview"

### 4. During the Interview

- The AI will greet you and ask questions
- Speak naturally - your responses are transcribed in real-time
- The AI will listen and may ask follow-up questions
- You can see a live transcript of what you're saying
- Click "End Interview" when you're done

### 5. Review Your Feedback

After the interview:
- You'll be redirected to a detailed feedback page
- See your overall score and skill breakdown
- Review each question and your response
- Get specific improvement suggestions
- Compare with previous interviews at the same company

## Features

### Company-Specific Interviews
The AI adapts its questions and style based on the company:
- **Google:** Focus on innovation, scalability, and technical depth
- **Amazon:** Leadership principles and STAR method
- **Meta:** Impact and building at scale
- **Microsoft:** Growth mindset and collaboration
- **Apple:** Innovation and user experience
- **Netflix:** High performance and independent decision-making

### Difficulty Levels
- **Easy:** Entry-level questions, fundamentals, basic scenarios
- **Medium:** Mid-level questions, practical experience, trade-offs
- **Hard:** Senior-level questions, complex systems, architecture, leadership

### Skill Tracking
Each interview tracks multiple skills:
- Communication
- Technical depth
- Problem-solving
- Ownership
- Concision
- And more...

### Improvement Over Time
- Compare scores with previous interviews
- See trending indicators (↑ improved, ↓ needs work)
- Get personalized suggestions based on your history
- Track progress toward your goals

## Technical Details

### Voice Processing
- **Transcription:** OpenAI Whisper (real-time, 5-second chunks)
- **Text-to-Speech:** OpenAI TTS (voice: alloy)
- **Audio Format:** WebM recording, MP3 playback

### Project Embeddings
- **Model:** text-embedding-3-small
- **Chunk Size:** 1000 characters per chunk
- **Files Indexed:** Up to 50 most important files per project
- **Search:** Cosine similarity for semantic matching

### Interview AI
- **Model:** GPT-4o-mini
- **Context:** Your resume + project summaries + company info
- **Adaptation:** Questions adjust based on difficulty and company

## Browser Requirements

For the best experience:
- **Chrome** or **Edge** (recommended)
- Microphone access required
- Camera access optional
- Modern browser with MediaRecorder API support

## Cost Estimates

Per interview session (15-30 minutes):
- Transcription: ~$0.05-0.10
- TTS: ~$0.02-0.05
- AI Analysis: ~$0.05-0.15
- **Total:** ~$0.10-0.30 per interview

Project indexing (one-time):
- Embeddings: ~$0.10-0.20 per project
- AI Summaries: ~$0.05-0.10 per project
- **Total:** ~$0.75-1.50 for all 5 projects

## Troubleshooting

### Microphone Not Working
1. Check browser permissions
2. Ensure microphone is not muted
3. Try refreshing the page
4. Check system audio settings

### AI Not Speaking
1. Check browser audio permissions
2. Ensure speakers/headphones are connected
3. Try a different browser
4. Check volume settings

### Transcription Issues
1. Speak clearly and at a moderate pace
2. Reduce background noise
3. Check microphone quality
4. Ensure stable internet connection

### Project Indexing Fails
1. Check that project paths exist
2. Ensure read permissions on directories
3. Check OpenAI API key is valid
4. Review console logs for specific errors

## Next Steps

1. **Run the dev server:**
   ```bash
   npm run dev
   ```

2. **Index your projects:**
   - Visit `/projects/manage`
   - Click "Start Indexing"
   - Wait for completion

3. **Practice interviewing:**
   - Visit `/interview/live`
   - Try different companies and difficulty levels
   - Review your feedback
   - Track your improvement

4. **Iterate and improve:**
   - Focus on areas flagged in feedback
   - Practice regularly
   - Compare scores over time
   - Adjust difficulty as you improve

## Support

For issues or questions:
1. Check the console logs (F12 in browser)
2. Review the API responses in Network tab
3. Check database connection
4. Verify OpenAI API key is valid

## Future Enhancements

Planned features:
- WebSocket server for true real-time communication
- Interview recording playback (audio only)
- Multi-language support
- Custom company interview styles
- Interview scheduling
- Peer comparison and benchmarking
- PDF export of feedback reports

---

**Ready to start?** Visit `/interview/live` and begin your first AI interview!
