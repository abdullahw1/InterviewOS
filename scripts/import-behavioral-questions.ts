/**
 * One-off script: import the user's curated behavioral questions from
 * `behavior questions reka.txt` into the QuestionBankEntry table.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/import-behavioral-questions.ts
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

type Entry = {
  prompt: string;
  modelAnswer: string;
};

// Each entry is: question prompt + STAR-formatted model answer.
const entries: Entry[] = [
  {
    prompt: 'Tell me about yourself.',
    modelAnswer:
      "S: I'm Abdullah, an AI Infrastructure Engineer at DefendAI, a startup building security for enterprise LLM deployments.\n\nT: My job is to build the systems that sit between applications and LLMs — intercepting, inspecting, and enforcing security policies on every prompt and response in real time.\n\nA: I've built everything from custom Lua plugins in Apache APISIX for real-time traffic interception, to a Python SDK published on PyPI, to a multi-tenant provisioning system, to LangChain-powered autonomous agents — all deployed on Kubernetes across AWS and Azure.\n\nR: The platform now processes millions of daily LLM requests across 6 providers with sub-50ms policy evaluation, and I've also built InterviewOS (a voice-based AI interview coach) and an edge AI attendance system using computer vision on NVIDIA Jetson Nano.",
  },
  {
    prompt: "Tell me about a project you're most proud of.",
    modelAnswer:
      'S: At DefendAI, enterprises were adopting LLMs with zero visibility into what sensitive data was being sent to models or what harmful content was coming back.\n\nT: I was responsible for building Wozway — an open-source LLM security gateway that makes it simple for companies to secure their LLM traffic.\n\nA: I wrote a custom Lua plugin for Apache APISIX that intercepts every POST to OpenAI-compatible endpoints, extracts the prompt, injects tenant context, and reroutes to our verdict engine; I built the multi-tenant provisioning CLI with OTP verification and Jinja2-templated Docker Compose generation; I shipped a one-command Helm deployment system integrating OpenWebUI + AI Gateway; and I published a typed Python SDK to PyPI so developers only need to change their `base_url`.\n\nR: Wozway scales to 10M+ req/s, was adopted by 2 enterprise customers, reduced tenant onboarding from days to under 5 minutes, and I served as forward-deployed engineer resolving on-call incidents at customer sites.',
  },
  {
    prompt: 'Tell me about a challenging technical problem you solved.',
    modelAnswer:
      'S: At DefendAI, our multi-agent framework had 8+ agents that each needed persistent memory and context, but the memory was tightly coupled to whichever LLM we were using — so every time we swapped a model (GPT-4o to Llama, Mistral, etc.), the agents lost all their accumulated context.\n\nT: I needed to build a model-agnostic memory layer so agents could retain and share knowledge regardless of which LLM was powering them.\n\nA: I designed a shared memory architecture using PGVector in PostgreSQL — each agent stores its important context (meeting notes, documents, conversation history) as embeddings via `text-embedding-3-large` into tenant-scoped collections, with metadata filtering (date ranges, source files, user scopes) so retrieval stays precise; the key decision was decoupling the embedding/storage layer from the inference layer, so at query time any agent\'s RAG chain can pull from the same vector store and pipe the retrieved context into whatever LLM is configured — GPT-4o, a fine-tuned Llama, or Mistral — without any migration or re-indexing.\n\nR: This meant we could hot-swap models per agent without losing any accumulated knowledge, which was critical when we fine-tuned our own Llama 3 and Mistral models — the agents immediately had access to months of stored context, and it also enabled cross-agent knowledge sharing where the PMO agent\'s meeting memory could be queried by the research agent.',
  },
  {
    prompt: "Tell me about a time you failed or something didn't work.",
    modelAnswer:
      "S: Early on at DefendAI, I built the admin service config script to register APISIX routes on startup, but it had a race condition — the script would fire curl commands before the gateway was actually ready.\n\nT: I needed to make the bootstrap process reliable so tenants wouldn't start with a broken gateway.\n\nA: I added a retry loop with health checks (up to 10 attempts with 5-second sleeps) that polls the gateway before registering any routes, and I restructured the entrypoint to fail gracefully with clear logging instead of silently misconfiguring.\n\nR: This eliminated the flaky startup issue entirely, and I learned to always design for service dependency ordering in containerized environments — never assume another container is ready just because Docker says it started.",
  },
  {
    prompt: 'Tell me about a time you had to learn something quickly.',
    modelAnswer:
      'S: When I joined DefendAI, the applications were deployed on a local server using docker.\n\nT: I needed to move the applications to kubernetes and create a database, deploy ec2 instances, and make the applications accessible from outside.\n\nA: I managed to learn kubernetes and aws relatively quick and created a cluster in eks, researched and created the ec2 instances, created an RDS db, and load balancer, deploying everything and making sure everything was accessible within 3 weeks.\n\nR: Within three weeks I had a production-ready system with the ability to handle thousands of users.',
  },
  {
    prompt: 'Describe a time you debugged a difficult issue.',
    modelAnswer:
      "S: In the DefendAI multi-agent framework, the PMO agent's RAG pipeline was returning irrelevant meeting notes when users asked about recent project status.\n\nT: I needed to figure out why semantic search was pulling old, unrelated documents instead of the most recent meetings.\n\nA: I traced the issue to missing date metadata on document chunks — embeddings were semantically similar but temporally wrong — so I built a multi-fallback date extraction pipeline (content parsing → filename parsing → file stats) and added temporal metadata filtering with a configurable `weeks_back` cutoff to the PGVector similarity search.\n\nR: Query relevance improved dramatically, and the PMO agent became the most-used internal tool — the team actually trusted its answers for standup prep.",
  },
  {
    prompt: 'Tell me about a time you made a wrong technical decision.',
    modelAnswer:
      "S: For DefendAI's PMO agent, I tried using n8n for creating agents but it didn't work well for our use case.\n\nT: I needed real-time back-and-forth between the user's voice input and the AI interviewer's responses.\n\nA: I spent time setting up WebSocket infrastructure, but realized the complexity was overkill for the use case — the latency bottleneck was OpenAI's API, not the transport layer — so I pivoted to a simple 3-second polling approach that was 10x simpler to implement and debug.\n\nR: The polling approach shipped in a fraction of the time with negligible UX difference, and it taught me to always identify the actual bottleneck before over-engineering the transport layer.",
  },
  {
    prompt: 'How do you approach an ambiguous problem?',
    modelAnswer:
      'S: When DefendAI needed to support "anonymization" as a policy verdict (not just block/allow), there was no clear spec on what anonymization meant across different data types and LLM providers.\n\nT: I needed to define and implement the anonymization pipeline for the verdict engine\'s 210 response code.\n\nA: I started by cataloging the data types we needed to handle (SSN, credit cards, emails, phone numbers), researched Microsoft Presidio for PII detection, prototyped a redaction pipeline, then worked backwards from the Lua plugin to figure out how to swap the response body mid-stream with the anonymized version.\n\nR: We shipped a working anonymization pipeline that handles the most common PII types, and the approach of "catalog → prototype → integrate" became my go-to for ambiguous problems.',
  },
  {
    prompt: 'Tell me about a time you improved performance, reliability, or scalability.',
    modelAnswer:
      "S: At DefendAI, our first-gen proxy (Wozway) only intercepted traffic at the gateway level with Lua — it could route and do basic checks, but it couldn't do deep content inspection like regex scanning, PII anonymization, similarity search against malicious prompts, or code injection detection on both prompts AND responses.\n\nT: I needed to build WAWSDB — a dedicated FastAPI-based verdict engine that could run multiple detection layers in parallel on every request and response, with much higher accuracy than the gateway-only approach.\n\nA: I built WAWSDB as a Python service with a concurrent policy evaluation pipeline — each incoming prompt gets checked against all active tenant policies in parallel using a ThreadPoolExecutor, running regex scanners, code detection, banned topic classification, phishing URL detection, PII anonymization via Presidio, and similarity search against a database of known malicious prompts using sentence-transformers; critically, I also built a full response checker that runs the same pipeline on LLM outputs, so we inspect both directions — and I added a cross-encoder memory manager that scores conversation relevance so agents maintain context across sessions.\n\nR: WAWSDB replaced the gateway-only approach and became the core of our security platform — it supported 7 LLM providers (OpenAI, Anthropic, Groq, Google, DeepSeek, HuggingFace, Ollama) with bidirectional inspection, and the parallel policy evaluation meant adding new detection types didn't increase latency linearly, which directly contributed to the ~40% reduction in security failures.",
  },
  {
    prompt: 'Describe a time you had to balance speed vs correctness.',
    modelAnswer:
      "S: At DefendAI, our memory manager used a cross-encoder model (ms-marco-MiniLM) to score relevance between the current query and all stored conversation history before injecting context into the agent's prompt — but as conversation history grew, this scoring step was taking 3-5 seconds per query, making the agents feel sluggish.\n\nT: I needed to keep the context quality high (agents gave bad answers without relevant history) while getting response times under a second.\n\nA: I made three tradeoffs: first, I capped the memory window to the top 3 most relevant items instead of scoring everything, which cut compute by 80%; second, I set a relevance threshold (0.5) so low-quality context never gets injected even if it's the \"best\" match — better to have no context than bad context; third, I added an LRU cache on the context loader so repeated tenant lookups don't hit the database, and I limited the retriever to k=6-8 results with metadata date filters so the vector search itself stays fast.\n\nR: Agent response time dropped from 5+ seconds to under 1.5 seconds while answer quality actually improved — because injecting only high-relevance context turned out to be better than dumping everything in, and the lesson was that constraints on context often improve output quality, not just speed.",
  },
  {
    prompt: 'Tell me about a time you took ownership of something end-to-end.',
    modelAnswer:
      'S: At DefendAI, we had application code but no production infrastructure — no CI/CD, no container registry, no Kubernetes clusters, no monitoring, nothing deployed to the cloud.\n\nT: I took ownership of the entire infrastructure layer — from setting up cloud accounts to getting production traffic flowing.\n\nA: I set up hybrid-cloud Kubernetes clusters on both AWS EKS and Azure AKS, built CI/CD pipelines in GitLab CI and GitHub Actions that build Docker images and push to container registries (GCP Artifact Registry, Azure ACR, AWS ECR), created Helm charts for the full stack (APISIX, WAWSDB, admin service, OpenWebUI), configured NGINX reverse proxies, deployed the observability stack (Grafana, Prometheus, OpenTelemetry), managed PostgreSQL with PGVector, and even got our product listed on the AWS Marketplace — all while being the one who gets paged when something breaks in production.\n\nR: I went from zero infrastructure to a production platform running at 99.9% uptime with automated deployments, and because I built it all, I was the fastest person to diagnose any issue — which is why I naturally became the forward-deployed engineer at customer sites.',
  },
  {
    prompt: 'Describe a situation where you went beyond your responsibilities.',
    modelAnswer:
      "S: At DefendAI, my role was platform engineering — building the gateway, agents, and infra — but because I'd set up all the infrastructure, I was the only person who understood the full production stack.\n\nT: When we onboarded our first enterprise customers, there was no dedicated support or SRE team, so customer issues had nowhere to go.\n\nA: I stepped into the forward-deployed engineer role on my own — I joined customer on-call rotations, debugged their integration issues live, triaged production incidents at their sites, and built runbooks so future issues could be resolved without me; I was simultaneously doing DevOps, SRE, customer support, and development because at a startup with 2 enterprise customers, someone has to.\n\nR: Both enterprise customers renewed, largely because they trusted that issues would get resolved fast — and the experience of being customer-facing fundamentally changed how I build systems, because I now design for operability first, not just functionality.",
  },
  {
    prompt: 'Tell me about a time you identified a problem before anyone asked you to.',
    modelAnswer:
      "S: While testing Wozway's rate limiting in production, I noticed that the APISIX-level rate limiter was only tracking requests by IP address — meaning a single user could spin up multiple machines and bypass the limit entirely.\n\nT: This was a security gap nobody had flagged, but it would let bad actors flood our system or abuse LLM API quotas.\n\nA: I implemented a secondary rate limiting layer that identifies machines by generating a unique fingerprint from the system's hardware attributes (MAC address, hostname, OS info) via SHA-256 hashing — this gets sent as part of the tenant registration and is validated on every request, so even if someone changes their IP, the machine fingerprint stays consistent and the rate limit holds.\n\nR: This closed a real abuse vector before any customer hit it, and the machine fingerprinting approach was later reused in our license key generation system for tenant provisioning.",
  },
  {
    prompt: 'Have you ever worked on something without clear direction? What did you do?',
    modelAnswer:
      "S: When I joined DefendAI, nobody on the team had cloud or DevOps experience — we had application code but zero infrastructure knowledge, and I'd never touched Kubernetes, Helm, or cloud deployments before.\n\nT: I needed to figure out how to get our entire platform deployed to production on my own, with no mentor and no playbook.\n\nA: I taught myself Kubernetes from scratch — starting with local minikube, then progressing to managed clusters on AWS EKS and Azure AKS; I learned Helm by writing charts for our own services, figured out CI/CD by building GitLab CI and GitHub Actions pipelines, set up NGINX reverse proxies, configured TLS certificates, deployed observability with Grafana and Prometheus, and eventually got our product listed on the AWS Marketplace with a one-command Helm install — all self-directed.\n\nR: I went from zero cloud knowledge to owning the entire production infrastructure for a startup with enterprise customers in under 6 months, and the AWS Marketplace listing became a key sales channel — the lesson was that the fastest way to learn infrastructure is to be the person responsible for keeping production alive.",
  },
  {
    prompt: 'Tell me about a time you disagreed with a teammate.',
    modelAnswer:
      "S: At DefendAI, the founding engineer wanted us to use LangGraph for our multi-agent orchestration because it was newer and had built-in state management and graph-based workflows.\n\nT: I believed LangChain's simpler chain-based approach was better for our use case — our agents were independent specialists (PMO, research, CTO), not nodes in a complex workflow graph, and LangGraph's overhead wasn't justified.\n\nA: Since he was senior, I didn't just push back — I proposed we prototype both approaches in parallel; I built the LangChain version with a query orchestrator and intent classifier routing to independent agents, while he built the LangGraph version with a state graph; after a week, we compared on three criteria: development speed, debuggability, and how easy it was to add a new agent.\n\nR: LangChain won on all three — adding a new agent was just writing a class and registering it in the router, versus rewiring the entire state graph — and the founding engineer agreed; the experience taught me that the best way to win a technical disagreement with a senior engineer is to let the code speak for itself.",
  },
  {
    prompt: 'Describe a time you received critical feedback.',
    modelAnswer:
      'S: After my first technical interview at a company I really wanted, the interviewer told me I clearly knew the concepts but couldn\'t articulate them under pressure — I blanked on things I use daily.\n\nT: I needed to fix the gap between what I know and what I can communicate in high-pressure situations.\n\nA: I built an entire interview prep system: a quiz app with timed responses, recorded myself answering questions and watched them back, practiced the "30-second rule" (start talking within 30 seconds, no matter what), and ultimately built InterviewOS to automate the practice loop with AI feedback.\n\nR: My interview performance improved dramatically — I went from freezing up to confidently walking through architectures I\'ve built, and the experience taught me that communication is a skill you train, not a talent you have.',
  },
  {
    prompt: 'Tell me about a time you had to explain something technical to a non-technical person.',
    modelAnswer:
      'S: We had a marketing customer who was evaluating DefendAI but couldn\'t understand what our AI agents actually did or why they needed guardrails — they kept asking "but why can\'t I just use ChatGPT directly?"\n\nT: I needed to explain the value of our guardrail system and agent framework in terms a marketing team would care about.\n\nA: I dropped the technical jargon entirely and framed it around their world: "Imagine your marketing team uses an AI assistant to draft campaigns — without guardrails, someone could accidentally paste customer PII into the prompt and it goes straight to OpenAI\'s servers; our system reads every message before it leaves your network, catches the PII, anonymizes it, and still gives you the AI response — plus our agents can be trained on your brand guidelines so they won\'t generate off-brand content"; then I did a live demo where I typed a fake customer email with a credit card number and showed it getting redacted in real time.\n\nR: The customer signed up that week, and the "your data never leaves unprotected" framing became our go-to pitch for non-technical buyers — I learned that the best technical explanations start with the customer\'s fear, not your architecture.',
  },
  {
    prompt: 'How do you handle working with more senior engineers?',
    modelAnswer:
      "S: At DefendAI, the founding engineers were former Palo Alto Networks engineers with deep expertise in network security, proxies, and API gateways — they'd been building security infrastructure for 15+ years.\n\nT: I needed to contribute meaningfully to a codebase built by people who knew proxies and security at a level I hadn't reached yet.\n\nA: I leaned into what they knew that I didn't — I asked them to explain the \"why\" behind architectural decisions (why APISIX over Envoy, why Lua over Go for plugins, why etcd for config), and I'd take those principles and apply them independently; I never asked \"how do I implement X\" — I'd prototype it first, then bring it for review so the conversation was about tradeoffs, not tutorials.\n\nR: Within a few months they trusted me enough to delegate entire subsystems — the SDK, the provisioning system, the agent platform, and eventually the full infrastructure — and the security-first mindset I absorbed from them fundamentally shaped how I build everything now.",
  },
  {
    prompt: 'Tell me about a time you asked for help.',
    modelAnswer:
      "S: When I was building the custom Lua plugin for APISIX, I kept hitting issues with the plugin lifecycle — my `body_filter` wasn't accumulating response chunks correctly and requests were hanging.\n\nT: I'd spent two days reading OpenResty docs and debugging, but APISIX's plugin phases (access → body_filter → header_filter → log) have subtle ordering dependencies that aren't well-documented.\n\nA: I went to the senior engineers (the former Palo Alto guys) with a specific ask — not \"help me write this\" but \"here's my plugin, here's the behavior I'm seeing, here's what I think the phase ordering should be, can you tell me what I'm misunderstanding about how APISIX buffers responses\"; I showed them my code, my test cases, and the logs.\n\nR: They pointed out that I was trying to modify the response in `header_filter` before `body_filter` had finished accumulating — a phase ordering issue that's a known APISIX gotcha; the fix took 20 minutes, and the structured way I asked meant I actually understood the fix instead of just copy-pasting it.",
  },
  {
    prompt: 'Tell me about a time you were under a tight deadline.',
    modelAnswer:
      'S: DefendAI had a demo scheduled with an enterprise prospect in 3 days, and the tenant provisioning system was still manual — requiring SSH access and hand-editing config files.\n\nT: I needed to build a one-command provisioning experience before the demo.\n\nA: I prioritized ruthlessly: built the Jinja2 templating for Docker Compose first (most visible), then the registration flow with hardcoded defaults as fallback, then the auto-browser-launch on health check — skipping nice-to-haves like config validation and error recovery.\n\nR: The demo went flawlessly — the prospect ran `python start_tenant.py` and had a secured chat interface in 4 minutes — and I backfilled the error handling and validation the following week.',
  },
  {
    prompt: 'Describe a time you were overwhelmed or stuck.',
    modelAnswer:
      "S: When I first looked at the DefendAI codebase, there were 7+ repositories (frontend, backend, gateway, verdict engine, agents, proxy, deployment) with no documentation and intertwined dependencies.\n\nT: I needed to become productive across the entire stack without a proper onboarding.\n\nA: I drew the architecture diagram myself by tracing request flows through the code, starting from the frontend and following a single request all the way to the LLM and back — documenting every service, port, and API call along the way.\n\nR: That architecture diagram became the team's reference document, and the exercise of tracing the full request path gave me deeper understanding of the system than anyone who'd only worked on one piece.",
  },
  {
    prompt: 'Tell me about a time you had to juggle multiple priorities.',
    modelAnswer:
      "S: At DefendAI, I was simultaneously the DevOps engineer, SRE, PM for infrastructure tasks, application developer, customer-facing support engineer, and database administrator — all at once, because we were a small startup with enterprise customers.\n\nT: Every hat had urgent demands: customers needed production fixes, the team needed new features, infrastructure needed maintenance, and the database needed optimization.\n\nA: I built a personal triage system: production incidents first (customer-facing, revenue-blocking), then customer integration support (they're waiting), then infrastructure maintenance (prevents future fires), then feature development (moves the product forward); I also automated everything I could — CI/CD pipelines so deploys don't need me, monitoring alerts so I catch issues before customers do, and runbooks so common problems have documented fixes.\n\nR: I maintained 99.9% uptime while shipping features, supporting customers, and managing infra — and the automation I built out of necessity meant that by the end, most of the operational work ran itself, freeing me to focus on higher-leverage engineering work.",
  },
  {
    prompt: 'Tell me about a stressful production issue or outage.',
    modelAnswer:
      'S: We were in the middle of a live demo with an enterprise client — showing them the full flow of prompt interception, policy enforcement, and anonymization — when the system started returning 500 errors on every request.\n\nT: The client was watching, the sales team was panicking, and I needed to get it working in minutes, not hours.\n\nA: I jumped on a call with a teammate, split the debugging — I checked the WAWSDB verdict engine logs while he checked the APISIX gateway; I found that the database connection pool had been exhausted because a recent code change wasn\'t releasing connections properly in the policy evaluator\'s ThreadPoolExecutor; I patched the connection cleanup, restarted the service, and verified the full flow was working — all while the sales team kept the client engaged with the dashboard and architecture slides.\n\nR: We were back up in under 8 minutes, the client actually said "that\'s impressive response time," and the demo continued successfully — afterwards I added connection pool monitoring to our Grafana dashboards and a health check endpoint that validates DB connectivity before accepting traffic.',
  },
  {
    prompt: 'Why do you want to work here?',
    modelAnswer:
      "S: I've spent the last year and a half building AI products for enterprise customers — from LLM gateways to multi-agent frameworks to fine-tuning open-source models — and what excites me most is the customer-facing side: taking a model and making it solve a real problem for a real business.\n\nT: I want to be at a company where I'm working directly with frontier models AND directly with customers integrating them — not just one or the other.\n\nA: Reka is exactly that intersection — you're building your own foundation models (Core, Flash, Edge) and you need people who can productionize them for real-world use cases; my experience fine-tuning Llama and Mistral, building multi-agent systems, and being a forward-deployed engineer at customer sites maps directly to the \"Applied AI\" role, and I'm especially drawn to the multimodal focus because our WAWSDB verdict engine already handles image and PDF inputs alongside text.\n\nR: I want to go deeper into the model layer — working alongside researchers from DeepMind and FAIR — while bringing my production engineering and customer-facing experience to help Reka's models actually land in the real world.",
  },
  {
    prompt: 'What kind of problems excite you?',
    modelAnswer:
      'S: I get most excited when I\'m taking AI and integrating it into an industry or workflow where it hasn\'t been applied before — the "zero to one" of making a model useful in a new domain.\n\nT: The challenge isn\'t just the model — it\'s understanding the customer\'s problem deeply enough to know what the model needs to do and how to make it reliable.\n\nA: At DefendAI, I took LLMs and applied them to cybersecurity — building agents that do red-teaming, guardrail generation, and threat detection in a domain where AI hadn\'t been used that way before; the hardest part wasn\'t the model work, it was understanding what security teams actually need and translating that into agent behavior and policy logic.\n\nR: That intersection of "new domain + AI + customer obsession" is what I want to keep doing — I\'d rather build something that changes how an industry works than optimize an existing pipeline by 5%.',
  },
  {
    prompt: 'What are your biggest weaknesses as an engineer?',
    modelAnswer:
      'S: Early on at DefendAI, I had a bad habit of not asking for help — I didn\'t want to look like a liability or like I couldn\'t handle things, so I\'d spend days stuck on something instead of asking a 15-minute question.\n\nT: I also tended to rush implementations to show progress, which sometimes meant shipping things that needed immediate follow-up fixes.\n\nA: I forced myself to adopt a rule: if I\'m stuck for more than 2 hours with no progress, I write up what I\'ve tried and bring it to someone — framed as "here\'s my analysis" not "I\'m lost"; for the rushing problem, I started doing a 10-minute "pre-flight check" before every PR where I ask myself "what will break if this goes to production right now?"\n\nR: Both habits have improved significantly — I now ask for help faster (which my teammates actually appreciate), and my PRs need fewer follow-up fixes; but I\'m still conscious of the instinct to power through alone, so I actively fight it.',
  },
  {
    prompt: 'What skills are you currently working to improve?',
    modelAnswer:
      "S: I'm strong on building and shipping, but I've realized that I sometimes explain my work in a way that's too abstract or too technical — I lose non-technical stakeholders and even some engineers who aren't in my specific domain.\n\nT: I need to get better at articulating complex systems in simple, concrete terms that anyone can follow.\n\nA: I've been practicing by writing documentation that a new engineer could follow without asking me questions, doing \"explain it to me like I'm a PM\" exercises with teammates, and I built InterviewOS partly to force myself to practice articulating my work out loud under pressure — because if I can't explain what I built clearly, it doesn't matter how good it is.\n\nR: It's getting better — my recent customer demos have been much clearer — but it's an ongoing practice, and I think it's the highest-leverage skill I can improve because great communication multiplies the impact of everything else I do.",
  },
  {
    prompt: 'Tell me about a time you received negative feedback and acted on it.',
    modelAnswer:
      "S: While setting up TLS certificates for our production domain, I used an AI-assisted tool to generate the cert configuration, and I accidentally misconfigured it in a way that left our website exposed — the cert wasn't properly chaining to the root CA, so browsers showed security warnings and the connection wasn't actually encrypted end-to-end.\n\nT: A teammate caught it and flagged it immediately — at a security company, having an insecure website is about the worst look possible.\n\nA: I fixed the cert chain within the hour, but the bigger lesson was about blindly trusting AI-generated configurations for security-critical paths; I implemented a personal rule: for anything involving certs, secrets, or auth, I manually verify every line against the official docs regardless of how it was generated — and I added a post-deployment TLS validation check to our CI/CD pipeline that uses `openssl s_client` to verify the full cert chain before marking a deploy as successful.\n\nR: We never had a cert issue again, and the experience made me much more careful about the boundary between \"AI-assisted\" and \"AI-trusted\" — especially for security configurations where a subtle mistake can silently compromise everything.",
  },
  {
    prompt: 'Tell me about a time you made a mistake that affected others.',
    modelAnswer:
      'S: I pushed a config change to the Wozway Docker Compose template that accidentally hardcoded a default API key, meaning new tenants were sharing credentials.\n\nT: I needed to fix the security issue and prevent it from happening again.\n\nA: I immediately reverted the change, rotated the exposed key, audited which tenants were affected, notified them, and then added a validation step in `start_tenant.py` that checks for placeholder values and refuses to proceed if real credentials aren\'t provided.\n\nR: No data was compromised because the key only had demo-tier access, but I learned to always treat credential handling as a security-critical code path that needs explicit validation, not just "it should work."',
  },
  {
    prompt: 'Describe a time you had to make a difficult or uncomfortable decision.',
    modelAnswer:
      'S: At DefendAI, I realized our AI agents were storing conversation history with potentially sensitive client data in the vector store without encryption or access controls.\n\nT: Raising this meant admitting the system I built had a security gap, and fixing it would delay the feature launch.\n\nA: I flagged it immediately to the team, proposed a fix (encrypted storage + tenant-scoped collections + TTL on conversation history), and volunteered to implement it myself even though it pushed the launch back by a week.\n\nR: The team appreciated the transparency, the fix shipped before any client data was at risk, and it reinforced that at a security company, you can never cut corners on security — even internally.',
  },
];

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  const adminEmail = process.env.ADMIN_EMAIL || 'admin@interviewos.com';
  const user = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!user) {
    throw new Error(`User ${adminEmail} not found. Run prisma seed first.`);
  }

  console.log(`Importing ${entries.length} behavioral questions for ${user.email}...`);

  let created = 0;
  for (const e of entries) {
    // Skip duplicates by exact prompt match
    const existing = await prisma.questionBankEntry.findFirst({
      where: { userId: user.id, prompt: e.prompt },
    });
    if (existing) {
      console.log(`  - skip (exists): ${e.prompt.slice(0, 60)}`);
      continue;
    }
    await prisma.questionBankEntry.create({
      data: {
        userId: user.id,
        questionType: 'Behavioral',
        prompt: e.prompt,
        modelAnswer: e.modelAnswer,
        rubric: null,
        tags: [],
        difficultyTier: 'Medium',
      },
    });
    created++;
    console.log(`  + ${e.prompt.slice(0, 60)}`);
  }

  console.log(`\nDone. Created ${created} new entries.`);
  await prisma.$disconnect();
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
