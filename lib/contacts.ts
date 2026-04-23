/**
 * Mock contacts database for testing
 */

export interface Contact {
  id: string;
  name: string;
  title: string;
  organization: string;
  summary?: string;
  skills?: string[];
  experience?: string;
  email: string;
}

// Mock contact database
const CONTACTS: Contact[] = [
  {
    id: "U001",
    name: "Alice Chen",
    title: "Senior ML Engineer",
    organization: "Google",
    summary: "Specialist in NLP and transformers, 8 years experience",
    skills: ["Python", "NLP", "TensorFlow", "PyTorch", "Transformers"],
    experience: "Built recommendation systems and NLP models at scale",
    email: "alice.chen@example.com",
  },
  {
    id: "U002",
    name: "Bob Martinez",
    title: "Full Stack Engineer",
    organization: "Meta",
    summary: "Expert in backend systems and API design",
    skills: ["Node.js", "TypeScript", "GraphQL", "PostgreSQL", "DevOps"],
    experience: "Designed and scaled backend infrastructure for millions of users",
    email: "bob.martinez@example.com",
  },
  {
    id: "U003",
    name: "Carol Williams",
    title: "Product Manager",
    organization: "Stripe",
    summary: "Specialist in developer platforms and API products",
    skills: ["Product Strategy", "Technical Communication", "Partnerships"],
    experience: "Launched multiple developer-facing products",
    email: "carol.williams@example.com",
  },
  {
    id: "U004",
    name: "Diego Rodriguez",
    title: "Data Scientist",
    organization: "OpenAI",
    summary: "Expert in large language models and prompt engineering",
    skills: ["LLMs", "Prompt Engineering", "Python", "ML Ops"],
    experience: "Worked on scaling LLM inference and optimization",
    email: "diego.rodriguez@example.com",
  },
  {
    id: "U005",
    name: "Emma Thompson",
    title: "DevOps Engineer",
    organization: "AWS",
    summary: "Infrastructure and deployment automation specialist",
    skills: ["Kubernetes", "Docker", "AWS", "Terraform", "CI/CD"],
    experience: "Managed infrastructure for enterprise-scale applications",
    email: "emma.thompson@example.com",
  },
  {
    id: "U006",
    name: "Frank Johnson",
    title: "Frontend Engineer",
    organization: "Vercel",
    summary: "Expert in React, performance optimization, and UX",
    skills: ["React", "TypeScript", "Next.js", "Performance Tuning"],
    experience: "Built high-performance web applications used by millions",
    email: "frank.johnson@example.com",
  },
  {
    id: "U007",
    name: "Grace Lee",
    title: "Security Engineer",
    organization: "Cloudflare",
    summary: "Specialist in authentication, encryption, and security architecture",
    skills: ["Security", "Cryptography", "Authentication", "Zero Trust"],
    experience: "Implemented security protocols for global-scale systems",
    email: "grace.lee@example.com",
  },
  {
    id: "U008",
    name: "Hassan Patel",
    title: "ML Ops Engineer",
    organization: "Databricks",
    summary: "Expert in ML infrastructure and production systems",
    skills: ["ML Ops", "Spark", "Ray", "Model Serving", "Monitoring"],
    experience: "Scaled ML pipelines to handle petabyte-scale datasets",
    email: "hassan.patel@example.com",
  },
  {
    id: "U009",
    name: "Iris Chen",
    title: "Solutions Architect",
    organization: "Microsoft",
    summary: "Enterprise system design and integration specialist",
    skills: ["System Design", "Enterprise Architecture", "Cloud"],
    experience: "Designed solutions for Fortune 500 companies",
    email: "iris.chen@example.com",
  },
  {
    id: "U010",
    name: "James Wilson",
    title: "Founding Engineer",
    organization: "Anthropic",
    summary: "AI systems and safety researcher",
    skills: ["AI Safety", "System Design", "Research", "RLHF"],
    experience: "Worked on fundamental AI research and safety problems",
    email: "james.wilson@example.com",
  },
];

export function getAllContacts(): Contact[] {
  return CONTACTS;
}

export function getContactById(id: string): Contact | undefined {
  return CONTACTS.find((c) => c.id === id);
}

export function filterContactsBySkills(skills: string[], threshold = 1): Contact[] {
  return CONTACTS.filter((contact) => {
    if (!contact.skills) return false;
    const matchCount = skills.filter((skill) =>
      contact.skills?.some((s) =>
        s.toLowerCase().includes(skill.toLowerCase()) ||
        skill.toLowerCase().includes(s.toLowerCase())
      )
    ).length;
    return matchCount >= threshold;
  });
}

export function filterContactsByDomain(domain: string): Contact[] {
  const domainKeywords = {
    ml: ["ML", "AI", "Machine Learning", "LLM", "Neural", "Data Science"],
    backend: ["Backend", "API", "Database", "Server", "Infrastructure", "DevOps"],
    frontend: ["Frontend", "React", "UI", "UX", "Performance"],
    fullstack: ["Full Stack", "Full-Stack"],
    security: ["Security", "Auth", "Encryption"],
    product: ["Product", "PM"],
  };

  const keywords = domainKeywords[domain as keyof typeof domainKeywords] || [];

  return CONTACTS.filter((contact) => {
    const text = `${contact.title} ${contact.skills?.join(" ") || ""}`.toLowerCase();
    return keywords.some((kw) => text.includes(kw.toLowerCase()));
  });
}
