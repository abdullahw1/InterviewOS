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
      interviewType: 'behavioral',
      question: 'Tell me about a time when you had to deal with a difficult team member.',
      transcript: 'Sample transcript for behavioral question...',
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
      overallScore: 3.5,
    },
    {
      interviewType: 'system_design',
      question: 'Design a URL shortening service like bit.ly',
      transcript: 'Sample transcript for system design question...',
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
      overallScore: 3.75,
    },
    {
      interviewType: 'technical',
      question: 'Implement a function to reverse a linked list',
      transcript: 'Sample transcript for technical question...',
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
      overallScore: 4.75,
    },
    {
      interviewType: 'behavioral',
      question: 'Describe a situation where you had to make a difficult technical decision.',
      transcript: 'Sample transcript for leadership question...',
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
      overallScore: 3.6,
    },
    {
      interviewType: 'general',
      question: 'Why do you want to work at our company?',
      transcript: 'Sample transcript for general question...',
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
