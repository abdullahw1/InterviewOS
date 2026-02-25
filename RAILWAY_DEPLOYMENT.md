# Railway Deployment Guide

## Pre-Deployment Checklist

✅ All fixes applied (see FIXES_APPLIED.md)  
✅ Build passes locally (`npm run build`)  
✅ Database migration created  
✅ Environment variables ready

## Step 1: Push to Git

```bash
git add .
git commit -m "Fix: Build errors, token limits, and schema updates"
git push origin main
```

## Step 2: Railway Environment Variables

Ensure these are set in your Railway project:

```env
# Database (Railway PostgreSQL - already set)
DATABASE_URL=postgresql://...

# NextAuth
NEXTAUTH_SECRET=your-secret-here
NEXTAUTH_URL=https://your-app.up.railway.app

# OpenAI
OPENAI_API_KEY=sk-...

# Admin Credentials
ADMIN_EMAIL=admin@interviewos.com
ADMIN_PASSWORD=your-secure-password

# Optional: Model Overrides
EMBEDDING_MODEL=text-embedding-3-small
ANALYSIS_MODEL=gpt-4o-mini
```

## Step 3: Deploy

Railway will automatically:
1. Detect changes in your repo
2. Run `npm ci` to install dependencies
3. Run `npm run build` to build the app
4. Run database migrations
5. Start the application

## Step 4: Post-Deployment

### 1. Verify Deployment
Visit your Railway URL: `https://your-app.up.railway.app`

### 2. Run Database Seed (if needed)
If this is a fresh deployment:

```bash
# In Railway dashboard, open the shell and run:
npm run db:seed
```

Or manually create admin user through the app.

### 3. Login
- Visit `/login`
- Use your ADMIN_EMAIL and ADMIN_PASSWORD
- Should successfully authenticate

### 4. Index Projects
- Navigate to `/projects/manage`
- Click "Start Indexing"
- Wait 2-5 minutes for completion
- Verify all 5 projects are indexed

### 5. Test Interview
- Navigate to `/interview/live`
- Enter a company name
- Start an interview
- Verify audio transcription works
- Complete the interview
- Check feedback page

## Troubleshooting

### Build Fails with "PrismaClient not found"
**Solution:** Already fixed! The seed file is now excluded from the build.

### Token Limit Errors During Indexing
**Solution:** Already fixed! Text is now truncated to 2000 chars.

### Interview Won't Start
**Possible Causes:**
1. Not logged in - Check authentication
2. OpenAI API key invalid - Verify in Railway env vars
3. Database connection issue - Check DATABASE_URL

**Debug Steps:**
```bash
# In Railway shell:
# Check if Prisma can connect
npx prisma db pull

# Check environment variables
env | grep OPENAI
env | grep DATABASE
```

### Microphone Not Working
This is a browser/client issue, not deployment:
- Ensure HTTPS is enabled (Railway provides this)
- Check browser permissions
- Try different browser (Chrome/Edge recommended)

## Monitoring

### Check Logs
In Railway dashboard:
1. Click on your service
2. Go to "Deployments"
3. Click on latest deployment
4. View logs in real-time

### Common Log Messages

**Good:**
```
✓ Compiled successfully
Server listening on port 3000
Database connected
```

**Needs Attention:**
```
Error: OPENAI_API_KEY not found
Database connection failed
Migration failed
```

## Cost Management

### Railway Costs
- Hobby Plan: $5/month
- Pro Plan: $20/month + usage
- Database: Included in plan

### OpenAI Costs
With fixes applied:
- ~$0.10-0.30 per interview
- ~$0.75-1.50 for initial project indexing
- ~$3-8/month for active use (20 interviews)

### Optimization Tips
1. **Cache embeddings** - Don't re-index unless projects change
2. **Use gpt-4o-mini** - Much cheaper than gpt-4
3. **Limit interview length** - 5-7 questions is optimal
4. **Monitor usage** - Check OpenAI dashboard regularly

## Scaling

### Current Setup
- Single instance
- In-memory conversation state
- Polling-based communication

### For Production Scale
1. **Add Redis:**
   ```bash
   # In Railway, add Redis service
   # Update code to use Redis for state
   ```

2. **Implement WebSocket:**
   - Deploy separate WebSocket server
   - Use Socket.io or similar
   - Real-time bidirectional communication

3. **Database Optimization:**
   - Add indexes for common queries
   - Use connection pooling
   - Consider read replicas

4. **CDN for Static Assets:**
   - Use Vercel or Cloudflare
   - Faster asset delivery
   - Reduced server load

## Backup Strategy

### Database Backups
Railway automatically backs up PostgreSQL:
- Daily backups retained for 7 days
- Manual backups available in dashboard

### Manual Backup
```bash
# Export database
pg_dump $DATABASE_URL > backup.sql

# Import database
psql $DATABASE_URL < backup.sql
```

### Code Backups
- Git repository (primary backup)
- Railway deployment history
- Local development copy

## Security Checklist

✅ HTTPS enabled (Railway default)  
✅ Environment variables secured  
✅ Database password strong  
✅ NEXTAUTH_SECRET is random  
✅ Admin password is strong  
✅ API keys not in code  
✅ CORS configured properly  
✅ Rate limiting considered

## Support

### Railway Issues
- Railway Discord: https://discord.gg/railway
- Railway Docs: https://docs.railway.app
- Railway Status: https://status.railway.app

### Application Issues
- Check logs in Railway dashboard
- Review FIXES_APPLIED.md
- Test locally first
- Check OpenAI API status

## Success Criteria

Your deployment is successful when:

✅ Build completes without errors  
✅ Application loads at Railway URL  
✅ Login works with admin credentials  
✅ Projects can be indexed  
✅ Live interviews can be started  
✅ Audio transcription works  
✅ Feedback is generated and saved  
✅ No console errors in browser  
✅ Database queries are fast  
✅ OpenAI API calls succeed

## Next Steps After Deployment

1. **Test thoroughly:**
   - Run multiple interviews
   - Test different companies
   - Try all difficulty levels
   - Verify feedback quality

2. **Monitor costs:**
   - Check OpenAI usage dashboard
   - Review Railway billing
   - Optimize if needed

3. **Gather feedback:**
   - Use the system yourself
   - Note any issues
   - Track improvement over time

4. **Plan enhancements:**
   - WebSocket implementation
   - Redis for state
   - Additional features
   - UI improvements

---

**Deployment Status:** Ready ✅  
**Last Updated:** February 25, 2026  
**Version:** 2.0.0
