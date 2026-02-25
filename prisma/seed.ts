import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as bcrypt from 'bcryptjs';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('Starting seed...');

  // Read admin credentials from environment
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@interviewos.com';
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

  // Hash the password
  const passwordHash = await bcrypt.hash(adminPassword, 10);

  // Upsert admin user
  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: { passwordHash },
    create: {
      email: adminEmail,
      passwordHash,
    },
  });

  console.log(`Admin user created/updated: ${admin.email}`);

  // Seed 5 sample interview questions
  const sampleQuestions = [
    {
      company: 'Sample Company',
      difficulty: 'medium',
      interviewType: 'behavioral',
      duration: 900,
      transcript: 'Sample transcript for behavioral question...',
      skillScores: {
        clarity: 4,
        structure: 3,
        ownership: 4,
        concision: 3,
      },
      feedback: {
        scores: {
          clarity: 4,
          structure: 3,
          technical_depth: 0,
          ownership: 4,
          concision: 3,
        },
        overall: 3.5,
        red_flags: [],
        missing_resume_signal: [],
        improved_answer: 'A more structured answer using STAR method...',
        followups: ['How did you resolve the conflict?'],
        drills: ['Practice STAR method responses'],
      },
      suggestions: 'Good ownership. Work on structure and concision.',
      improvementAreas: {
        'Structure': 'Use STAR method more consistently',
      },
      overallScore: 3.5,
    },
    {
      company: 'Sample Company',
      difficulty: 'hard',
      interviewType: 'system_design',
      duration: 1800,
      transcript: 'Sample transcript for system design question...',
      skillScores: {
        clarity: 4,
        structure: 4,
        technical_depth: 3,
        concision: 4,
      },
      feedback: {
        scores: {
          clarity: 4,
          structure: 4,
          technical_depth: 3,
          ownership: 0,
          concision: 4,
        },
        overall: 3.75,
        red_flags: ['Did not discuss database sharding'],
        missing_resume_signal: [],
        improved_answer: 'A comprehensive system design with load balancing...',
        followups: ['How would you handle 1 billion requests per day?'],
        drills: ['Study database sharding patterns'],
      },
      suggestions: 'Good structure. Improve technical depth on scalability.',
      improvementAreas: {
        'Scalability': 'Study database sharding and load balancing',
      },
      overallScore: 3.75,
    },
    {
      company: 'Sample Company',
      difficulty: 'medium',
      interviewType: 'technical',
      duration: 1200,
      transcript: 'Sample transcript for technical question...',
      skillScores: {
        clarity: 5,
        structure: 4,
        technical_depth: 5,
        concision: 5,
      },
      feedback: {
        scores: {
          clarity: 5,
          structure: 4,
          technical_depth: 5,
          ownership: 0,
          concision: 5,
        },
        overall: 4.75,
        red_flags: [],
        missing_resume_signal: [],
        improved_answer: 'Excellent implementation with edge case handling...',
        followups: ['Can you do it recursively?'],
        drills: ['Practice more linked list problems'],
      },
      suggestions: 'Excellent technical skills. Keep practicing.',
      improvementAreas: {},
      overallScore: 4.75,
    },
    {
      company: 'Sample Company',
      difficulty: 'medium',
      interviewType: 'behavioral',
      duration: 900,
      transcript: 'Sample transcript for leadership question...',
      skillScores: {
        clarity: 3,
        structure: 3,
        technical_depth: 4,
        ownership: 5,
        concision: 3,
      },
      feedback: {
        scores: {
          clarity: 3,
          structure: 3,
          technical_depth: 4,
          ownership: 5,
          concision: 3,
        },
        overall: 3.6,
        red_flags: [],
        missing_resume_signal: ['Could mention specific metrics or outcomes'],
        improved_answer: 'Include quantifiable impact of your decision...',
        followups: ['What would you do differently?'],
        drills: ['Prepare stories with measurable outcomes'],
      },
      suggestions: 'Strong ownership. Work on clarity and structure.',
      improvementAreas: {
        'Clarity': 'Be more concise',
        'Metrics': 'Include quantifiable outcomes',
      },
      overallScore: 3.6,
    },
    {
      company: 'Sample Company',
      difficulty: 'easy',
      interviewType: 'general',
      duration: 600,
      transcript: 'Sample transcript for general question...',
      skillScores: {
        clarity: 4,
        structure: 4,
        ownership: 3,
        concision: 4,
      },
      feedback: {
        scores: {
          clarity: 4,
          structure: 4,
          technical_depth: 0,
          ownership: 3,
          concision: 4,
        },
        overall: 3.75,
        red_flags: [],
        missing_resume_signal: ['Research company values more deeply'],
        improved_answer: 'Connect your experience to company mission...',
        followups: ['What specific team interests you?'],
        drills: ['Research target companies thoroughly'],
      },
      suggestions: 'Good general response. Research companies more deeply.',
      improvementAreas: {
        'Company Research': 'Understand company values better',
      },
      overallScore: 3.75,
    },
  ];

  for (const question of sampleQuestions) {
    await prisma.interviewSession.create({
      data: question,
    });
  }

  console.log(`Seeded ${sampleQuestions.length} sample interview questions`);
  console.log('Seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('Error during seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
